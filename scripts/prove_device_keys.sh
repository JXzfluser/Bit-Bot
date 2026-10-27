#!/usr/bin/env bash
# Gate: a machine is identified by its own key (B-4a), not by a shared secret.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node scripts/prove_device_keys.js
