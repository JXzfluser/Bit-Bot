#!/usr/bin/env bash
# Wave H6 — full matrix I sweep.
# Authority: docs/adr/0004-full-matrix-i-closure.md
# Does NOT claim I-PASS (i_claimed=false). Bit验证 decides.
# Usage:
#   bash scripts/host_matrix_i_sweep.sh all
#   bash scripts/host_matrix_i_sweep.sh cm-0101
#   bash scripts/host_matrix_i_sweep.sh list
# Env:
#   H6_SKIP_MOON_TEST=1  — skip moon test (CI fast / re-artifact)
#   H6_FAST=1            — same as skip moon test
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.moon/bin:${PATH}"
TARGET="${1:-all}"
EXTRA=()

if [[ "${H6_FAST:-}" == "1" || "${H6_SKIP_MOON_TEST:-}" == "1" ]]; then
  EXTRA+=(--skip-moon-test)
fi

cd "${ROOT}"
exec python3 "${ROOT}/scripts/host_matrix_i_sweep.py" "${TARGET}" "${EXTRA[@]}"
