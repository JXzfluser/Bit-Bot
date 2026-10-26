#!/usr/bin/env bash
# Gate: a room message really gets answered (Q-6) and idempotency keys on the
# delivery, not on the wording (Q-5).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node scripts/prove_room_dispatch.js
