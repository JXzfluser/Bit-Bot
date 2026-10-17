#!/usr/bin/env bash
# Product start path: MoonBit boot + Host UI runtime on 8765.
# Usage: bash scripts/start-bitbot.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.moon/bin:${PATH}"
HOST_UI_PORT="${HOST_UI_PORT:-8765}"
HOST_SERVER="${ROOT}/scripts/host_ui_surface/host_server.py"
PID_FILE="${BITBOT_HOST_PID_FILE:-/tmp/bitbot-host-ui.pid}"
LOG_FILE="${BITBOT_HOST_LOG:-/tmp/bitbot-host-ui.log}"

cd "${ROOT}"

mkdir -p \
  "${ROOT}/data/chats" \
  "${ROOT}/data/memory" \
  "${ROOT}/data/journal" \
  "${ROOT}/data/routines" \
  "${ROOT}/data/connectors" \
  "${ROOT}/data/audit" \
  /tmp/bitbot-sandbox

detect_llm_mode() {
  if [[ -n "${BITBOT_LLM_BASE_URL:-}" && -n "${BITBOT_LLM_API_KEY:-}" ]]; then
    echo "api"
    return
  fi
  local ollama_url="${BITBOT_OLLAMA_URL:-http://127.0.0.1:11434}"
  if curl -fsS --max-time 1.5 "${ollama_url}/api/tags" >/dev/null 2>&1; then
    echo "ollama"
    return
  fi
  echo "localbrain"
}

LLM_MODE="$(detect_llm_mode)"

echo "== Bit Bot start =="
echo "ROOT=${ROOT}"
echo "PATH moon: $(command -v moon || echo MISSING)"
echo "LLM mode: ${LLM_MODE}"
echo "  BITBOT_LLM_BASE_URL=${BITBOT_LLM_BASE_URL:-<unset>}"
echo "  BITBOT_OLLAMA_URL=${BITBOT_OLLAMA_URL:-http://127.0.0.1:11434}"
echo "  BITBOT_OLLAMA_MODEL=${BITBOT_OLLAMA_MODEL:-llama3.2:1b}"
echo "Data: ${ROOT}/data/"

echo ""
echo "-- moon run cmd/main --"
moon run cmd/main

if [[ -f "${PID_FILE}" ]] && kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
  echo "Host UI already running pid=$(cat "${PID_FILE}") port=${HOST_UI_PORT}"
else
  HOST_UI_PORT="${HOST_UI_PORT}" python3 "${HOST_SERVER}" >"${LOG_FILE}" 2>&1 &
  echo $! > "${PID_FILE}"
  sleep 0.5
  if ! kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
    echo "Host UI failed to start; log:" >&2
    tail -n 40 "${LOG_FILE}" >&2 || true
    exit 1
  fi
  echo "Host UI started pid=$(cat "${PID_FILE}")"
fi

BASE="http://127.0.0.1:${HOST_UI_PORT}"
echo ""
echo "== URLs =="
echo "  Host UI:     ${BASE}/"
echo "  Health:      ${BASE}/api/host/health"
echo "  Chat:        POST ${BASE}/api/host/chat"
echo "  Host state:  ${BASE}/api/host/state"
echo "  Audit:       ${BASE}/api/host/audit"
echo "  LLM mode:    ${LLM_MODE}"
echo ""
echo "Logs: ${LOG_FILE}"
echo "Stop: kill \$(cat ${PID_FILE})"
