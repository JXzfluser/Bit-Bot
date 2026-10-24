#!/usr/bin/env bash
# AU1–AU7. Live Electron approval card, then WP SoT must still be green.
# Missing toolchain fails closed. This does not close AR-15 and does not promote P0-3 to I.
set -euo pipefail
cd "$(dirname "$0")/.."
export ELECTRON_DISABLE_SANDBOX=1
export PATH="${HOME}/.moon/bin:${PATH}"
export MOONBIT_NEW_NATIVE=0
if command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a node scripts/prove_host_approval_ui.mjs
fi
exec node scripts/prove_host_approval_ui.mjs
