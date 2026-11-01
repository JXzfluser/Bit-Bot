#!/usr/bin/env bash
# Build the native kernel and stage it where electron-builder ships it
# (hosts/desktop/resources/kernel/bin/desktop_turn).
#
# Why this script exists: the CI workflow used to inline the copy with a
# hard-coded `desktop_turn` filename. MoonBit's linker appends `.exe` on every
# platform, so the real artifact is `desktop_turn.exe`; `pack-desktop.sh` and
# `prove_kernel_binary.sh` both already resolve both names, the workflow did
# not — Kernel Binary went red on a path that no product code uses.
#
# Keep the resolution in ONE place: two names, first match wins.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.moon/bin:${PATH}"

PROFILE="${BITBOT_KERNEL_BUILD:-debug}"
DEST="$ROOT/hosts/desktop/resources/kernel/bin"

command -v moon >/dev/null 2>&1 || { echo "error: moon not found on PATH" >&2; exit 2; }
moon build --target native >/dev/null
BIN_DIR="$ROOT/_build/native/$PROFILE/build/cmd/desktop_turn"
BIN=""
for cand in "$BIN_DIR/desktop_turn" "$BIN_DIR/desktop_turn.exe"; do
  if [ -f "$cand" ]; then BIN="$cand"; break; fi
done
if [ -z "$BIN" ]; then
  echo "error: 内核编译没报错，但 $BIN_DIR 下没有 desktop_turn(.exe)" >&2
  ls -la "$BIN_DIR" >&2 || true
  exit 1
fi
mkdir -p "$DEST"
cp "$BIN" "$DEST/desktop_turn"
chmod +x "$DEST/desktop_turn"
test -x "$DEST/desktop_turn"
echo "kernel staged into app resources: $DEST/desktop_turn (from $(basename "$BIN"))"
