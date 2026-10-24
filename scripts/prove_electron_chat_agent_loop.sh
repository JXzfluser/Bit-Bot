#!/usr/bin/env bash
# Live Electron composer mid-run (EG1–EG6). Missing toolchain fails closed.
set -euo pipefail
cd "$(dirname "$0")/.."
export ELECTRON_DISABLE_SANDBOX=1
if command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a node scripts/prove_electron_chat_agent_loop.mjs
fi
exec node scripts/prove_electron_chat_agent_loop.mjs
