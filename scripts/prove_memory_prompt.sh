#!/usr/bin/env bash
# Gate: the Bot's long-term memory reaches the MODEL (system segment).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.moon/bin:${PATH}"
node scripts/prove_memory_prompt.js
