#!/usr/bin/env bash
# Gate: a turn leaves a replayable trace (tools + args + results).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.moon/bin:${PATH}"
node scripts/prove_trace_replay.js
