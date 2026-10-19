#!/usr/bin/env bash
# Start Bit Bot Desktop (Electron) with MoonBit on PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.moon/bin:${PATH}"
DESKTOP_DIR="$ROOT/hosts/desktop"

if ! command -v moon >/dev/null 2>&1; then
  echo "error: moon not found; install MoonBit and ensure \$HOME/.moon/bin is on PATH" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm not found" >&2
  exit 1
fi

cd "$DESKTOP_DIR"
if [[ ! -d node_modules/electron ]]; then
  echo "[desktop] npm install…"
  npm install
fi

echo "[desktop] MoonBit=$(moon version 2>/dev/null | head -1 || true) target=${BITBOT_MOON_TARGET:-native}"
echo "[desktop] launching Electron from hosts/desktop…"
exec npm start
