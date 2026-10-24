#!/usr/bin/env bash
# SK1–SK8 evidence. Labels match docs/agent-core/05-security-sandbox-secrets.md §4.
# Not P0. Not AU. Not an I promotion. Does not close AR-15.
# phone host is not SK7. danger/echo is not SK8.
# prove_p0_inbound_host_checks.js is a different gate and does not close SK.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/prove_sandbox_secrets.js
