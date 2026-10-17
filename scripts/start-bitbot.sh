#!/usr/bin/env bash
# Product start path: MoonBit boot + Host UI on 8765.
# Usage: bash scripts/start-bitbot.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.moon/bin:${PATH}"
HOST_UI_PORT="${HOST_UI_PORT:-8765}"
HOST_SERVER="${ROOT}/scripts/host_ui_surface/host_server.py"
PID_FILE="${BITBOT_HOST_PID_FILE:-/tmp/bitbot-host-ui.pid}"

cd "${ROOT}"

echo "== Bit Bot start =="
echo "ROOT=${ROOT}"
echo "PATH moon: $(command -v moon || echo MISSING)"

echo ""
echo "-- moon run cmd/main --"
moon run cmd/main

if [[ -f "${PID_FILE}" ]] && kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
  echo "Host UI already running pid=$(cat "${PID_FILE}") port=${HOST_UI_PORT}"
else
  HOST_UI_PORT="${HOST_UI_PORT}" python3 "${HOST_SERVER}" >/tmp/bitbot-host-ui.log 2>&1 &
  echo $! > "${PID_FILE}"
  sleep 0.4
  echo "Host UI started pid=$(cat "${PID_FILE}")"
fi

BASE="http://127.0.0.1:${HOST_UI_PORT}"
echo ""
echo "== URLs =="
echo "  Host UI:     ${BASE}/"
echo "  Health:      ${BASE}/api/host/health"
echo "  Host state:  ${BASE}/api/host/state"
echo "  Audit:       ${BASE}/api/host/audit"
echo ""
echo "Logs: /tmp/bitbot-host-ui.log"
echo "Stop: kill \$(cat ${PID_FILE})"
