#!/usr/bin/env bash
# ADR 0008 evidence_cmd. Curl-falsifies P0-1 / P0-2 / P0-4 against a loopback
# inbound fixture. P0-3 is not promoted to I; host shell checks are separate
# and still not an h6-matrix-i artifact.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/p0-inbound.XXXXXX")"
PASS=0
FAIL=0
SERVER_PID=""

ok() { PASS=$((PASS + 1)); printf '  ok %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

export BITBOT_TURN_TOKEN="p0-turn-token-value"
export BITBOT_DINGTALK_APP_SECRET="p0-ding-secret-value"
unset BITBOT_BIND_LAN || true
unset BITBOT_CN_INBOUND_HOST || true
unset BITBOT_INBOUND_MAX_BODY || true

node "$ROOT/scripts/p0_inbound_fixture_server.js" "$TMP" >"$TMP/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 50); do
  if [[ -f "$TMP/ready" ]]; then
    break
  fi
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    bad "fixture server exited early"
    cat "$TMP/server.log" >&2 || true
    printf 'prove_p0_inbound_security pass=%s fail=%s\n' "$PASS" "$FAIL"
    exit 1
  fi
  sleep 0.05
done
if [[ ! -f "$TMP/port" ]]; then
  bad "fixture server did not bind"
  cat "$TMP/server.log" >&2 || true
  printf 'prove_p0_inbound_security pass=%s fail=%s\n' "$PASS" "$FAIL"
  exit 1
fi
PORT="$(cat "$TMP/port")"
BASE="http://127.0.0.1:${PORT}"
PENDING="$TMP/repo/data/routines/webhooks/pending-turns.jsonl"

wake_lines() {
  if [[ -f "$TMP/wakes.jsonl" ]]; then
    wc -l <"$TMP/wakes.jsonl" | tr -d ' '
  else
    echo 0
  fi
}
pending_lines() {
  if [[ -f "$PENDING" ]]; then
    wc -l <"$PENDING" | tr -d ' '
  else
    echo 0
  fi
}

echo "prove_p0_inbound_security — ADR 0008 curl gates on ${BASE}"

# P0-1: no Authorization → 401, no wake.
code="$(curl -sS -o "$TMP/p0-1.json" -w '%{http_code}' -X POST "$BASE/v1/turn" \
  -H 'Content-Type: application/json' \
  -d '{"text":"shell echo pwned","machine_kind":"ios"}' || true)"
if [[ "$code" == "401" ]] && grep -q '"error":"unauthorized"' "$TMP/p0-1.json" \
  && [[ "$(wake_lines)" == "0" && "$(pending_lines)" == "0" ]]; then
  ok "P0-1 no Authorization → 401 and no wake"
else
  bad "P0-1 code=${code} wakes=$(wake_lines) pending=$(pending_lines) body=$(head -c 180 "$TMP/p0-1.json" 2>/dev/null || true)"
fi

# Wrong bearer is also 401 and still no wake.
code="$(curl -sS -o "$TMP/p0-1b.json" -w '%{http_code}' -X POST "$BASE/v1/turn" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer wrong-token-value' \
  -d '{"text":"shell echo pwned"}' || true)"
if [[ "$code" == "401" ]] && grep -q '"error":"invalid_token"' "$TMP/p0-1b.json" \
  && [[ "$(wake_lines)" == "0" ]]; then
  ok "P0-1 wrong bearer → 401 invalid_token and no wake"
else
  bad "P0-1b code=${code} wakes=$(wake_lines)"
fi

# P0-2: DingTalk bad sign → 401, no wake.
code="$(curl -sS -o "$TMP/p0-2.json" -w '%{http_code}' -X POST "$BASE/dingtalk/callback" \
  -H 'Content-Type: application/json' \
  -H 'timestamp: 1700000000000' \
  -H 'sign: YmFkLXNpZ25hdHVyZQ==' \
  -d '{"msgtype":"text","text":{"content":"pwn"}}' || true)"
if [[ "$code" == "401" ]] && grep -q '"error":"bad_signature"' "$TMP/p0-2.json" \
  && [[ "$(wake_lines)" == "0" && "$(pending_lines)" == "0" ]]; then
  ok "P0-2 dingtalk bad signature → 401 and no wake"
else
  bad "P0-2 code=${code} wakes=$(wake_lines) pending=$(pending_lines) body=$(head -c 180 "$TMP/p0-2.json" 2>/dev/null || true)"
fi

# P0-2b: turn HMAC with a wrong signature → 401, no wake.
NOW_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"
code="$(curl -sS -o "$TMP/p0-2b.json" -w '%{http_code}' -X POST "$BASE/v1/turn" \
  -H 'Content-Type: application/json' \
  -H "X-Bitbot-Timestamp: ${NOW_MS}" \
  -H 'X-Bitbot-Nonce: p0-nonce-once' \
  -H 'X-Bitbot-Signature: deadbeef' \
  -d '{"text":"hello from a bad signature"}' || true)"
if [[ "$code" == "401" ]] && grep -q '"error":"bad_signature"' "$TMP/p0-2b.json" \
  && [[ "$(wake_lines)" == "0" ]]; then
  ok "P0-2 turn bad signature → 401 and no wake"
else
  bad "P0-2b code=${code} wakes=$(wake_lines) body=$(head -c 180 "$TMP/p0-2b.json" 2>/dev/null || true)"
fi

# A correct DingTalk signature must still wake. Otherwise "always 401" would
# look like P0-2 passed.
GOOD_TS="1700000000000"
GOOD_SIGN="$(node -e '
const crypto = require("crypto");
const ts = process.argv[1];
const secret = process.env.BITBOT_DINGTALK_APP_SECRET;
process.stdout.write(crypto.createHmac("sha256", secret).update(ts + "\n" + secret).digest("base64"));
' "$GOOD_TS")"
code="$(curl -sS -o "$TMP/p0-2-good.json" -w '%{http_code}' -X POST "$BASE/dingtalk/callback" \
  -H 'Content-Type: application/json' \
  -H "timestamp: ${GOOD_TS}" \
  -H "sign: ${GOOD_SIGN}" \
  -d '{"msgtype":"text","text":{"content":"hello dingtalk"}}' || true)"
if [[ "$code" == "200" ]] && [[ "$(wake_lines)" == "1" && "$(pending_lines)" == "1" ]]; then
  ok "dingtalk good signature → 200 and one wake"
else
  bad "dingtalk good signature code=${code} wakes=$(wake_lines) pending=$(pending_lines)"
fi

# P0-4: body over the 1 MiB default → 413, no wake.
python3 -c 'import sys; sys.stdout.buffer.write(b"x"*1048577)' >"$TMP/big.bin"
code="$(curl -sS -o "$TMP/p0-4.json" -w '%{http_code}' -X POST "$BASE/v1/turn" \
  -H 'Content-Type: application/octet-stream' \
  -H "Authorization: Bearer ${BITBOT_TURN_TOKEN}" \
  --data-binary @"$TMP/big.bin" || true)"
if [[ "$code" == "413" ]] && grep -q '"error":"payload_too_large"' "$TMP/p0-4.json" \
  && [[ "$(wake_lines)" == "1" && "$(pending_lines)" == "1" ]]; then
  ok "P0-4 body over 1 MiB → 413 and wake count unchanged"
else
  bad "P0-4 code=${code} wakes=$(wake_lines) pending=$(pending_lines) body=$(head -c 180 "$TMP/p0-4.json" 2>/dev/null || true)"
fi

# Control: a real bearer still wakes once more. 401/413 must not have killed the port.
code="$(curl -sS -o "$TMP/p0-ok.json" -w '%{http_code}' -X POST "$BASE/v1/turn" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${BITBOT_TURN_TOKEN}" \
  -d '{"text":"hello","machine_kind":"ios","session_id":"p0"}' || true)"
if [[ "$code" == "200" ]] && grep -q '"brain":"shared_desktop_host"' "$TMP/p0-ok.json" \
  && grep -q 'ack' "$TMP/p0-ok.json" && [[ "$(wake_lines)" == "2" && "$(pending_lines)" == "2" ]]; then
  ok "bearer turn → 200 and one additional wake"
else
  bad "control code=${code} wakes=$(wake_lines) pending=$(pending_lines) body=$(head -c 180 "$TMP/p0-ok.json" 2>/dev/null || true)"
fi

# Health stays open and does not echo the token.
code="$(curl -sS -o "$TMP/health.json" -w '%{http_code}' "$BASE/health" || true)"
if [[ "$code" == "200" ]] && ! grep -q "$BITBOT_TURN_TOKEN" "$TMP/health.json"; then
  ok "GET /health is open and does not return the turn token"
else
  bad "health code=${code}"
fi

echo "curl pass=${PASS} fail=${FAIL}"
if ! node "$ROOT/scripts/prove_p0_inbound_host_checks.js"; then
  FAIL=$((FAIL + 1))
fi

printf 'prove_p0_inbound_security pass=%s fail=%s\n' "$PASS" "$FAIL"
if [[ "$FAIL" != "0" ]]; then
  exit 1
fi
exit 0
