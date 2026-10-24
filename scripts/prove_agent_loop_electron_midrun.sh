#!/usr/bin/env bash
# EG1–EG6. Live Electron composer mid-run, then WP SoT must still be green.
# WP PASS is not itself an EG. Missing toolchain fails closed.
set -euo pipefail
cd "$(dirname "$0")/.."
export ELECTRON_DISABLE_SANDBOX=1
export PATH="${HOME}/.moon/bin:${PATH}"
export MOONBIT_NEW_NATIVE=0
if command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a node scripts/prove_agent_loop_electron_midrun.mjs
fi
exec node scripts/prove_agent_loop_electron_midrun.mjs
