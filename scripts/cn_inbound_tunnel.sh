#!/usr/bin/env bash
# Expose Desktop CN inbound (:18765) via Cloudflare quick tunnel for 钉钉/飞书/企微
# HTTPS callbacks. Never pretends cloud apps are configured — operator must paste
# the printed URL into the channel console.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${BITBOT_CN_INBOUND_PORT:-18765}"
OUT_DIR="$ROOT/data/routines/webhooks/cn-inbound"
mkdir -p "$OUT_DIR"
URL_FILE="$OUT_DIR/public-url.txt"
LOG_FILE="$OUT_DIR/tunnel.log"

CLOUDFLARED="${BITBOT_CLOUDFLARED:-}"
if [[ -z "$CLOUDFLARED" ]]; then
  if command -v cloudflared >/dev/null 2>&1; then
    CLOUDFLARED="$(command -v cloudflared)"
  elif [[ -x /tmp/cloudflared ]]; then
    CLOUDFLARED=/tmp/cloudflared
  elif [[ -x "$ROOT/tools/cloudflared" ]]; then
    CLOUDFLARED="$ROOT/tools/cloudflared"
  else
    echo "FAIL: cloudflared not found — install or set BITBOT_CLOUDFLARED" >&2
    exit 1
  fi
fi
chmod +x "$CLOUDFLARED" 2>/dev/null || true

# Ensure inbound is listening (standalone product Host if Desktop not running).
# Never start tunnel-echo — that would fake 真渠道/真模型.
if ! curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "starting standalone product cn_inbound on :$PORT (MoonBit Host onTurn)"
  BITBOT_CN_INBOUND_PORT="$PORT" BITBOT_CN_INBOUND_HOST=127.0.0.1 \
    node -e '
      const { createCnInboundServer } = require("./hosts/shared/cn_inbound_server");
      const { createProductOnTurn } = require("./hosts/shared/cn_inbound_product_on_turn");
      const root = process.cwd();
      createCnInboundServer({
        repoRoot: root,
        port: Number(process.env.BITBOT_CN_INBOUND_PORT || 18765),
        host: "127.0.0.1",
        onTurn: createProductOnTurn(root),
      }).start();
    ' >/tmp/cn-inbound-standalone.log 2>&1 &
  echo $! >"$OUT_DIR/standalone.pid"
  for i in $(seq 1 20); do
    curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 && break
    sleep 0.5
  done
fi
# Refuse if an old tunnel-echo stub is still bound (honest residual).
if curl -fsS -X POST "http://127.0.0.1:${PORT}/v1/turn" \
  -H 'Content-Type: application/json' \
  -d '{"text":"ListMachines","machine_kind":"desktop","session_id":"tunnel-probe"}' \
  2>/dev/null | grep -q '\[tunnel-echo\]'; then
  echo "FAIL: :$PORT still serves tunnel-echo — kill stub and re-run with product onTurn" >&2
  exit 1
fi

echo "tunnel → http://127.0.0.1:${PORT} (log: $LOG_FILE)"
# Parse trycloudflare URL from cloudflared stderr/stdout
rm -f "$URL_FILE"
"$CLOUDFLARED" tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate \
  >"$LOG_FILE" 2>&1 &
TPID=$!
echo "$TPID" >"$OUT_DIR/tunnel.pid"

PUBLIC=""
for i in $(seq 1 40); do
  sleep 1
  PUBLIC=$(grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$LOG_FILE" | head -1 || true)
  if [[ -n "$PUBLIC" ]]; then
    break
  fi
  if ! kill -0 "$TPID" 2>/dev/null; then
    echo "FAIL: cloudflared exited early — see $LOG_FILE" >&2
    tail -30 "$LOG_FILE" >&2 || true
    exit 1
  fi
done

if [[ -z "$PUBLIC" ]]; then
  echo "FAIL: no trycloudflare URL yet — see $LOG_FILE" >&2
  exit 1
fi

{
  echo "$PUBLIC"
  echo "# routes:"
  echo "#   $PUBLIC/dingtalk/callback"
  echo "#   $PUBLIC/feishu/event"
  echo "#   $PUBLIC/wecom/callback"
  echo "#   $PUBLIC/v1/turn"
} | tee "$URL_FILE"

echo "OK public_url=$PUBLIC (pid=$TPID) — paste into 钉钉/飞书/企微 console; not live until BITBOT_*_POST=1 + creds"
# Keep tunnel in foreground if BITBOT_CN_TUNNEL_FOREGROUND=1
if [[ "${BITBOT_CN_TUNNEL_FOREGROUND:-}" == "1" ]]; then
  wait "$TPID"
fi
exit 0
