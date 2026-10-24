#!/usr/bin/env bash
# Live Desktop/cmd product path: default chat enters AgentLoop::run.
# Not an I promotion. AR-15 stays open. A1–A8 staying green is not MVP.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.moon/bin:${PATH}"
export MOONBIT_NEW_NATIVE=0

node "$ROOT/scripts/prove_agent_loop_product_wire.js"

MOON="${MOON:-}"
if [[ -z "$MOON" ]]; then
  if command -v moon >/dev/null 2>&1; then
    MOON="$(command -v moon)"
  elif [[ -x "${HOME}/.moon/bin/moon" ]]; then
    MOON="${HOME}/.moon/bin/moon"
  fi
fi
if [[ -z "$MOON" ]]; then
  echo "FAIL moon=absent; cannot re-run runtime regression"
  exit 1
fi
"$MOON" test -p runtime
"$MOON" test cmd/desktop_turn/agent_loop_product_wbtest.mbt
echo "prove_agent_loop_product_wire done"
