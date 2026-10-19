#!/usr/bin/env bash
# Package Bit Bot Desktop (Electron). MoonBit remains the product brain on PATH.
# Signing: source hosts/dist-signing/DESKTOP_SIGNING.env when BITBOT_DESKTOP_SIGN=1
# (certs still required; default path is unsigned dir for smoke).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/hosts/desktop"
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
  # shellcheck disable=SC1090
  set -a; source "$SIGN_ENV"; set +a
  echo "[pack-desktop] BITBOT_DESKTOP_SIGN=1 — signing env loaded (certs must exist)"
else
  echo "[pack-desktop] unsigned pack (set BITBOT_DESKTOP_SIGN=1 + DESKTOP_SIGNING.env for signed)"
fi

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
ls -la dist/ 2>/dev/null || true
# Evidence for Host packaging smoke (no secrets).
mkdir -p "$ROOT/data/tmp"
python3 - <<PY
import json, os, pathlib
root = pathlib.Path("$ROOT")
dist = root / "hosts" / "desktop" / "dist"
entries = []
if dist.exists():
    for p in sorted(dist.rglob("*")):
        if p.is_file():
            entries.append({"path": str(p.relative_to(dist)), "bytes": p.stat().st_size})
out = {
    "ok": dist.exists(),
    "signed": os.environ.get("BITBOT_DESKTOP_SIGN") == "1",
    "entries": entries[:40],
    "entry_count": len(entries),
    "note": "store signing residual until CSC_LINK / Apple notarize creds present",
}
path = root / "data" / "tmp" / "desktop-pack-evidence.json"
path.write_text(json.dumps(out, indent=2) + "\n")
print("[pack-desktop] evidence", path, "entries", len(entries), "signed", out["signed"])
PY
