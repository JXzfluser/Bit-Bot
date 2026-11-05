#!/usr/bin/env bash
# start_public_relay.sh — A3-15 以「公网部署姿势」启动中转节点
#
# 与 setup_public_relay.js 共用同一个 data/desktop/relay-secret：
# 服务端校验凭证用的 secret 与签发时必须是同一个，否则 box/client 会一律 DENY。
#
# 绑 0.0.0.0（relay_server.js 默认只绑 127.0.0.1，公网机器不设这个就白跑）；
# 审计日志落 data/desktop/relay-audit.jsonl，只有元数据、不含 token 与正文。
#
# 用法：bash scripts/start_public_relay.sh
#   BITBOT_RELAY_CONTROL_PORT / BITBOT_RELAY_HEALTH_PORT 可覆盖默认 18766 / 18767。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRET_FILE="$ROOT/data/desktop/relay-secret"
if [[ ! -f "$SECRET_FILE" ]]; then
  echo "缺少 $SECRET_FILE —— 先跑：node scripts/setup_public_relay.js --host <公网IP或域名>" >&2
  exit 1
fi
SECRET="$(tr -d '\n' < "$SECRET_FILE")"
if [[ -z "$SECRET" ]]; then
  echo "relay-secret 为空" >&2
  exit 1
fi
mkdir -p "$ROOT/data/desktop"
export BITBOT_RELAY_SECRET="$SECRET"
export BITBOT_RELAY_BIND="${BITBOT_RELAY_BIND:-0.0.0.0}"
export BITBOT_RELAY_CONTROL_PORT="${BITBOT_RELAY_CONTROL_PORT:-18766}"
export BITBOT_RELAY_HEALTH_PORT="${BITBOT_RELAY_HEALTH_PORT:-18767}"
export BITBOT_RELAY_LOGFILE="${BITBOT_RELAY_LOGFILE:-$ROOT/data/desktop/relay-audit.jsonl}"
echo "[relay] secret=from-file bind=$BITBOT_RELAY_BIND control=$BITBOT_RELAY_CONTROL_PORT health=$BITBOT_RELAY_HEALTH_PORT"
exec node "$ROOT/hosts/shared/relay/relay_server.js"
