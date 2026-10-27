#!/usr/bin/env bash
# Gate: a machine that stays on does its job on time, and another machine can
# approve what it asks for (B-1 补 + B-6).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.moon/bin:${PATH}"
node scripts/prove_box_routine_sweep.js
