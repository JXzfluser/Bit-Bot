#!/usr/bin/env bash
# Gate: a packed Box really answers a signed turn from another machine (B-1).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.moon/bin:${PATH}"
node scripts/prove_box_two_machines.js
