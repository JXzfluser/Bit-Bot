#!/usr/bin/env bash
# Gate: cross-device approval actually works from the command line.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node scripts/prove_approve_cli.js
