#!/usr/bin/env bash
# PP1–PP7. Product Chat must hit the configured external provider.
# Not an I promotion. Does not close AR-01/02/03/15.
# Does not claim Desktop Agent Loop MVP.
# BITBOT_LEGACY_CHAT_EFFECT=1 is not PP evidence.
# Never print BITBOT_LLM_API_KEY (or catalog env_key values).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.moon/bin:${PATH}"
export MOONBIT_NEW_NATIVE=0

TEE="$(mktemp)"
cleanup() { rm -f "$TEE"; }
trap cleanup EXIT

set +e
set -o pipefail
node "$ROOT/scripts/prove_production_provider.js" | tee "$TEE"
code=$?
set +o pipefail
set -e

if ! node - "$TEE" <<'JS'
const fs = require("fs");
const text = fs.readFileSync(process.argv[2], "utf8");
for (const [name, value] of Object.entries(process.env)) {
  if (!value) continue;
  if (
    name === "BITBOT_LLM_API_KEY" ||
    /^BITBOT_LLM_.+(?:_KEY|_TOKEN|_SECRET)$/i.test(name)
  ) {
    if (text.includes(value)) process.exit(4);
  }
}
JS
then
  echo "FAIL PP5 tee contained key plaintext" >&2
  exit 4
fi

exit "$code"
