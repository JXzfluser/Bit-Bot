#!/usr/bin/env bash
# SK1–SK8 sandbox and secret-leak evidence.
# Not P0. Not AU. Not an I promotion. Does not close AR-15.
# prove_p0_inbound_host_checks.js is a different gate and does not close SK.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/prove_sandbox_secrets.js
