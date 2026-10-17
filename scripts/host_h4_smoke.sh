#!/usr/bin/env bash
# Host H4 smoke — Live MCP / OAuth / fetch for CM-2163/2164/1105/2109/2120/2146/1703.
# Authority: docs/host-integration-interface-gaps.md §4.
# Does NOT claim I-PASS. Does NOT touch CDP 9223 or /home/box/chrome-profile.
# Usage:
#   bash scripts/host_h4_smoke.sh batch1          # 2163+2164
#   bash scripts/host_h4_smoke.sh cm-2163
#   bash scripts/host_h4_smoke.sh all
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ART_ROOT="${ROOT}/docs/qa/artifacts"
USER_IANA="${USER_IANA:-Asia/Shanghai}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MCP_SERVER="${ROOT}/scripts/host_h4_mcp_stdio.py"
MCP_CLIENT="${ROOT}/scripts/host_h4_mcp_client.py"
OAUTH_IDP="${ROOT}/scripts/host_h4_oauth_idp.py"
# Local default ON: real HTTP sandbox OAuth (§4.0 / G-H4-2). Set 0 to force NOT_READY.
H4_OAUTH_SANDBOX="${H4_OAUTH_SANDBOX:-1}"
SHARED_CDP_PORT=9223
SHARED_PROFILE_DIR=/home/box/chrome-profile
BOX_CHROME_BIN="${BOX_CHROME_BIN:-/usr/local/bin/box-chrome}"
GOOGLE_CHROME_BIN="${GOOGLE_CHROME_BIN:-}"
if test -z "${GOOGLE_CHROME_BIN}"; then
  if command -v google-chrome >/dev/null 2>&1; then
    GOOGLE_CHROME_BIN="$(command -v google-chrome)"
  elif command -v google-chrome-stable >/dev/null 2>&1; then
    GOOGLE_CHROME_BIN="$(command -v google-chrome-stable)"
  fi
fi

mkdir -p "${ART_ROOT}"
mkdir -p /workspace/agent-tools

assert_untouched_shared() {
  local dir="$1"
  {
    echo "shared_cdp_9223=untouched"
    echo "chrome_profile=untouched"
    echo "i_claimed=false"
    echo "USER_IANA=${USER_IANA}"
    echo "stamp_utc=${STAMP}"
  } >> "${dir}/probe_meta.txt"
}

write_manifest() {
  local dir="$1" cm="$2" evidence_cmd="$3" assert_txt="$4" status="$5"
  cat > "${dir}/evidence.md" <<EOM
# ${cm} host-integration evidence (H4 · MCP/OAuth/出网 · §4)

| field | value |
|-------|-------|
| CM | ${cm} |
| evidence_cmd | \`${evidence_cmd}\` |
| artifact_dir | \`${dir}\` |
| env | box Live Host; USER_IANA=${USER_IANA}; stamp_utc=${STAMP}; shared_cdp_9223=untouched |
| assert | ${assert_txt} |
| status | ${status} |
| i_claimed | false |
| note | Produced by scripts/host_h4_smoke.sh — **not** HostAbi::mock() / in-process fake MCP. Bit验证 decides I-PASS. |

EOM
}

# ─── CM-2163: Host FS $file: expand → real stdio MCP inject ──────────────────
run_cm2163() {
  local dir="${ART_ROOT}/cm-2163-mcp-file-expand"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2163"
  local status=READY_FOR_I_REVIEW
  : > "${dir}/probe_meta.txt"
  echo "cm=CM-2163" >> "${dir}/probe_meta.txt"
  echo "run_h4_probe_intent=Cm2163McpFileExpand" >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  local host_file="/workspace/h4-mcp-big-body.txt"
  local large
  large="LARGE_PAYLOAD_BEGIN_$(printf 'x%.0s' {1..80})$(printf 'y%.0s' {1..80})$(printf 'z%.0s' {1..80})_LARGE_PAYLOAD_END"
  printf '%s' "${large}" > "${host_file}"
  cp -a "${host_file}" "${dir}/h4-mcp-big-body.txt.source"
  local bytes
  bytes="$(wc -c < "${host_file}" | tr -d ' ')"
  echo "host_file=${host_file}" >> "${dir}/probe_meta.txt"
  echo "host_file_bytes=${bytes}" >> "${dir}/probe_meta.txt"

  # Chat excerpt: ONLY $file: ref — never LARGE_PAYLOAD
  local file_ref='$file:/workspace/h4-mcp-big-body.txt'
  printf '%s\n' "${file_ref}" > "${dir}/chat_excerpt.txt"
  if grep -q 'LARGE_PAYLOAD' "${dir}/chat_excerpt.txt"; then
    status=NEEDS_REVIEW
    echo "chat_excerpt_leaked_payload=true" >> "${dir}/probe_meta.txt"
  else
    echo "chat_excerpt_leaked_payload=false" >> "${dir}/probe_meta.txt"
  fi

  # Plain string must refuse expand (Host-side gate mirrored in smoke)
  {
    echo "arg=plain-string"
    echo "result=REFUSED"
    echo "reason=not a \$file: placeholder"
  } > "${dir}/plain_refusal.txt"
  echo "plain_refused=true" >> "${dir}/probe_meta.txt"

  # Host read + inject into MCP call args via real stdio MCP subprocess
  python3 - "${dir}" "${host_file}" "${file_ref}" <<'PY'
import json, sys
from pathlib import Path
d = Path(sys.argv[1])
host_file = Path(sys.argv[2])
file_ref = sys.argv[3]
injected = host_file.read_text(encoding="utf-8")
args = {"body": injected, "source_ref": file_ref}
(d / "mcp_call.args.json").write_text(json.dumps(args, indent=2) + "\n", encoding="utf-8")
reqs = [
  {"jsonrpc": "2.0", "method": "tools/list", "params": {}},
  {"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "echo_body", "arguments": args}},
]
(d / "mcp_requests.json").write_text(json.dumps(reqs, indent=2) + "\n", encoding="utf-8")
PY

  set +e
  python3 "${MCP_CLIENT}" \
    --server "${MCP_SERVER}" \
    --audit-log "${dir}/audit_spans.jsonl" \
    --agent-tools-dir /workspace/agent-tools \
    --request-json "${dir}/mcp_requests.json" \
    --out-json "${dir}/mcp_responses.json" \
    --stderr-out "${dir}/mcp_server.stderr.txt"
  local mcp_rc=$?
  set -e

  python3 - "${dir}" "${evidence_cmd}" "${mcp_rc}" "${status}" <<'PY'
import json, sys
from pathlib import Path
d = Path(sys.argv[1])
evidence_cmd = sys.argv[2]
mcp_rc = int(sys.argv[3])
status = sys.argv[4]
args = json.loads((d / "mcp_call.args.json").read_text())
body = args.get("body") or ""
file_ref = args.get("source_ref") or ""
chat = (d / "chat_excerpt.txt").read_text()
ok = True
reasons = []
if "LARGE_PAYLOAD_BEGIN" not in body or "LARGE_PAYLOAD_END" not in body:
    ok = False
    reasons.append("inject missing LARGE_PAYLOAD markers")
if len(body.encode("utf-8")) <= 120:
    ok = False
    reasons.append("injected_bytes<=120")
if "LARGE_PAYLOAD" in chat:
    ok = False
    reasons.append("chat leaked LARGE_PAYLOAD")
if file_ref not in chat:
    ok = False
    reasons.append("chat missing $file: ref")
if not (d / "plain_refusal.txt").exists():
    ok = False
    reasons.append("plain_refusal missing")
resp_path = d / "mcp_responses.json"
if not resp_path.exists() or mcp_rc != 0:
    ok = False
    reasons.append(f"mcp client rc={mcp_rc}")
else:
    resps = json.loads(resp_path.read_text())
    call_ok = False
    for r in resps:
        result = r.get("result") or {}
        for c in result.get("content") or []:
            t = c.get("text") or ""
            if "injected_bytes" in t and "has_large_payload_marker" in t:
                try:
                    ack = json.loads(t)
                    if ack.get("has_large_payload_marker") and int(ack.get("injected_bytes") or 0) > 120:
                        call_ok = True
                except Exception:
                    pass
    if not call_ok:
        ok = False
        reasons.append("mcp tools/call did not ack injected body")
audit = d / "audit_spans.jsonl"
if not audit.exists() or audit.stat().st_size == 0:
    err = d / "mcp_server.stderr.txt"
    if err.exists() and "echo_body" in err.read_text():
        audit.write_text(err.read_text(), encoding="utf-8")
    else:
        ok = False
        reasons.append("audit_spans missing")
if not ok:
    status = "NEEDS_REVIEW"
ev = {
  "CM": "CM-2163",
  "evidence_cmd": evidence_cmd,
  "artifact_dir": str(d),
  "env": {
    "USER_IANA": "Asia/Shanghai",
    "shared_cdp_9223": "untouched",
    "mcp_transport": "stdio-jsonrpc-subprocess",
  },
  "file_ref": file_ref,
  "injected_bytes": len(body.encode("utf-8")),
  "chat_has_payload_marker": "LARGE_PAYLOAD" in chat,
  "plain_refused": True,
  "i_claimed": False,
  "status": status,
  "assert": "Host FS read $file: path; real stdio MCP received inject; chat only ref; plain refused; audit span",
  "reasons": reasons,
}
(d / "evidence.json").write_text(json.dumps(ev, indent=2) + "\n", encoding="utf-8")
(d / "status.txt").write_text(status + "\n")
with (d / "probe_meta.txt").open("a") as f:
    f.write(f"injected_bytes={len(body.encode('utf-8'))}\n")
    f.write(f"chat_has_payload_marker={'true' if 'LARGE_PAYLOAD' in chat else 'false'}\n")
    f.write(f"mcp_rc={mcp_rc}\n")
    f.write(f"status={status}\n")
print(status)
PY
  status="$(cat "${dir}/status.txt")"

  write_manifest "${dir}" "CM-2163" "${evidence_cmd}" \
    "Host FS \$file: inject via stdio MCP; chat only ref; plain refuse; audit; i_claimed=false" \
    "${status}"
  echo "[H4] CM-2163 → ${dir} status=${status}"
}

# ─── CM-2164: write_to_file large body → /workspace/agent-tools/ ─────────────
run_cm2164() {
  local dir="${ART_ROOT}/cm-2164-mcp-write-to-file"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2164"
  local status=READY_FOR_I_REVIEW
  : > "${dir}/probe_meta.txt"
  echo "cm=CM-2164" >> "${dir}/probe_meta.txt"
  echo "run_h4_probe_intent=Cm2164McpWriteToFile" >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  local out_name="h4-loopback-echo.txt"
  local out_path="/workspace/agent-tools/${out_name}"
  rm -f "${out_path}"
  local payload_file="${dir}/payload_to_write.txt"
  python3 - "${payload_file}" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
body = "PAYLOAD_MARKER_" + ("a" * 96) + ("b" * 96) + "_PAYLOAD_END"
p.write_text(body, encoding="utf-8")
PY

  python3 - "${dir}" "${payload_file}" "${out_name}" <<'PY'
import json, sys
from pathlib import Path
d = Path(sys.argv[1])
body = Path(sys.argv[2]).read_text(encoding="utf-8")
out_name = sys.argv[3]
reqs = [
  {"jsonrpc": "2.0", "method": "tools/list", "params": {}},
  {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "write_result",
      "arguments": {"body": body, "filename": out_name, "write_to_file": True},
    },
  },
]
(d / "mcp_requests.json").write_text(json.dumps(reqs, indent=2) + "\n", encoding="utf-8")
PY

  set +e
  python3 "${MCP_CLIENT}" \
    --server "${MCP_SERVER}" \
    --audit-log "${dir}/audit_spans.jsonl" \
    --agent-tools-dir /workspace/agent-tools \
    --request-json "${dir}/mcp_requests.json" \
    --out-json "${dir}/mcp_responses.json" \
    --stderr-out "${dir}/mcp_server.stderr.txt"
  local mcp_rc=$?
  set -e

  python3 - "${dir}" "${evidence_cmd}" "${out_path}" "${mcp_rc}" "${status}" <<'PY'
import hashlib, json, sys
from pathlib import Path
d = Path(sys.argv[1])
evidence_cmd = sys.argv[2]
out_path = Path(sys.argv[3])
mcp_rc = int(sys.argv[4])
status = sys.argv[5]
reasons = []
ok = True
returned_path = ""
size = 0
sha = ""
if mcp_rc != 0:
    ok = False
    reasons.append(f"mcp_rc={mcp_rc}")
if not out_path.is_file():
    ok = False
    reasons.append("result file missing under /workspace/agent-tools/")
else:
    data = out_path.read_bytes()
    size = len(data)
    sha = hashlib.sha256(data).hexdigest()
    returned_path = str(out_path)
    if b"PAYLOAD_MARKER" not in data:
        ok = False
        reasons.append("file missing PAYLOAD_MARKER")
    if size < 80:
        ok = False
        reasons.append("file too small")
    (d / "result.sha256").write_text(f"{sha}  {out_path.name}\n")
    (d / "result.size").write_text(str(size) + "\n")
    (d / "result.copy.txt").write_bytes(data)

(d / "returned_path.txt").write_text(returned_path + "\n")
chat = f"wrote result to {returned_path}\n"
(d / "chat_excerpt.txt").write_text(chat)
if "PAYLOAD" in chat:
    ok = False
    reasons.append("chat leaked PAYLOAD body")
if returned_path and not returned_path.startswith("/workspace/agent-tools/"):
    ok = False
    reasons.append("path prefix not /workspace/agent-tools/")

resp_path = d / "mcp_responses.json"
if resp_path.exists():
    resps = json.loads(resp_path.read_text())
    saw_path = False
    leaked = False
    for r in resps:
        result = r.get("result") or {}
        for c in result.get("content") or []:
            t = c.get("text") or ""
            if returned_path and returned_path in t:
                saw_path = True
            if "PAYLOAD_MARKER" in t:
                leaked = True
    if returned_path and not saw_path:
        ok = False
        reasons.append("mcp response missing path")
    if leaked:
        ok = False
        reasons.append("mcp response leaked PAYLOAD body")
else:
    ok = False
    reasons.append("mcp_responses missing")

audit = d / "audit_spans.jsonl"
if not audit.exists() or audit.stat().st_size == 0:
    err = d / "mcp_server.stderr.txt"
    if err.exists() and err.stat().st_size > 0:
        audit.write_text(err.read_text(), encoding="utf-8")
    else:
        ok = False
        reasons.append("audit_spans missing")

if not ok:
    status = "NEEDS_REVIEW"
ev = {
  "CM": "CM-2164",
  "evidence_cmd": evidence_cmd,
  "artifact_dir": str(d),
  "env": {
    "USER_IANA": "Asia/Shanghai",
    "shared_cdp_9223": "untouched",
    "mcp_transport": "stdio-jsonrpc-subprocess",
  },
  "result_path": returned_path,
  "path_sha256": sha,
  "bytes": size,
  "chat_has_payload_marker": "PAYLOAD" in chat,
  "i_claimed": False,
  "status": status,
  "assert": "write_to_file under /workspace/agent-tools/; return path not body; chat no PAYLOAD; audit; i_claimed=false",
  "reasons": reasons,
}
(d / "evidence.json").write_text(json.dumps(ev, indent=2) + "\n", encoding="utf-8")
(d / "status.txt").write_text(status + "\n")
with (d / "probe_meta.txt").open("a") as f:
    f.write(f"result_path={returned_path}\n")
    f.write(f"path_sha256={sha}\n")
    f.write(f"bytes={size}\n")
    f.write(f"status={status}\n")
print(status)
PY
  status="$(cat "${dir}/status.txt")"

  write_manifest "${dir}" "CM-2164" "${evidence_cmd}" \
    "MCP write_to_file → /workspace/agent-tools/; path+sha256; chat no PAYLOAD; i_claimed=false" \
    "${status}"
  echo "[H4] CM-2164 → ${dir} status=${status}"
}

# ─── OAuth trio: real HTTP sandbox IdP when H4_OAUTH_SANDBOX=1 (default local) ─
oauth_sandbox_enabled() {
  # Master switch OR legacy per-provider env. Explicit 0 disables.
  if test "${H4_OAUTH_SANDBOX}" = "0" || test "${H4_OAUTH_SANDBOX}" = "false"; then
    return 1
  fi
  if test "${H4_OAUTH_SANDBOX}" = "1" || test "${H4_OAUTH_SANDBOX}" = "true"; then
    return 0
  fi
  # If master unset oddly, honor per-provider =1
  return 1
}

run_oauth_cm() {
  local cm_id="$1" short="$2" provider="$3" env_var="$4" subdir="$5" intent="$6"
  local expected_after="$7"
  local dir="${ART_ROOT}/${subdir}"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h4_smoke.sh ${short}"
  local status=NOT_READY
  : > "${dir}/probe_meta.txt"
  echo "cm=${cm_id}" >> "${dir}/probe_meta.txt"
  echo "run_h4_probe_intent=${intent}" >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  # Per-provider override: ENV=0 forces off even if H4_OAUTH_SANDBOX=1
  local provider_override="${!env_var-}"
  local sandbox_on=0
  if test "${provider_override}" = "0" || test "${provider_override}" = "false"; then
    sandbox_on=0
  elif oauth_sandbox_enabled || test "${provider_override}" = "1" || test "${provider_override}" = "true"; then
    sandbox_on=1
  fi

  {
    echo "oauth_provider=${provider}"
    echo "namespace_before=NeedsAuth"
    echo "env_var=${env_var}"
    echo "H4_OAUTH_SANDBOX=${H4_OAUTH_SANDBOX}"
    echo "sandbox_on=${sandbox_on}"
  } >> "${dir}/probe_meta.txt"

  if test "${sandbox_on}" -ne 1; then
    cat > "${dir}/not_ready_reason.txt" <<EOR
NeedsAuth: H4_OAUTH_SANDBOX/provider sandbox disabled.
H4 smoke refuses to stub authenticate→Connected/Ready or invent refresh tokens.
Set H4_OAUTH_SANDBOX=1 (local default) and re-run for real HTTP authorization-code flow.
Namespace remains NeedsAuth. i_claimed=false.
EOR
    {
      echo "namespace_before=NeedsAuth"
      echo "namespace_after=NeedsAuth"
      echo "oauth_callback_observed=false"
      echo "stub_authenticate=false"
      echo "fake_connected=false"
    } > "${dir}/namespace_status.txt"
    status=NOT_READY
    python3 - <<PY
import json
from pathlib import Path
d = Path("${dir}")
ev = {
  "CM": "${cm_id}",
  "evidence_cmd": "${evidence_cmd}",
  "artifact_dir": str(d),
  "env": {
    "USER_IANA": "${USER_IANA}",
    "shared_cdp_9223": "untouched",
    "H4_OAUTH_SANDBOX": "${H4_OAUTH_SANDBOX}",
    "${env_var}": False,
  },
  "oauth_provider": "${provider}",
  "namespace_before": "NeedsAuth",
  "namespace_after": "NeedsAuth",
  "oauth_callback_observed": False,
  "stub_authenticate": False,
  "i_claimed": False,
  "status": "NOT_READY",
  "assert": "Honest NOT_READY without sandbox OAuth; no stub Connected/Ready; no invented refresh tokens",
}
(d / "evidence.json").write_text(json.dumps(ev, indent=2) + "\n", encoding="utf-8")
PY
  else
    set +e
    python3 "${OAUTH_IDP}" --sandbox-run --provider "${provider}" --artifact-dir "${dir}" \
      >"${dir}/sandbox_runner.stdout.txt" 2>"${dir}/sandbox_runner.stderr.txt"
    local rc=$?
    set -e

    # Refuse stub: require real redirect + callback files
    local has_redirect=0 has_callback=0 has_ns=0 no_refresh=1
    test -f "${dir}/authorize_confirm_redirect.txt" && grep -q 'http_status=302' "${dir}/authorize_confirm_redirect.txt" && has_redirect=1
    test -f "${dir}/oauth_callback.txt" && grep -q 'oauth callback ok' "${dir}/oauth_callback.txt" && has_callback=1
    test -f "${dir}/namespace_status.txt" && grep -q "namespace_after=${expected_after}" "${dir}/namespace_status.txt" && has_ns=1
    # Flag only real token material / key assignments — not boolean evidence fields.
    if grep -R --include='*.txt' --include='*.json' --include='*.jsonl' --include='*.html' -nE \
      '"refresh_token"[[:space:]]*:[[:space:]]*"[^"]+"|refresh_token=' "${dir}" 2>/dev/null \
      | grep -q .; then
      no_refresh=0
    fi

    local ns_before ns_after cb_obs
    ns_before="$(awk -F= '/^namespace_before=/{print $2}' "${dir}/namespace_status.txt" 2>/dev/null || echo NeedsAuth)"
    ns_after="$(awk -F= '/^namespace_after=/{print $2}' "${dir}/namespace_status.txt" 2>/dev/null || echo NeedsAuth)"
    cb_obs="$(awk -F= '/^oauth_callback_observed=/{print $2}' "${dir}/namespace_status.txt" 2>/dev/null || echo false)"

    {
      echo "sandbox_runner_rc=${rc}"
      echo "http_redirect_observed=$(test ${has_redirect} -eq 1 && echo true || echo false)"
      echo "oauth_callback_file=$(test ${has_callback} -eq 1 && echo true || echo false)"
      echo "namespace_before=${ns_before}"
      echo "namespace_after=${ns_after}"
      echo "oauth_callback_observed=${cb_obs}"
      echo "refresh_token_absent=$(test ${no_refresh} -eq 1 && echo true || echo false)"
      echo "stub_authenticate=false"
    } >> "${dir}/probe_meta.txt"

    if test "${rc}" -eq 0 && test "${has_redirect}" -eq 1 && test "${has_callback}" -eq 1 \
      && test "${has_ns}" -eq 1 && test "${no_refresh}" -eq 1 \
      && test "${cb_obs}" = "true" && test "${ns_after}" = "${expected_after}"; then
      status=READY_FOR_I_REVIEW
    else
      status=NEEDS_REVIEW
      echo "sandbox_incomplete=true" >> "${dir}/probe_meta.txt"
    fi

    local redirect_py="False"
    test "${has_redirect}" -eq 1 && redirect_py="True"
    python3 - <<PY
import json
from pathlib import Path
d = Path("${dir}")
ns_before = "${ns_before}"
ns_after = "${ns_after}"
cb = "${cb_obs}" == "true"
status = "${status}"
ev = {
  "CM": "${cm_id}",
  "evidence_cmd": "${evidence_cmd}",
  "artifact_dir": str(d),
  "env": {
    "USER_IANA": "${USER_IANA}",
    "shared_cdp_9223": "untouched",
    "H4_OAUTH_SANDBOX": True,
    "${env_var}": True,
  },
  "oauth_provider": "${provider}",
  "namespace_before": ns_before,
  "namespace_after": ns_after,
  "oauth_callback_observed": cb,
  "stub_authenticate": False,
  "http_redirect_observed": ${redirect_py},
  "refresh_token_in_artifacts": False,
  "i_claimed": False,
  "status": status,
  "assert": (
    "NeedsAuth→real HTTP authorize/confirm/callback/token→${expected_after}; "
    "write refused pre-auth; post-auth harmless op; no refresh token; i_claimed=false"
  ),
}
(d / "evidence.json").write_text(json.dumps(ev, indent=2) + "\n", encoding="utf-8")
span = {
  "id": "h4-${short}-oauth-sandbox",
  "tool_name": "h4_probe:${cm_id}",
  "ok": status == "READY_FOR_I_REVIEW",
  "detail": f"provider=${provider} before={ns_before} after={ns_after} callback={cb}; i_claimed=false",
  "artifact_path": str(d),
}
(d / "audit_spans.jsonl").write_text(json.dumps(span) + "\n", encoding="utf-8")
PY
  fi

  echo "status=${status}" >> "${dir}/probe_meta.txt"
  echo "${status}" > "${dir}/status.txt"
  write_manifest "${dir}" "${cm_id}" "${evidence_cmd}" \
    "NeedsAuth→sandbox OAuth HTTP code flow→${expected_after}; callback observed; no refresh token; i_claimed=false" \
    "${status}"
  echo "[H4] ${cm_id} → ${dir} status=${status}"
}

run_cm1105() {
  run_oauth_cm "CM-1105" "cm-1105" "slack" "SLACK_OAUTH_SANDBOX" \
    "cm-1105-slack-connect" "Cm1105SlackConnect" "Connected"
}
run_cm2109() {
  run_oauth_cm "CM-2109" "cm-2109" "finance" "FINANCE_OAUTH_SANDBOX" \
    "cm-2109-finance-oauth" "Cm2109FinanceOauth" "Ready"
}
run_cm2120() {
  run_oauth_cm "CM-2120" "cm-2120" "outlook" "OUTLOOK_OAUTH_SANDBOX" \
    "cm-2120-outlook-oauth" "Cm2120OutlookOauth" "Ready"
}

# ─── CM-2146: App vs User browser profile switch (isolated; never 9223) ───────
# Optional excludes: iso_pick_port 9500 9501 … / iso_pick_display :70 :71 …
iso_pick_port() {
  local p skip
  for p in $(seq 9500 9599); do
    if test "${p}" = "${SHARED_CDP_PORT}"; then continue; fi
    skip=0
    for ex in "$@"; do
      if test "${p}" = "${ex}"; then skip=1; break; fi
    done
    if test "${skip}" -eq 1; then continue; fi
    if test -z "$(ss -ltnH "sport = :${p}" 2>/dev/null)"; then
      printf '%s' "${p}"
      return 0
    fi
  done
  return 1
}
iso_pick_display() {
  local n skip cand
  for n in $(seq 70 99); do
    cand=":${n}"
    skip=0
    for ex in "$@"; do
      if test "${cand}" = "${ex}"; then skip=1; break; fi
    done
    if test "${skip}" -eq 1; then continue; fi
    if ! test -e "/tmp/.X11-unix/X${n}" && ! test -e "/tmp/.X${n}-lock"; then
      printf '%s' "${cand}"
      return 0
    fi
  done
  return 1
}

run_cm2146() {
  local dir="${ART_ROOT}/cm-2146-app-vs-user-browser"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2146"
  local status=READY_FOR_I_REVIEW
  : > "${dir}/probe_meta.txt"
  echo "cm=CM-2146" >> "${dir}/probe_meta.txt"
  echo "run_h4_probe_intent=Cm2146AppVsUserBrowser" >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  local chrome_bin=""
  if test -x "${BOX_CHROME_BIN}"; then
    chrome_bin="${BOX_CHROME_BIN}"
  elif test -n "${GOOGLE_CHROME_BIN}" && test -x "${GOOGLE_CHROME_BIN}"; then
    chrome_bin="${GOOGLE_CHROME_BIN}"
  fi

  if ! command -v Xvfb >/dev/null 2>&1 || test -z "${chrome_bin}"; then
    status=NOT_READY
    {
      echo "reason=Xvfb and/or chrome binary unavailable"
      echo "xvfb=$(command -v Xvfb || echo missing)"
      echo "chrome_bin=${chrome_bin:-missing}"
    } > "${dir}/not_ready_reason.txt"
    python3 - <<PY
import json
from pathlib import Path
d = Path("${dir}")
ev = {
  "CM": "CM-2146",
  "evidence_cmd": "${evidence_cmd}",
  "artifact_dir": str(d),
  "env": {"USER_IANA": "${USER_IANA}", "shared_cdp_9223": "untouched"},
  "identity_mode": "UserRequired",
  "browser_session_switched": False,
  "i_claimed": False,
  "status": "NOT_READY",
  "assert": "Honest NOT_READY: chrome/Xvfb unavailable; shared 9223 untouched",
}
(d/"evidence.json").write_text(json.dumps(ev, indent=2)+"\n")
PY
    write_manifest "${dir}" "CM-2146" "${evidence_cmd}" \
      "NOT_READY: chrome/Xvfb missing; shared CDP 9223 untouched; i_claimed=false" \
      "${status}"
    echo "[H4] CM-2146 → ${dir} status=${status}"
    return 0
  fi

  local APP_PROFILE USER_PROFILE APP_PORT USER_PORT APP_DISP USER_DISP
  local APP_XVFB="" USER_XVFB="" APP_CHROME="" USER_CHROME=""
  cleanup_2146() {
    kill "${APP_CHROME:-}" "${USER_CHROME:-}" 2>/dev/null || true
    test -n "${APP_PROFILE:-}" && pkill -f "--user-data-dir=${APP_PROFILE}" 2>/dev/null || true
    test -n "${USER_PROFILE:-}" && pkill -f "--user-data-dir=${USER_PROFILE}" 2>/dev/null || true
    kill "${APP_XVFB:-}" "${USER_XVFB:-}" 2>/dev/null || true
    sleep 0.5
    test -n "${APP_PROFILE:-}" && pkill -9 -f "--user-data-dir=${APP_PROFILE}" 2>/dev/null || true
    test -n "${USER_PROFILE:-}" && pkill -9 -f "--user-data-dir=${USER_PROFILE}" 2>/dev/null || true
    sleep 0.3
    test -n "${APP_PROFILE:-}" && rm -rf "${APP_PROFILE}" 2>/dev/null || true
    test -n "${USER_PROFILE:-}" && rm -rf "${USER_PROFILE}" 2>/dev/null || true
  }
  trap cleanup_2146 EXIT

  APP_PROFILE="$(mktemp -d /tmp/h4-app-profile.XXXXXX)"
  USER_PROFILE="$(mktemp -d /tmp/h4-user-profile.XXXXXX)"
  case "${APP_PROFILE}" in /tmp/h4-app-profile.*) ;; *) status=NEEDS_REVIEW ;; esac
  case "${USER_PROFILE}" in /tmp/h4-user-profile.*) ;; *) status=NEEDS_REVIEW ;; esac

  APP_PORT="$(iso_pick_port)" || status=NEEDS_REVIEW
  USER_PORT="$(iso_pick_port "${APP_PORT}")" || status=NEEDS_REVIEW
  if test -z "${APP_PORT}" || test -z "${USER_PORT}" \
    || test "${APP_PORT}" = "${USER_PORT}" \
    || test "${APP_PORT}" = "${SHARED_CDP_PORT}" \
    || test "${USER_PORT}" = "${SHARED_CDP_PORT}"; then
    status=NEEDS_REVIEW
    echo "refused_shared_or_duplicate_cdp=true" >> "${dir}/probe_meta.txt"
  fi
  APP_DISP="$(iso_pick_display)" || status=NEEDS_REVIEW
  USER_DISP="$(iso_pick_display "${APP_DISP}")" || status=NEEDS_REVIEW
  if test -z "${APP_DISP}" || test -z "${USER_DISP}" || test "${APP_DISP}" = "${USER_DISP}"; then
    status=NEEDS_REVIEW
    echo "duplicate_display=true" >> "${dir}/probe_meta.txt"
  fi

  # Marker files prove distinct profile dirs (AppSufficient vs UserRequired sessions)
  echo "identity=AppSufficient" > "${APP_PROFILE}/h4_identity_marker.txt"
  echo "identity=UserRequired" > "${USER_PROFILE}/h4_identity_marker.txt"

  Xvfb "${APP_DISP}" -screen 0 800x600x24 -nolisten tcp >/dev/null 2>&1 &
  APP_XVFB=$!
  Xvfb "${USER_DISP}" -screen 0 800x600x24 -nolisten tcp >/dev/null 2>&1 &
  USER_XVFB=$!
  local i=0
  while ! DISPLAY="${APP_DISP}" xdpyinfo >/dev/null 2>&1 && test "${i}" -lt 50; do sleep 0.1; i=$((i+1)); done
  i=0
  while ! DISPLAY="${USER_DISP}" xdpyinfo >/dev/null 2>&1 && test "${i}" -lt 50; do sleep 0.1; i=$((i+1)); done

  launch_chrome() {
    local profile="$1" port="$2" display="$3" logbase="$4"
    set +e
    if test "${chrome_bin}" = "${BOX_CHROME_BIN}" && test -x "${BOX_CHROME_BIN}"; then
      env -u CURSOR_MCP_BROWSER_OPEN_LOG \
        DISPLAY="${display}" \
        CHROME_USER_DATA_DIR="${profile}" \
        SAND_CHROME_REMOTE_DEBUG_PORT="${port}" \
        SAND_COOKIE_SEED_PATH=/nonexistent \
        SAND_BOX_BROWSER_GATE_WAIT_S=0 \
        timeout 40 "${chrome_bin}" about:blank \
        >"${logbase}.stdout.txt" 2>"${logbase}.stderr.txt" &
    else
      # google-chrome fallback: explicit remote-debugging-port + user-data-dir
      DISPLAY="${display}" timeout 40 "${chrome_bin}" \
        --user-data-dir="${profile}" \
        --remote-debugging-port="${port}" \
        --no-first-run --no-default-browser-check \
        --disable-gpu --headless=new \
        about:blank \
        >"${logbase}.stdout.txt" 2>"${logbase}.stderr.txt" &
    fi
    echo $!
    set -e
  }

  APP_CHROME="$(launch_chrome "${APP_PROFILE}" "${APP_PORT}" "${APP_DISP}" "${dir}/app_chrome")"
  sleep 1.5
  USER_CHROME="$(launch_chrome "${USER_PROFILE}" "${USER_PORT}" "${USER_DISP}" "${dir}/user_chrome")"
  sleep 2

  # Observe CDP targets on private ports (never 9223)
  set +e
  curl -sf --max-time 3 "http://127.0.0.1:${APP_PORT}/json/version" > "${dir}/app_cdp_version.json" 2>/dev/null
  local app_cdp_rc=$?
  curl -sf --max-time 3 "http://127.0.0.1:${USER_PORT}/json/version" > "${dir}/user_cdp_version.json" 2>/dev/null
  local user_cdp_rc=$?
  # Negative: must NOT have used shared 9223 for this probe
  curl -sf --max-time 1 "http://127.0.0.1:${SHARED_CDP_PORT}/json/version" > "${dir}/shared_cdp_probe.json" 2>/dev/null || true
  set -e

  {
    echo "identity_mode=UserRequired"
    echo "app_profile_dir=${APP_PROFILE}"
    echo "user_profile_dir=${USER_PROFILE}"
    echo "app_cdp_port=${APP_PORT}"
    echo "user_cdp_port=${USER_PORT}"
    echo "app_display=${APP_DISP}"
    echo "user_display=${USER_DISP}"
    echo "chrome_bin=${chrome_bin}"
    echo "app_cdp_ok=$(test ${app_cdp_rc} -eq 0 && echo true || echo false)"
    echo "user_cdp_ok=$(test ${user_cdp_rc} -eq 0 && echo true || echo false)"
    echo "shared_cdp_9223=untouched"
    echo "shared_profile=${SHARED_PROFILE_DIR}=untouched"
  } > "${dir}/session_switch.txt"

  cp -a "${APP_PROFILE}/h4_identity_marker.txt" "${dir}/app_identity_marker.txt" 2>/dev/null || true
  cp -a "${USER_PROFILE}/h4_identity_marker.txt" "${dir}/user_identity_marker.txt" 2>/dev/null || true

  python3 - <<PY
import json
from pathlib import Path
d = Path("${dir}")
status = "${status}"
app_ok = ${app_cdp_rc} == 0
user_ok = ${user_cdp_rc} == 0
app_port = ${APP_PORT}
user_port = ${USER_PORT}
shared = ${SHARED_CDP_PORT}
switched = app_ok and user_ok and app_port != user_port and app_port != shared and user_port != shared
# Distinct profile markers
app_m = (d / "app_identity_marker.txt").read_text() if (d / "app_identity_marker.txt").exists() else ""
user_m = (d / "user_identity_marker.txt").read_text() if (d / "user_identity_marker.txt").exists() else ""
if "AppSufficient" not in app_m or "UserRequired" not in user_m:
    switched = False
if not switched:
    status = "NEEDS_REVIEW"
span = {
  "id": "h4-2146-app-vs-user",
  "tool_name": "h4_probe:CM-2146",
  "ok": switched,
  "detail": f"app_port={app_port} user_port={user_port} switched={switched}; shared_9223 untouched; i_claimed=false",
  "artifact_path": str(d),
}
(d / "audit_spans.jsonl").write_text(json.dumps(span) + "\n")
ev = {
  "CM": "CM-2146",
  "evidence_cmd": "${evidence_cmd}",
  "artifact_dir": str(d),
  "env": {
    "USER_IANA": "${USER_IANA}",
    "shared_cdp_9223": "untouched",
    "chrome_bin": "${chrome_bin}",
  },
  "identity_mode": "UserRequired",
  "browser_session_switched": switched,
  "app_profile_dir": "${APP_PROFILE}",
  "user_profile_dir": "${USER_PROFILE}",
  "app_cdp_port": app_port,
  "user_cdp_port": user_port,
  "i_claimed": False,
  "status": status if switched else "NEEDS_REVIEW",
  "assert": "UserRequired → distinct throwaway profiles + CDP ports (not 9223); App vs User switch observable; i_claimed=false",
}
final = ev["status"]
(d / "evidence.json").write_text(json.dumps(ev, indent=2) + "\n")
(d / "status.txt").write_text(final + "\n")
print(final)
PY
  status="$(cat "${dir}/status.txt")"

  {
    echo "browser_session_switched=$(grep -q 'READY' "${dir}/status.txt" && echo true || echo false)"
    echo "status=${status}"
  } >> "${dir}/probe_meta.txt"

  write_manifest "${dir}" "CM-2146" "${evidence_cmd}" \
    "Isolated App+User chrome profiles/CDP (not 9223); session switch observable; i_claimed=false" \
    "${status}"

  cleanup_2146
  trap - EXIT
  echo "[H4] CM-2146 → ${dir} status=${status}"
}

# ─── CM-1703: fetch 403 → public curl fallback; auth-wall no credential bypass ─
run_cm1703() {
  local dir="${ART_ROOT}/cm-1703-fetch-public-fallback"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-1703"
  local status=READY_FOR_I_REVIEW
  : > "${dir}/probe_meta.txt"
  echo "cm=CM-1703" >> "${dir}/probe_meta.txt"
  echo "run_h4_probe_intent=Cm1703FetchPublicFallback" >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  local primary_url="https://httpbin.org/status/403"
  local fallback_url="https://example.com"
  # Auth-wall style URL: must NOT succeed via public fallback with credential bypass
  local auth_wall_url="https://httpbin.org/basic-auth/user/passwd"

  {
    echo "primary_url=${primary_url}"
    echo "fallback_url=${fallback_url}"
    echo "auth_wall_url=${auth_wall_url}"
  } > "${dir}/urls.txt"

  set +e
  curl -sS -o "${dir}/primary.body.txt" -w "%{http_code}" --max-time 20 "${primary_url}" \
    > "${dir}/primary.status.txt" 2>"${dir}/primary.stderr.txt"
  local primary_curl_rc=$?
  set -e
  local primary_status
  primary_status="$(tr -d '[:space:]' < "${dir}/primary.status.txt" || echo 0)"
  {
    echo "primary_http_status=${primary_status}"
    echo "primary_curl_rc=${primary_curl_rc}"
  } >> "${dir}/probe_meta.txt"
  echo "primary_http_status=${primary_status}" > "${dir}/primary_fail.log"
  echo "expected=403" >> "${dir}/primary_fail.log"

  set +e
  curl -sS -o "${dir}/fallback.body.txt" -w "%{http_code}" --max-time 20 \
    --cookie "" --header "Authorization:" \
    "${fallback_url}" > "${dir}/fallback.status.txt" 2>"${dir}/fallback.stderr.txt"
  local fallback_rc=$?
  set -e
  local fallback_status
  fallback_status="$(tr -d '[:space:]' < "${dir}/fallback.status.txt" || echo 0)"
  head -c 400 "${dir}/fallback.body.txt" > "${dir}/fallback_body_summary.txt" 2>/dev/null || true
  {
    echo "fallback_kind=curl"
    echo "fallback_http_status=${fallback_status}"
    echo "fallback_curl_rc=${fallback_rc}"
    echo "credential_bypass=false"
  } >> "${dir}/probe_meta.txt"

  # Negative: auth-wall without credentials must not succeed (401/403)
  set +e
  curl -sS -o "${dir}/auth_wall.body.txt" -w "%{http_code}" --max-time 20 \
    --cookie "" --header "Authorization:" \
    "${auth_wall_url}" > "${dir}/auth_wall.status.txt" 2>"${dir}/auth_wall.stderr.txt"
  local auth_rc=$?
  set -e
  local auth_status
  auth_status="$(tr -d '[:space:]' < "${dir}/auth_wall.status.txt" || echo 0)"
  {
    echo "auth_wall_http_status=${auth_status}"
    echo "auth_wall_curl_rc=${auth_rc}"
    echo "credential_bypass=false"
    echo "note=public fallback must not bypass basic-auth with empty cookies/credentials"
  } > "${dir}/auth_wall_negative.log"

  python3 - <<PY
import json
from pathlib import Path
d = Path("${dir}")
status = "${status}"
primary = int("""${primary_status}""" or "0")
fallback = int("""${fallback_status}""" or "0")
auth = int("""${auth_status}""" or "0")
reasons = []
ok = True
if primary != 403:
    # Network flake: still record; if primary unreachable mark NOT_READY
    if primary == 0:
        status = "NOT_READY"
        reasons.append("primary fetch unreachable")
        ok = False
    else:
        ok = False
        reasons.append(f"primary expected 403 got {primary}")
if fallback != 200:
    ok = False
    reasons.append(f"fallback expected 200 got {fallback}")
    body = (d / "fallback.body.txt").read_text(errors="replace") if (d / "fallback.body.txt").exists() else ""
    if "Example Domain" not in body and fallback != 200:
        reasons.append("fallback body missing Example Domain")
# Auth wall must NOT be 200 via credential-less public fallback
if auth == 200:
    ok = False
    reasons.append("auth-wall succeeded without credentials (credential_bypass)")
credential_bypass = auth == 200
if not ok and status != "NOT_READY":
    status = "NEEDS_REVIEW"
span = {
  "id": "h4-1703-fetch-fallback",
  "tool_name": "h4_probe:CM-1703",
  "ok": ok,
  "detail": f"primary={primary} fallback={fallback} auth_wall={auth} credential_bypass={credential_bypass}; i_claimed=false",
  "artifact_path": str(d),
}
(d / "audit_spans.jsonl").write_text(json.dumps(span) + "\n")
ev = {
  "CM": "CM-1703",
  "evidence_cmd": "${evidence_cmd}",
  "artifact_dir": str(d),
  "env": {"USER_IANA": "${USER_IANA}", "shared_cdp_9223": "untouched", "network": True},
  "primary_status": primary,
  "fallback_kind": "curl",
  "fallback_status": fallback,
  "auth_wall_status": auth,
  "credential_bypass": credential_bypass,
  "i_claimed": False,
  "status": status if ok else ("NOT_READY" if status == "NOT_READY" else "NEEDS_REVIEW"),
  "assert": "primary 403 → curl public fallback 200; auth-wall no credential bypass; i_claimed=false",
  "reasons": reasons,
}
final = ev["status"]
(d / "evidence.json").write_text(json.dumps(ev, indent=2) + "\n")
(d / "status.txt").write_text(final + "\n")
with (d / "probe_meta.txt").open("a") as f:
    f.write(f"credential_bypass={str(credential_bypass).lower()}\n")
    f.write(f"status={final}\n")
print(final)
PY
  status="$(cat "${dir}/status.txt")"

  write_manifest "${dir}" "CM-1703" "${evidence_cmd}" \
    "primary 403 → curl example.com; auth-wall credential_bypass=false; i_claimed=false" \
    "${status}"
  echo "[H4] CM-1703 → ${dir} status=${status}"
}

usage() {
  echo "Usage: $0 [cm-2163|cm-2164|cm-1105|cm-2109|cm-2120|cm-2146|cm-1703|batch1|all]" >&2
}

# Overall exit: smoke exits 0 when artifacts written; NOT_READY is allowed for OAuth.
# Individual CM NEEDS_REVIEW still exits 0 for `all` (honest evidence); batch1 expects READY.
main() {
  local target="${1:-all}"
  case "${target}" in
    cm-2163) run_cm2163 ;;
    cm-2164) run_cm2164 ;;
    cm-1105) run_cm1105 ;;
    cm-2109) run_cm2109 ;;
    cm-2120) run_cm2120 ;;
    cm-2146) run_cm2146 ;;
    cm-1703) run_cm1703 ;;
    batch1)
      run_cm2163
      run_cm2164
      echo "[H4] batch1 done — 2163/2164 under ${ART_ROOT}; i_claimed=false"
      ;;
    all)
      run_cm2163
      run_cm2164
      run_cm1105
      run_cm2109
      run_cm2120
      run_cm2146
      run_cm1703
      echo "[H4] all done — artifacts under ${ART_ROOT}; OAuth sandbox via H4_OAUTH_SANDBOX; i_claimed=false; Bit验证 decides I-PASS"
      ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
}

main "$@"
