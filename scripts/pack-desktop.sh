#!/usr/bin/env bash
# Package Bit Bot Desktop (Electron). MoonBit remains the product brain on PATH.
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
