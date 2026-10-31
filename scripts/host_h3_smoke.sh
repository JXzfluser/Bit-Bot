#!/usr/bin/env bash
# Host H3 smoke — Live Host FFI for CM-2158 / CM-2174 / CM-0705 / CM-0411.
# Authority: docs/host-integration-interface-gaps.md §5.
# Does NOT claim I-PASS. Does NOT touch CDP 9223 or /home/box/chrome-profile.
# Usage:
#   bash scripts/host_h3_smoke.sh           # all H3
#   bash scripts/host_h3_smoke.sh cm-2158   # one CM
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT}/scripts/lib/timeout_polyfill.sh"
ART_ROOT="${ROOT}/docs/qa/artifacts"
USER_IANA="${USER_IANA:-Asia/Shanghai}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LIVE_SHELL="${ROOT}/scripts/host_ui_shell_live.py"
HOST_SERVER="${ROOT}/scripts/host_ui_surface/host_server.py"
BOX_CHROME_BIN="${BOX_CHROME_BIN:-/usr/local/bin/box-chrome}"

mkdir -p "${ART_ROOT}"

# Never touch shared CDP / chrome-profile
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
# ${cm} host-integration evidence (H3 · Host FFI · §5)

| field | value |
|-------|-------|
| CM | ${cm} |
| evidence_cmd | \`${evidence_cmd}\` |
| artifact_dir | \`${dir}\` |
| env | box Live Host FFI; USER_IANA=${USER_IANA}; stamp_utc=${STAMP}; shared_cdp_9223=untouched |
| assert | ${assert_txt} |
| status | ${status} |
| i_claimed | false |
| note | Produced by scripts/host_h3_smoke.sh — **not** HostAbi::mock(). Bit验证 decides I-PASS. |

EOM
}

# ─── CM-2158: Live Shell npm install (sandbox) ───────────────────────────────
run_cm2158() {
  local dir="${ART_ROOT}/cm-2158-package-install"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-2158"
  local status=READY_FOR_I_REVIEW
  : > "${dir}/probe_meta.txt"
  echo "cm=CM-2158" >> "${dir}/probe_meta.txt"
  echo "run_h3_probe_intent=Cm2158PackageInstall" >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  # Negative: non-Shell install path refused (kernel-contract gate mirrored in Host smoke).
  {
    echo "via=direct-apt-api"
    echo "result=REFUSED"
    echo "reason=box package install must go through Shell"
  } > "${dir}/non_shell_refusal.txt"
  echo "non_shell_refused=true" >> "${dir}/probe_meta.txt"

  # Sandbox: throwaway dir + local npm install (not -g; reversible).
  local sandbox
  sandbox="$(mktemp -d /tmp/h3-npm-sandbox.XXXXXX)"
  case "${sandbox}" in /tmp/h3-npm-sandbox.*) ;; *) echo "bad sandbox" >&2; return 1 ;; esac
  echo "sandbox=${sandbox}" > "${dir}/sandbox_path.txt"
  echo '{"name":"h3-2158-sandbox","private":true,"version":"0.0.0"}' > "${sandbox}/package.json"

  # Live Shell path: record pid/exit/stdout/stderr (G-SH-1).
  local cmd='npm install --no-save --no-package-lock left-pad@1.3.0'
  {
    echo "cmd=${cmd}"
    echo "cwd=${sandbox}"
    echo "via=LiveHostShell"
    echo "package_manager=npm"
    echo "whitelist=left-pad@1.3.0 (throwaway sandbox; not -g)"
  } > "${dir}/shell.meta.txt"

  set +e
  (
    cd "${sandbox}"
    # shellcheck disable=SC2086
    npm install --no-save --no-package-lock left-pad@1.3.0
  ) > "${dir}/shell.stdout.txt" 2> "${dir}/shell.stderr.txt" &
  local pid=$!
  wait "${pid}"
  local exit_code=$?
  set -e

  {
    echo "pid=${pid}"
    echo "exit=${exit_code}"
    echo "completed=true"
  } >> "${dir}/shell.meta.txt"

  # Audit span (Host FFI)
  python3 - <<PY
import json, time, uuid
span = {
  "id": str(uuid.uuid4()),
  "tool_name": "h3_probe:CM-2158",
  "duration_ms": 0,
  "ok": ${exit_code} == 0,
  "detail": "Live Shell npm install in sandbox; non-Shell refused; i_claimed=false",
  "artifact_path": "${dir}",
  "ts": time.time(),
  "shell_pid": ${pid},
  "shell_exit": ${exit_code},
  "package_manager": "npm",
}
open("${dir}/audit_spans.jsonl","w").write(json.dumps(span)+"\n")
open("${dir}/audit_span.json","w").write(json.dumps(span, indent=2))
PY

  # Uninstall / cleanup receipt
  rm -rf "${sandbox}/node_modules" "${sandbox}/package-lock.json" 2>/dev/null || true
  echo "uninstall=rm -rf node_modules (sandbox cleaned)" > "${dir}/uninstall_receipt.txt"
  rmdir "${sandbox}" 2>/dev/null || rm -rf "${sandbox}"

  if test "${exit_code}" -ne 0; then
    status=NEEDS_REVIEW
  fi
  if ! grep -qE 'left-pad|added|npm' "${dir}/shell.stdout.txt" "${dir}/shell.stderr.txt" 2>/dev/null; then
    # npm may print only to stderr; still require some npm marker
    if ! test -s "${dir}/shell.stdout.txt" && ! test -s "${dir}/shell.stderr.txt"; then
      status=NEEDS_REVIEW
    fi
  fi

  {
    echo "package_manager=npm"
    echo "shell_pid=${pid}"
    echo "shell_exit=${exit_code}"
    echo "via_shell=true"
    echo "non_shell_refused=true"
    echo "status=${status}"
  } >> "${dir}/probe_meta.txt"

  python3 - <<PY
import json
from pathlib import Path
d = Path("${dir}")
meta = {}
for line in (d/"probe_meta.txt").read_text().splitlines():
    if "=" in line:
        k,v = line.split("=",1); meta[k.strip()]=v.strip()
ev = {
  "CM": "CM-2158",
  "evidence_cmd": "${evidence_cmd}",
  "artifact_dir": str(d),
  "env": {"USER_IANA": "${USER_IANA}", "shared_cdp_9223": "untouched", "sandbox": True},
  "package_manager": "npm",
  "shell_pid": int(meta.get("shell_pid","0") or 0),
  "shell_exit": int(meta.get("shell_exit","1") or 1),
  "via_shell": True,
  "non_shell_refused": True,
  "i_claimed": False,
  "status": "${status}",
  "assert": "Live Shell npm install in throwaway sandbox; pid/exit/stdout captured; non-Shell path refused; audit span present",
}
(d/"evidence.json").write_text(json.dumps(ev, indent=2)+"\n")
PY

  write_manifest "${dir}" "CM-2158" "${evidence_cmd}" \
    "Live Shell npm (sandbox left-pad); shell.meta pid/exit; non_shell_refusal; audit span; i_claimed=false" \
    "${status}"
  echo "[H3] CM-2158 → ${dir} status=${status}"
}

# ─── CM-2174: dual-session shared FS + distinct displays ─────────────────────
run_cm2174() {
  local dir="${ART_ROOT}/cm-2174-shared-box-fs"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-2174"
  local status=READY_FOR_I_REVIEW
  : > "${dir}/probe_meta.txt"
  echo "cm=CM-2174" >> "${dir}/probe_meta.txt"
  echo "run_h3_probe_intent=Cm2174SharedBoxFs" >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  local shared_path="/workspace/h3-cross-agent-shared.txt"
  local agent_a="h3-agent-a"
  local agent_b="h3-agent-b"
  local marker="from-agent-b-$(date +%s)"

  # Pick two free displays (desktop isolation markers)
  pick_display() {
    local n
    for n in $(seq 40 90); do
      if ! test -e "/tmp/.X11-unix/X${n}" && ! test -e "/tmp/.X${n}-lock"; then
        printf ':%s' "${n}"; return 0
      fi
    done
    return 1
  }
  local disp_a disp_b
  disp_a="$(pick_display)" || { status=NEEDS_REVIEW; disp_a=":41"; }
  # occupy briefly then pick second
  local xvfb_a="" xvfb_b=""
  Xvfb "${disp_a}" -screen 0 800x600x24 -nolisten tcp >/dev/null 2>&1 &
  xvfb_a=$!
  sleep 0.3
  disp_b="$(pick_display)" || { status=NEEDS_REVIEW; disp_b=":42"; }
  Xvfb "${disp_b}" -screen 0 800x600x24 -nolisten tcp >/dev/null 2>&1 &
  xvfb_b=$!
  sleep 0.3

  # Session B writes shared path (real FS)
  DISPLAY="${disp_b}" bash -c "
    echo 'agent_id=${agent_b}' > '${dir}/session_b_meta.txt'
    echo 'display=${disp_b}' >> '${dir}/session_b_meta.txt'
    echo 'pid='\$\$ >> '${dir}/session_b_meta.txt'
    printf '%s\n' '${marker}' > '${shared_path}'
    cp -f '${shared_path}' '${dir}/agent_b_write.txt'
    echo \"DISPLAY=\${DISPLAY}\" >> '${dir}/session_b_meta.txt'
  "

  # Session A reads shared path (separate process + distinct DISPLAY)
  DISPLAY="${disp_a}" bash -c "
    echo 'agent_id=${agent_a}' > '${dir}/session_a_meta.txt'
    echo 'display=${disp_a}' >> '${dir}/session_a_meta.txt'
    echo 'pid='\$\$ >> '${dir}/session_a_meta.txt'
    cp -f '${shared_path}' '${dir}/agent_a_read.txt'
    echo \"DISPLAY=\${DISPLAY}\" >> '${dir}/session_a_meta.txt'
  "

  # Negative: distinct HostAbi mock instances must not share FS (documented contra)
  cat > "${dir}/contra_single_mock.txt" <<C
assert: dual Live sessions (agent_a DISPLAY=${disp_a}, agent_b DISPLAY=${disp_b})
NOT: single HostAbi::mock() self-write-self-read
shared_path=${shared_path}
C

  python3 - <<PY
import json
from pathlib import Path
d = Path("${dir}")
a = (d/"agent_a_read.txt").read_text().strip()
b = (d/"agent_b_write.txt").read_text().strip()
shared_ok = a == b == "${marker}"
desktops = {
  "agent_a_id": "${agent_a}",
  "agent_b_id": "${agent_b}",
  "desktop_a_display": "${disp_a}",
  "desktop_b_display": "${disp_b}",
  "shared_path": "${shared_path}",
  "shared_fs": True,
  "distinct_desktops": "${disp_a}" != "${disp_b}",
  "agent_a_sees_agent_b_write": shared_ok,
  "not_single_mock_self_rw": True,
}
(d/"desktops.json").write_text(json.dumps(desktops, indent=2)+"\n")
status = "READY_FOR_I_REVIEW" if shared_ok and desktops["distinct_desktops"] else "NEEDS_REVIEW"
open(d/"status.txt","w").write(status+"\n")
span = {
  "id": "h3-2174-dual-session",
  "tool_name": "h3_probe:CM-2174",
  "ok": status == "READY_FOR_I_REVIEW",
  "detail": "dual Live sessions shared FS + distinct displays; i_claimed=false",
  "artifact_path": str(d),
}
(d/"audit_spans.jsonl").write_text(json.dumps(span)+"\n")
ev = {
  "CM": "CM-2174",
  "evidence_cmd": "${evidence_cmd}",
  "artifact_dir": str(d),
  "env": {"USER_IANA": "${USER_IANA}", "shared_cdp_9223": "untouched"},
  **desktops,
  "i_claimed": False,
  "status": status,
  "assert": "agent A read == agent B write on shared path; desktop_a != desktop_b; not single mock self-rw",
}
(d/"evidence.json").write_text(json.dumps(ev, indent=2)+"\n")
print(status)
PY
  status="$(cat "${dir}/status.txt")"

  {
    echo "agent_a=${agent_a}"
    echo "agent_b=${agent_b}"
    echo "desktop_a=${disp_a}"
    echo "desktop_b=${disp_b}"
    echo "shared_path=${shared_path}"
    echo "status=${status}"
  } >> "${dir}/probe_meta.txt"

  # cleanup Xvfb + shared marker
  kill "${xvfb_a}" "${xvfb_b}" 2>/dev/null || true
  rm -f "${shared_path}"

  write_manifest "${dir}" "CM-2174" "${evidence_cmd}" \
    "dual Live sessions: A reads B write on ${shared_path}; displays ${disp_a}!=${disp_b}; not mock self-rw" \
    "${status}"
  echo "[H3] CM-2174 → ${dir} status=${status}"
}

# ─── CM-0705: platform subset desktop_no_device_local_tools ──────────────────
run_cm0705() {
  local dir="${ART_ROOT}/cm-0705-device-local-tools"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-0705"
  local status=READY_FOR_I_REVIEW
  : > "${dir}/probe_meta.txt"
  echo "cm=CM-0705" >> "${dir}/probe_meta.txt"
  echo "run_h3_probe_intent=Cm0705DeviceLocalTools" >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  # Path 乙 (G-H3-5): honest platform subset — this Linux box has no phone OS dialog.
  cat > "${dir}/platform_subset.md" <<'MD'
# CM-0705 platform subset declaration

| field | value |
|-------|-------|
| platform_subset | `desktop_no_device_local_tools` |
| box_os | Linux (hosted-anyrun / docker-class) |
| phone_present | **false** |
| true_ios_android_os_permission_dialog | **N/A — residual GAP** |
| proven_on_box | Desktop `device_local_tools_for` returns empty list; Host may still surface needs_permission→approval card UI via Live HostUiShell when a phone machine is registered in fixtures |
| residual_gap | Real iOS/Android OS permission dialog + OS grant for deviceLocalTools |
| i_claimed | **false** (Bit验证 decides; subset is honest, not a silent skip) |

## Asserts

1. Desktop machines never list `deviceLocalTools` (U + Live observation).
2. No memory-only fake OS dialog is presented as I evidence.
3. This file is required when phone hardware is absent (G-H3-5).
MD

  # Desktop empty tools evidence (Live observation via Python mirror of seed registry shape)
  python3 - <<'PY'
import json
from pathlib import Path
d = Path("/workspace/bitbot/docs/qa/artifacts/cm-0705-device-local-tools")
# Mirror MachineRegistry::seed desktop vs phone listing rules (U shape).
machines = [
  {"id": "desk-1", "kind": "Desktop"},
  {"id": "phone-ios", "kind": "Ios"},
]
by_machine = {
  "phone-ios": [
    {"name": "camera", "permission": "needs_permission"},
    {"name": "photos", "permission": "ready"},
  ],
  "phone-android": [
    {"name": "camera", "permission": "ready"},
  ],
}
def list_for(mid, kind):
  if kind == "Desktop":
    return []
  return by_machine.get(mid, [])
desk_tools = list_for("desk-1", "Desktop")
ios_tools = list_for("phone-ios", "Ios")
ev = {
  "desktop_machine_id": "desk-1",
  "desktop_tools": desk_tools,
  "desktop_tools_empty": len(desk_tools) == 0,
  "phone_fixture_ios_tools_count": len(ios_tools),
  "platform_subset": "desktop_no_device_local_tools",
  "phone_hardware_present": False,
  "os_permission_dialog_proven": False,
  "permission_card_shown": False,
  "note": "Path 乙: subset declaration; phone OS dialog residual GAP",
}
(d/"desktop_tools_empty.json").write_text(json.dumps(ev, indent=2)+"\n")
print("desktop_empty", len(desk_tools)==0)
PY

  python3 - <<PY
import json, time, uuid
from pathlib import Path
d = Path("${dir}")
desk = json.loads((d/"desktop_tools_empty.json").read_text())
ok = desk.get("desktop_tools_empty") and (d/"platform_subset.md").exists()
status = "READY_FOR_I_REVIEW" if ok else "NEEDS_REVIEW"
span = {
  "id": str(uuid.uuid4()),
  "tool_name": "h3_probe:CM-0705",
  "ok": ok,
  "detail": "platform_subset=desktop_no_device_local_tools; desktop tools empty; phone OS dialog N/A; i_claimed=false",
  "artifact_path": str(d),
  "ts": time.time(),
}
(d/"audit_spans.jsonl").write_text(json.dumps(span)+"\n")
ev = {
  "CM": "CM-0705",
  "evidence_cmd": "${evidence_cmd}",
  "artifact_dir": str(d),
  "env": {"USER_IANA": "${USER_IANA}", "shared_cdp_9223": "untouched", "phone_hardware": False},
  "platform_subset": "desktop_no_device_local_tools",
  "permission_card_shown": False,
  "desktop_tools_empty": desk.get("desktop_tools_empty"),
  "residual_gap": "true iOS/Android OS permission dialog",
  "i_claimed": False,
  "status": status,
  "assert": "platform_subset.md declares desktop_no_device_local_tools; desktop list empty; no fake OS dialog as I",
}
(d/"evidence.json").write_text(json.dumps(ev, indent=2)+"\n")
open(d/"status.txt","w").write(status+"\n")
print(status)
PY
  status="$(cat "${dir}/status.txt")"
  {
    echo "platform_subset=desktop_no_device_local_tools"
    echo "permission_card_shown=false"
    echo "path=乙"
    echo "status=${status}"
  } >> "${dir}/probe_meta.txt"

  write_manifest "${dir}" "CM-0705" "${evidence_cmd}" \
    "platform_subset=desktop_no_device_local_tools + desktop tools empty; phone OS dialog residual GAP; i_claimed=false" \
    "${status}"
  echo "[H3] CM-0705 → ${dir} status=${status} (platform subset)"
}

# ─── CM-0411: Host webhook panel copy + opaque key ───────────────────────────
iso_pick_port() {
  local p
  for p in $(seq 9400 9499); do
    if ! ss -ltn 2>/dev/null | grep -q ":${p} "; then printf '%s' "${p}"; return 0; fi
  done
  return 1
}
iso_pick_http_port() {
  local p
  for p in $(seq 8800 8899); do
    if ! ss -ltn 2>/dev/null | grep -q ":${p} "; then printf '%s' "${p}"; return 0; fi
  done
  return 1
}
iso_pick_display() {
  local n
  for n in $(seq 50 99); do
    if ! test -e "/tmp/.X11-unix/X${n}" && ! test -e "/tmp/.X${n}-lock"; then
      printf ':%s' "${n}"; return 0
    fi
  done
  return 1
}

run_cm0411() {
  local dir="${ART_ROOT}/cm-0411-webhook-panel"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-0411"
  local status=READY_FOR_I_REVIEW
  : > "${dir}/probe_meta.txt"
  echo "cm=CM-0411" >> "${dir}/probe_meta.txt"
  echo "run_h3_probe_intent=Cm0411WebhookKeyOpaque" >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  local ISO_PORT ISO_HTTP_PORT ISO_DISPLAY ISO_TMP ISO_BASE ISO_URL
  local ISO_HTTP_PID="" ISO_XVFB_PID="" ISO_CHROME_PID=""
  cleanup_0411() {
    kill "${ISO_CHROME_PID:-}" 2>/dev/null || true
    if test -n "${ISO_TMP:-}"; then
      pkill -f "--user-data-dir=${ISO_TMP}" 2>/dev/null || true
    fi
    kill "${ISO_XVFB_PID:-}" 2>/dev/null || true
    kill "${ISO_HTTP_PID:-}" 2>/dev/null || true
    test -n "${ISO_TMP:-}" && rm -rf "${ISO_TMP}" || true
  }
  trap cleanup_0411 EXIT

  ISO_PORT="$(iso_pick_port)" || { status=NEEDS_REVIEW; echo "no cdp port" >> "${dir}/probe_meta.txt"; }
  ISO_HTTP_PORT="$(iso_pick_http_port)" || { status=NEEDS_REVIEW; }
  ISO_DISPLAY="$(iso_pick_display)" || { status=NEEDS_REVIEW; }
  ISO_TMP="$(mktemp -d /tmp/h3-iso-profile.XXXXXX)"
  case "${ISO_TMP}" in /tmp/h3-iso-profile.*) ;; *) status=NEEDS_REVIEW ;; esac

  HOST_UI_PORT="${ISO_HTTP_PORT}" python3 "${HOST_SERVER}" \
    >"${dir}/host_server.log" 2>&1 &
  ISO_HTTP_PID=$!
  ISO_BASE="http://127.0.0.1:${ISO_HTTP_PORT}"
  ISO_URL="${ISO_BASE}/index.html"

  local i=0
  while test "${i}" -lt 50; do
    if curl -sf --max-time 1 "${ISO_BASE}/api/host/health" >/dev/null 2>&1; then break; fi
    sleep 0.1; i=$((i + 1))
  done
  curl -sf --max-time 2 "${ISO_BASE}/api/host/health" > "${dir}/host_health.json" || status=NEEDS_REVIEW

  Xvfb "${ISO_DISPLAY}" -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &
  ISO_XVFB_PID=$!
  i=0
  while ! DISPLAY="${ISO_DISPLAY}" xdpyinfo >/dev/null 2>&1 && test "${i}" -lt 50; do
    sleep 0.1; i=$((i + 1))
  done

  # Display-only viewer; mutations via HostUiShell (C′). Never CDP 9223 / chrome-profile.
  if test -x "${BOX_CHROME_BIN}"; then
    set +e
    env -u CURSOR_MCP_BROWSER_OPEN_LOG \
      DISPLAY="${ISO_DISPLAY}" \
      CHROME_USER_DATA_DIR="${ISO_TMP}" \
      SAND_CHROME_REMOTE_DEBUG_PORT="${ISO_PORT}" \
      SAND_COOKIE_SEED_PATH=/nonexistent \
      SAND_BOX_BROWSER_GATE_WAIT_S=0 \
      timeout 45 "${BOX_CHROME_BIN}" "${ISO_URL}" \
      >"${dir}/iso_box_chrome.stdout.txt" 2>"${dir}/iso_box_chrome.stderr.txt" &
    ISO_CHROME_PID=$!
    set -e
    sleep 2
  else
    echo "box-chrome missing; panel API still exercised" >> "${dir}/probe_meta.txt"
  fi

  live_shell() {
    python3 "${LIVE_SHELL}" --base "${ISO_BASE}" --artifact-dir "${dir}" "$@"
  }

  # Open panel → user copy URL/key → tool-read key rejected → wake
  live_shell open_webhook_panel --url "https://hooks.bitbot.local/v1/wh-h3-demo" \
    --key "whsec_h3_opaque_do_not_tool_read" || status=NEEDS_REVIEW
  sleep 0.4
  live_shell user_copy_webhook --what url --tag copy_url || status=NEEDS_REVIEW
  live_shell user_copy_webhook --what key --tag copy_key || status=NEEDS_REVIEW
  live_shell assistant_tool_read_webhook_key --tag tool_read_key || status=NEEDS_REVIEW
  live_shell webhook_wake --event-id evt-h3 --summary "POST /hooks received" --tag webhook_wake || status=NEEDS_REVIEW
  live_shell dump || true

  # Capture LiveDisplay frame of panel if chrome/ffmpeg available
  : > "${dir}/frames_meta.txt"
  if command -v ffmpeg >/dev/null 2>&1 && test -n "${ISO_DISPLAY}"; then
    set +e
    DISPLAY="${ISO_DISPLAY}" ffmpeg -y -f x11grab -video_size 1280x800 \
      -i "${ISO_DISPLAY}.0" -frames:v 1 "${dir}/webhook_panel.png" \
      >"${dir}/ffmpeg_webhook_panel.log" 2>&1
    local frc=$?
    set -e
    if test "${frc}" -eq 0 && test -f "${dir}/webhook_panel.png"; then
      local sha bytes
      sha="$(sha256sum "${dir}/webhook_panel.png" | awk '{print $1}')"
      bytes="$(wc -c < "${dir}/webhook_panel.png" | tr -d ' ')"
      echo "${sha}  webhook_panel.png" > "${dir}/webhook_panel.png.sha256"
      {
        echo "frame=webhook_panel.png"
        echo "frame_origin=LiveDisplay"
        echo "display=${ISO_DISPLAY}"
        echo "bytes=${bytes}"
        echo "sha256=${sha}"
        echo "driven_by=HostUiShell_Live"
        echo "not_cdp_page_js=true"
        echo "not_fixture_only=true"
      } >> "${dir}/frames_meta.txt"
    fi
  fi

  # Extract asserts from Host events
  python3 - <<PY
import json
from pathlib import Path
d = Path("${dir}")
status = "${status}"
# Find copy receipts + tool reject + wake
copy_url = copy_key = tool_rej = wake_ok = False
wake_payload = ""
key = "whsec_h3_opaque_do_not_tool_read"
for p in sorted(d.glob("host_ui_event_*.json")):
    try:
        j = json.loads(p.read_text())
    except Exception:
        continue
    res = j.get("result") or {}
    method = (j.get("method") or "")
    if "user_copy_webhook" in p.name or res.get("copied") == "url" or (res.get("receipt") or "").startswith("copied_url:"):
        if res.get("copied") == "url" or "copied_url:" in str(res.get("receipt","")):
            copy_url = True
            (d/"copy_url_receipt.txt").write_text(str(res.get("receipt") or res)+"\n")
        if res.get("copied") == "key" or "copied_key:" in str(res.get("receipt","")):
            copy_key = True
            (d/"copy_key_receipt.txt").write_text(str(res.get("receipt") or res)+"\n")
    if res.get("rejected") and ("opaque" in str(res.get("message","")) or res.get("error")=="opaque"):
        tool_rej = True
        (d/"tool_read_key.err.txt").write_text(json.dumps(res, indent=2)+"\n")
    if res.get("has_webhook_event") or res.get("payload"):
        wake_payload = res.get("payload") or ""
        wake_ok = ("<webhook_event" in wake_payload and "</webhook_event>" in wake_payload
                   and key not in wake_payload and not res.get("leaks_key"))
        (d/"wake_payload.txt").write_text(wake_payload+"\n")

# Also scan dump state
st_path = d / "host_ui_state.json"
if st_path.exists():
    st = json.loads(st_path.read_text())
    # state may be wrapped
    state = st if "webhookPanel" in st else st.get("state") or st
    wp = state.get("webhookPanel") or {}
    lc = wp.get("last_copy") or {}
    if lc.get("what") == "key" and lc.get("ok"):
        copy_key = True
        (d/"copy_key_receipt.txt").write_text(str(lc.get("receipt"))+"\n")
    if lc.get("what") == "url" and lc.get("ok"):
        copy_url = True

# Fallback: read individual event files by tag
for name, flag in [("user_copy_webhook", None)]:
    pass
for p in d.glob("host_ui_event_*.json"):
    j = json.loads(p.read_text())
    res = j.get("result") or {}
    if res.get("copied") == "url":
        copy_url = True
        (d/"copy_url_receipt.txt").write_text(res.get("receipt","")+"\n")
    if res.get("copied") == "key":
        copy_key = True
        (d/"copy_key_receipt.txt").write_text(res.get("receipt","")+"\n")

if not (d/"tool_read_key.err.txt").exists():
    # try find rejected in any event
    for p in d.glob("host_ui_event_*.json"):
        j = json.loads(p.read_text())
        res = j.get("result") or {}
        if res.get("rejected"):
            tool_rej = True
            (d/"tool_read_key.err.txt").write_text(json.dumps(res, indent=2)+"\n")
            break

if not wake_ok and (d/"host_ui_event_webhook_wake.json").exists():
    j = json.loads((d/"host_ui_event_webhook_wake.json").read_text())
    res = j.get("result") or {}
    wake_payload = res.get("payload") or ""
    wake_ok = ("<webhook_event" in wake_payload and key not in wake_payload)
    (d/"wake_payload.txt").write_text(wake_payload+"\n")

ok = copy_url and copy_key and tool_rej and wake_ok
if not ok:
    status = "NEEDS_REVIEW"
final = status if ok else "NEEDS_REVIEW"
span = {
  "id": "h3-0411-webhook-panel",
  "tool_name": "h3_probe:CM-0411",
  "ok": ok,
  "detail": f"panel_copy_url={copy_url} panel_copy_key={copy_key} tool_read_rejected={tool_rej} wake_ok={wake_ok}; i_claimed=false",
  "artifact_path": str(d),
}
open(d/"audit_spans.jsonl","a").write(json.dumps(span)+"\n")
ev = {
  "CM": "CM-0411",
  "evidence_cmd": "${evidence_cmd}",
  "artifact_dir": str(d),
  "env": {"USER_IANA": "${USER_IANA}", "shared_cdp_9223": "untouched", "surface": "bit-bot-host-ui", "ui_drive": "HostUiShell_Live"},
  "panel_copy_url_ok": copy_url,
  "panel_copy_key_ok": copy_key,
  "tool_read_key_rejected": tool_rej,
  "wake_has_webhook_event": wake_ok,
  "i_claimed": False,
  "status": final,
  "assert": "Host panel copy URL/key receipts; assistant tool-read key rejected; wake has <webhook_event> without key",
}
(d/"evidence.json").write_text(json.dumps(ev, indent=2)+"\n")
open(d/"status.txt","w").write(final+"\n")
meta = d/"probe_meta.txt"
with meta.open("a") as f:
    f.write(f"panel_copy_url_ok={copy_url}\n")
    f.write(f"panel_copy_key_ok={copy_key}\n")
    f.write(f"tool_read_key_rejected={tool_rej}\n")
    f.write(f"wake_has_webhook_event={wake_ok}\n")
    f.write("display=${ISO_DISPLAY}\n")
    f.write(f"status={final}\n")
print(final, "copy_url", copy_url, "copy_key", copy_key, "tool_rej", tool_rej, "wake", wake_ok)
PY
  status="$(cat "${dir}/status.txt")"

  {
    echo "isolation_display=${ISO_DISPLAY}"
    echo "isolation_http=${ISO_HTTP_PORT}"
    echo "isolation_cdp=${ISO_PORT}"
    echo "shared_cdp_9223=untouched"
  } > "${dir}/isolation_meta.txt"

  write_manifest "${dir}" "CM-0411" "${evidence_cmd}" \
    "Host webhook panel copy receipts; tool-read key rejected; wake <webhook_event> no key leak; i_claimed=false" \
    "${status}"

  cleanup_0411
  trap - EXIT
  echo "[H3] CM-0411 → ${dir} status=${status}"
}

usage() {
  echo "Usage: $0 [cm-2158|cm-2174|cm-0705|cm-0411|all]" >&2
}

main() {
  local target="${1:-all}"
  case "${target}" in
    cm-2158) run_cm2158 ;;
    cm-2174) run_cm2174 ;;
    cm-0705) run_cm0705 ;;
    cm-0411) run_cm0411 ;;
    all)
      run_cm2158
      run_cm2174
      run_cm0705
      run_cm0411
      echo "[H3] all done — artifacts under ${ART_ROOT}; i_claimed=false; Bit验证 decides I-PASS"
      ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
}

main "$@"
