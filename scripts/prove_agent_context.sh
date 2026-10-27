#!/usr/bin/env bash
# AC — K-1/K-3 gate: the agent context survives the process.
#
# The kernel is spawned per turn, so an in-process context dies with the
# process. This gate proves the context CROSSES that boundary: a fact planted
# in one turn is present in the next turn's provider payload, and a DIFFERENT
# Bot's slot does not see it.
#
# It is NOT a model-quality promotion: the provider is a local stub that only
# checks whether the fact is PRESENT. What it proves is the context crosses
# the process boundary — not that the model reasons well about it.
#
# Usage:
#   bash scripts/prove_agent_context.sh
#   BITBOT_KERNEL_BUILD=debug bash scripts/prove_agent_context.sh   # faster
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.moon/bin:${PATH}"

PROFILE="${BITBOT_KERNEL_BUILD:-release}"
FLAGS=()
if [[ "$PROFILE" == "release" ]]; then FLAGS+=(--release); fi

echo "== AC0 build the kernel (profile=$PROFILE) =="
if ! moon build --target native "${FLAGS[@]}" >/tmp/ac_build.log 2>&1; then
  echo "FAIL AC0 — kernel build failed"; tail -20 /tmp/ac_build.log; exit 1
fi
BIN_DIR="$ROOT/_build/native/$PROFILE/build/cmd/desktop_turn"
BIN=""
for c in "$BIN_DIR/desktop_turn" "$BIN_DIR/desktop_turn.exe"; do
  [[ -x "$c" ]] && BIN="$c" && break
done
if [[ -z "$BIN" ]]; then
  echo "FAIL AC0 — kernel binary missing under $BIN_DIR"; exit 1
fi
export BITBOT_KERNEL_BIN="$BIN"
echo "ok AC0 — kernel built: ${BIN#$ROOT/}"

echo "== AC1..AC4 the context crosses the process boundary =="
node "$ROOT/scripts/prove_agent_context.js"
rc=$?
if [ $rc -ne 0 ]; then
  echo "FAIL AC — the agent context did not survive the process"
  exit 1
fi

echo
echo "== AC summary: the agent context survives the turn boundary =="
exit 0
