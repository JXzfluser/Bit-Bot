#!/usr/bin/env bash
# Gate: a machine has a real identity (B-2) — no more hardcoded "desk-1".
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node scripts/prove_machine_identity.js
