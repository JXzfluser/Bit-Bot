#!/usr/bin/env bash
# Package Bit Bot Desktop (Electron) WITH the MoonBit kernel.
#
# What changed and why
# --------------------
# The kernel used to stay OUT of the bundle: the app shelled out to
# `moon run cmd/desktop_turn --target native` and therefore needed a MoonBit
# toolchain plus a source checkout on the target machine. On top of that,
# hosts/desktop/main.js probed for `moon.mod.json` (the real file is
# `moon.mod`) and fell back to a hard-coded developer path, so a packaged
# build had no way to find its own brain.
#
# Now we compile the kernel to a self-contained native binary and ship it in
# the app's resources:
#   * `moon build --target native` -> desktop_turn executable
#   * staged to hosts/desktop/resources/kernel/bin/
#   * electron-builder copies it to <resources>/kernel via extraResources
#   * hosts/desktop/paths.js resolves it, and the host runs it directly
#     (identical argv tail + identical BITBOT_FFI stdin/stdout protocol)
#
# Signing: source hosts/dist-signing/DESKTOP_SIGNING.env when BITBOT_DESKTOP_SIGN=1
# (certs still required; default path is unsigned dir for smoke).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/hosts/desktop"
RESOURCES="$DESKTOP/resources"
export PATH="${HOME}/.moon/bin:${PATH}"

if ! command -v moon >/dev/null 2>&1; then
  echo "error: moon not found on PATH" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm not found" >&2
  exit 1
fi

SIGN_ENV="$ROOT/hosts/dist-signing/DESKTOP_SIGNING.env"
if [[ "${BITBOT_DESKTOP_SIGN:-0}" == "1" && -f "$SIGN_ENV" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$SIGN_ENV"; set +a
  echo "[pack-desktop] BITBOT_DESKTOP_SIGN=1 — signing env loaded (certs must exist)"
else
  echo "[pack-desktop] unsigned pack (set BITBOT_DESKTOP_SIGN=1 + DESKTOP_SIGNING.env for signed)"
fi

# ---------------------------------------------------------------------------
# 1. Build the kernel
# ---------------------------------------------------------------------------
BUILD_PROFILE="${BITBOT_KERNEL_BUILD:-release}"
BUILD_FLAGS=()
if [[ "$BUILD_PROFILE" == "release" ]]; then
  BUILD_FLAGS+=(--release)
fi

echo "[pack-desktop] building MoonBit kernel (profile=$BUILD_PROFILE)…"
(cd "$ROOT" && moon build --target native "${BUILD_FLAGS[@]}")

KERNEL_BIN_DIR="$ROOT/_build/native/$BUILD_PROFILE/build/cmd/desktop_turn"
KERNEL_BIN=""
for cand in "$KERNEL_BIN_DIR/desktop_turn" "$KERNEL_BIN_DIR/desktop_turn.exe"; do
  if [[ -x "$cand" ]]; then KERNEL_BIN="$cand"; break; fi
done
if [[ -z "$KERNEL_BIN" ]]; then
  echo "error: kernel binary not found under $KERNEL_BIN_DIR" >&2
  exit 1
fi
echo "[pack-desktop] kernel binary: $KERNEL_BIN"

# ---------------------------------------------------------------------------
# 2. Smoke the kernel before shipping it
#    A kernel that cannot answer a trivial turn must not reach a user.
# ---------------------------------------------------------------------------
echo "[pack-desktop] kernel smoke…"
KERNEL_SMOKE="$(
  "$KERNEL_BIN" "ListMachines" 2>/dev/null | head -1 || true
)"
if [[ -z "$KERNEL_SMOKE" ]]; then
  echo "error: kernel smoke produced no output" >&2
  exit 1
fi
case "$KERNEL_SMOKE" in
  *'"v":1'*) echo "[pack-desktop] kernel smoke OK (v:1 JSON)" ;;
  *)
    echo "error: kernel smoke output is not v:1 JSON: ${KERNEL_SMOKE:0:200}" >&2
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# 3. Stage into the app resources
# ---------------------------------------------------------------------------
rm -rf "$RESOURCES/kernel"
mkdir -p "$RESOURCES/kernel/bin"
cp "$KERNEL_BIN" "$RESOURCES/kernel/bin/desktop_turn${KERNEL_BIN##*.}"
chmod +x "$RESOURCES/kernel/bin/"desktop_turn*

# The kernel resolves `data/...` relative to its cwd, which the host sets to
# the parent of the data root. Nothing else from the source tree is needed at
# runtime, so we deliberately do NOT ship moon.mod / cmd/ / the package dirs:
# shipping them would imply a toolchain is present, and it is not.
cat > "$RESOURCES/kernel/README.txt" <<'TXT'
Bit Bot — bundled MoonBit kernel
===============================
bin/desktop_turn is the compiled product brain.

It is a drop-in replacement for:
    moon run cmd/desktop_turn --target native -- <args>

Same argv tail, same stdout/stdin FFI line protocol:
  kernel writes  BITBOT_FFI <json>  to stdout
  host answers   one JSON line      on stdin

No MoonBit toolchain and no source tree are required at runtime.
Built on: __BUILD_HOST__
Profile: __BUILD_PROFILE__
TXT
sed -i "s/__BUILD_HOST__/$(uname -srm)/; s/__BUILD_PROFILE__/$BUILD_PROFILE/" "$RESOURCES/kernel/README.txt"

echo "[pack-desktop] staged kernel resources:"
ls -la "$RESOURCES/kernel/bin/"

# ---------------------------------------------------------------------------
# 4. Package the app
# ---------------------------------------------------------------------------
cd "$DESKTOP"
if [[ ! -d node_modules/electron ]]; then
  npm install
fi
if [[ ! -d node_modules/electron-builder ]]; then
  npm install --save-dev electron-builder@^25.1.8
fi

echo "[pack-desktop] building unpackaged dir via electron-builder…"
npm run pack
echo "[pack-desktop] output under hosts/desktop/dist/"

# ---------------------------------------------------------------------------
# 5. Evidence (no secrets)
# ---------------------------------------------------------------------------
mkdir -p "$ROOT/data/tmp"
python3 - <<PY
import json, os, pathlib
root = pathlib.Path("$ROOT")
dist = root / "hosts" / "desktop" / "dist"
res = root / "hosts" / "desktop" / "resources" / "kernel"
entries = []
if dist.exists():
    for p in sorted(dist.rglob("*")):
        if p.is_file():
            entries.append({"path": str(p.relative_to(dist)), "bytes": p.stat().st_size})
kernel = []
if res.exists():
    for p in sorted(res.rglob("*")):
        if p.is_file():
            kernel.append({"path": str(p.relative_to(res)), "bytes": p.stat().st_size})
out = {
    "ok": dist.exists(),
    "signed": os.environ.get("BITBOT_DESKTOP_SIGN") == "1",
    "entries": entries[:40],
    "entry_count": len(entries),
    "kernel_bundled": bool(kernel),
    "kernel_files": kernel,
    "kernel_profile": "$BUILD_PROFILE",
    "note": "kernel shipped as a compiled native binary; no toolchain needed at runtime. "
            "store signing residual until CSC_LINK / Apple notarize creds present",
}
path = root / "data" / "tmp" / "desktop-pack-evidence.json"
path.write_text(json.dumps(out, indent=2) + "\n")
print("[pack-desktop] evidence", path, "entries", len(entries), "kernel_bundled", out["kernel_bundled"])
PY
