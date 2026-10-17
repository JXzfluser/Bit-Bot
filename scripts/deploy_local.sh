#!/usr/bin/env bash
# Deploy Bit Bot Host product runtime on this machine: kill old → start → health → smoke chat.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.moon/bin:${PATH}"
HOST_UI_PORT="${HOST_UI_PORT:-8765}"
PID_FILE="${BITBOT_HOST_PID_FILE:-/tmp/bitbot-host-ui.pid}"
LOG_FILE="${BITBOT_HOST_LOG:-/tmp/bitbot-host-ui.log}"
BASE="http://127.0.0.1:${HOST_UI_PORT}"

cd "${ROOT}"

mkdir -p \
  "${ROOT}/data/chats" \
  "${ROOT}/data/memory" \
  "${ROOT}/data/journal" \
  "${ROOT}/data/routines" \
  "${ROOT}/data/connectors" \
  "${ROOT}/data/audit" \
  /tmp/bitbot-sandbox

echo "== deploy_local: stop old Host UI =="
if [[ -f "${PID_FILE}" ]]; then
  old="$(cat "${PID_FILE}" || true)"
  if [[ -n "${old}" ]] && kill -0 "${old}" 2>/dev/null; then
    kill "${old}" 2>/dev/null || true
    sleep 0.3
    kill -9 "${old}" 2>/dev/null || true
  fi
  rm -f "${PID_FILE}"
fi
# Also clear stray listener on the port (same product surface only)
if command -v ss >/dev/null 2>&1; then
  pid_on_port="$(ss -ltnp "sport = :${HOST_UI_PORT}" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true)"
  if [[ -n "${pid_on_port}" ]]; then
    kill "${pid_on_port}" 2>/dev/null || true
    sleep 0.2
  fi
fi

echo "== deploy_local: start =="
bash "${ROOT}/scripts/start-bitbot.sh"

echo "== deploy_local: healthcheck =="
ok=0
for i in $(seq 1 30); do
  if curl -fsS "${BASE}/api/host/health" >/tmp/bitbot-health.json 2>/dev/null; then
    ok=1
    break
  fi
  sleep 0.2
done
if [[ "${ok}" != "1" ]]; then
  echo "FAIL: healthcheck ${BASE}/api/host/health" >&2
  tail -n 40 "${LOG_FILE}" >&2 || true
  exit 1
fi
python3 - <<'PY'
import json
h=json.load(open("/tmp/bitbot-health.json"))
assert h.get("ok") is True, h
print("health ok llm_mode=", h.get("llm_mode"), "runtime=", h.get("runtime"))
PY

echo "== deploy_local: smoke chat (Shell echo) =="
curl -fsS -X POST "${BASE}/api/host/chat" \
  -H 'Content-Type: application/json' \
  -d '{"agent_id":"demo-agent","text":"用 Shell 执行 echo bitbot-live 并告诉我结果"}' \
  >/tmp/bitbot-smoke-chat.json

python3 - <<'PY'
import json, sys
d=json.load(open("/tmp/bitbot-smoke-chat.json"))
text=d.get("assistant_text") or ""
tools=d.get("tool_calls") or []
print("llm_mode=", d.get("llm_mode"))
print("assistant_excerpt=", text[:400].replace("\n"," "))
shell_ok=any(t.get("tool")=="Shell" and t.get("ok") and "bitbot-live" in (t.get("output") or "") for t in tools)
if "bitbot-live" not in text and not shell_ok:
    print("FAIL: expected real echo output bitbot-live", file=sys.stderr)
    print(json.dumps(d, indent=2)[:2000], file=sys.stderr)
    sys.exit(1)
if not shell_ok and "bitbot-live" not in text:
    sys.exit(1)
print("smoke chat PASS (bitbot-live observed)")
PY

echo "== deploy_local: chats on disk =="
ls -la "${ROOT}/data/chats/" || true
echo "OK deploy_local complete → ${BASE}/"
