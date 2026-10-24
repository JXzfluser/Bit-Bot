#!/usr/bin/env bash
# A7 Host stream keeps tool_calls. A8 minimal host smoke (content-only).
# A1–A6: moon test -p runtime (mock host). Not an I promotion. AR-15 stays open.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node "$ROOT/scripts/prove_agent_loop_a7_a8.js"

MOON="${MOON:-}"
if [[ -z "$MOON" ]]; then
  if command -v moon >/dev/null 2>&1; then
    MOON="$(command -v moon)"
  elif [[ -x "${HOME}/.moon/bin/moon" ]]; then
    MOON="${HOME}/.moon/bin/moon"
  fi
fi
if [[ -z "$MOON" ]]; then
  echo "FAIL moon=absent; cannot re-run A1-A6 (moon test -p runtime)"
  exit 1
fi
"$MOON" test -p runtime
echo "prove_agent_loop_a7_a8 done"
