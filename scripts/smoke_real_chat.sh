#!/usr/bin/env bash
# Product Host smoke: Shell, ListDir, memory set/get, WebFetch example.com.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST_UI_PORT="${HOST_UI_PORT:-8765}"
BASE="http://127.0.0.1:${HOST_UI_PORT}"
AGENT="${BITBOT_SMOKE_AGENT:-smoke-real-chat}"
OUT_DIR="${BITBOT_SMOKE_OUT:-/tmp/bitbot-smoke-real}"
mkdir -p "${OUT_DIR}"
export BITBOT_SMOKE_OUT="${OUT_DIR}"
export BITBOT_SMOKE_AGENT="${AGENT}"

fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== smoke_real_chat: health =="
curl -fsS "${BASE}/api/host/health" >"${OUT_DIR}/health.json" \
  || fail "health unreachable at ${BASE}/api/host/health (run deploy_local.sh first)"
python3 - <<PY
import json, os
h=json.load(open(os.environ["BITBOT_SMOKE_OUT"] + "/health.json"))
assert h.get("ok") is True, h
print("health ok llm_mode=", h.get("llm_mode"))
PY

chat() {
  local label="$1" out="$2"
  local text="$3"
  echo "== smoke: ${label} =="
  python3 - "$BASE" "$AGENT" "$OUT_DIR" "$out" "$text" <<'PY'
import json, os, sys, urllib.request
base, agent, out_dir, name, text = sys.argv[1:6]
req = urllib.request.Request(
    base.rstrip("/") + "/api/host/chat",
    data=json.dumps({"agent_id": agent, "text": text}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=60) as resp:
    body = resp.read()
path = os.path.join(out_dir, name + ".json")
open(path, "wb").write(body)
print("wrote", path, "bytes", len(body))
PY
}

chat "shell" "shell" "用 Shell 执行 echo bitbot-live 并告诉我结果"
python3 - <<'PY'
import json, os, sys
d=json.load(open(os.environ["BITBOT_SMOKE_OUT"] + "/shell.json"))
text=d.get("assistant_text") or ""
tools=d.get("tool_calls") or []
shell_ok=any(t.get("tool")=="Shell" and t.get("ok") and "bitbot-live" in (t.get("output") or "") for t in tools)
if not shell_ok and "bitbot-live" not in text:
    print("FAIL shell", json.dumps(d,indent=2)[:2000], file=sys.stderr); sys.exit(1)
print("PASS shell bitbot-live llm_mode=", d.get("llm_mode"))
PY

chat "listdir" "listdir" "ListDir /workspace/scripts/bitbot_runtime"
python3 - <<'PY'
import json, os, sys
d=json.load(open(os.environ["BITBOT_SMOKE_OUT"] + "/listdir.json"))
text=d.get("assistant_text") or ""
tools=d.get("tool_calls") or []
ok=any(t.get("tool")=="ListDir" and t.get("ok") and "llm.py" in (t.get("output") or "") for t in tools)
if not ok and "llm.py" not in text:
    print("FAIL listdir", text[:800], file=sys.stderr); sys.exit(1)
print("PASS listdir llm.py present")
PY

chat "memory_set" "memory_set" "记住我叫SmokeAda"
python3 - <<'PY'
import json, os, sys
d=json.load(open(os.environ["BITBOT_SMOKE_OUT"] + "/memory_set.json"))
text=d.get("assistant_text") or ""
tools=d.get("tool_calls") or []
ok=any(t.get("tool")=="MemoryUpdate" and t.get("ok") for t in tools)
if not ok and "SmokeAda" not in text:
    print("FAIL memory_set", text[:800], file=sys.stderr); sys.exit(1)
print("PASS memory_set")
PY

chat "memory_get" "memory_get" "我叫什么"
python3 - <<'PY'
import json, os, sys
d=json.load(open(os.environ["BITBOT_SMOKE_OUT"] + "/memory_get.json"))
text=d.get("assistant_text") or ""
tools=d.get("tool_calls") or []
ok=any(t.get("tool")=="MemoryRecall" and t.get("ok") and "SmokeAda" in (t.get("output") or "") for t in tools)
if not ok and "SmokeAda" not in text:
    print("FAIL memory_get", text[:800], file=sys.stderr); sys.exit(1)
print("PASS memory_get SmokeAda")
PY

curl -fsS -X POST "${BASE}/api/host/memory/recall" \
  -H 'Content-Type: application/json' \
  -d "{\"agent_id\":\"${AGENT}\"}" >"${OUT_DIR}/memory_api.json"
python3 - <<'PY'
import json, os, sys
d=json.load(open(os.environ["BITBOT_SMOKE_OUT"] + "/memory_api.json"))
prof=(d.get("memory") or {}).get("profile") or {}
if prof.get("name")!="SmokeAda":
    print("FAIL memory API profile", d, file=sys.stderr); sys.exit(1)
print("PASS memory API round-trip name=SmokeAda")
PY

chat "webfetch" "webfetch" "fetch https://example.com and summarize"
python3 - <<'PY'
import json, os, sys
d=json.load(open(os.environ["BITBOT_SMOKE_OUT"] + "/webfetch.json"))
text=d.get("assistant_text") or ""
tools=d.get("tool_calls") or []
fetch_ok=any(t.get("tool")=="WebFetch" and t.get("ok") for t in tools)
blob=" ".join([(t.get("output") or "") for t in tools]) + " " + text
has_ex = "Example Domain" in blob or "example" in blob.lower()
sum_ok=any(t.get("tool")=="Summarize" and t.get("ok") for t in tools)
if not fetch_ok:
    print("FAIL webfetch tool", text[:1000], file=sys.stderr); sys.exit(1)
if not has_ex:
    print("FAIL webfetch content missing Example Domain", blob[:1000], file=sys.stderr); sys.exit(1)
print("PASS webfetch example.com", "summarize=" + str(sum_ok))
PY

echo "== smoke: connectors/status =="
curl -fsS -X POST "${BASE}/api/host/connectors/status" \
  -H 'Content-Type: application/json' \
  -d '{}' >"${OUT_DIR}/connectors.json"
python3 - <<'PY'
import json, os, sys
d=json.load(open(os.environ["BITBOT_SMOKE_OUT"] + "/connectors.json"))
assert d.get("ok") is True, d
c=d.get("connectors") or {}
for name in ("slack","gmail","outlook"):
    assert name in c, c
    assert "live" in c[name] and "sandbox" in c[name], c[name]
print("PASS connectors/status", {k: {"live": v.get("live"), "mode": v.get("mode")} for k,v in c.items()})
PY

echo "== smoke: Host honesty on chat artifacts =="
python3 - <<'PY'
import json, os, re
out = os.environ["BITBOT_SMOKE_OUT"]
for name in ("shell", "listdir", "memory_set", "memory_get", "webfetch"):
    path = os.path.join(out, name + ".json")
    raw = open(path).read()
    # Never claim pretend_live in product chat payloads.
    assert '"pretend_live": true' not in raw and '"pretend_live":true' not in raw, name
    d = json.loads(raw)
    for h in d.get("host_results") or []:
        try:
            p = json.loads(h.get("stdout") or "{}")
        except Exception:
            p = {}
        assert p.get("pretend_live") is not True, (name, h.get("kind"), p)
        assert p.get("pretend_sent") is not True, (name, h.get("kind"), p)
        assert p.get("pretend_fetched") is not True, (name, h.get("kind"), p)
print("PASS chat Host honesty (no pretend_live/sent/fetched)")
PY

echo "OK smoke_real_chat all PASS → ${OUT_DIR}/"
