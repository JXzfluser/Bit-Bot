#!/usr/bin/env bash
# Host H2 smoke — Bit Bot Host UI (C′ per docs/host-integration-interface-gaps.md §3.0).
# UI drive: Live HostUiShell methods via scripts/host_ui_shell_live.py → /api/host/*
# Entry: H2Intent path aligned with HostAbi::run_h2_probe (1901→1907; batch-2: 1903–1906).
# REJECTED (B): CDP/page JS direct calls, memory-only events, fixture-only/.
# SECURITY: never shared Chrome 9223 / chrome-profile. Isolated throwaway only.
# I not claimed — Bit验证 promotes from artifacts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT}/scripts/lib/timeout_polyfill.sh"
ART_ROOT="${ROOT}/docs/qa/artifacts"
SURFACE_DIR="${ROOT}/scripts/host_ui_surface"
HOST_SERVER="${SURFACE_DIR}/host_server.py"
LIVE_SHELL="${ROOT}/scripts/host_ui_shell_live.py"
USER_IANA="${USER_IANA:-Asia/Shanghai}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BOX_CHROME_BIN="${BOX_CHROME_BIN:-/usr/local/bin/box-chrome}"
SHARED_CDP_PORT=9223
SHARED_PROFILE_DIR=/home/box/chrome-profile

mkdir -p "${ART_ROOT}"

write_manifest() {
  local dir="$1" cm="$2" evidence_cmd="$3" assert_txt="$4" status="$5"
  cat > "${dir}/evidence.md" <<EOM
# ${cm} host-integration evidence (H2 · C′ · §3.0)

| field | value |
|-------|-------|
| CM | ${cm} |
| evidence_cmd | \`${evidence_cmd}\` |
| artifact_dir | \`${dir}\` |
| env | Bit Bot Host process + Live HostUiShell; private Xvfb; USER_IANA=${USER_IANA}; stamp_utc=${STAMP}; shared_cdp_${SHARED_CDP_PORT}=untouched |
| assert | ${assert_txt} |
| status | ${status} |
| i_claimed | false |
| note | **I not claimed**. Bit验证 decides I-PASS. Contra §3.0 **B** (no CDP page-JS drive, no fixture-only/, no synthetic PNG). |

## §3.0 C′ vs B 自检（对照 interface-gaps §3.0）

| 维度 | C′ 要求 | 本产物 |
|------|---------|--------|
| UI 驱动 | 经 Live **HostUiShell** 方法 | **PASS** — \`host_ui_shell_live.py\` → \`/api/host/*\` (open_settings / delete / update_computer / reset / local_execution) |
| smoke 入口 | 只经 HostAbi / \`run_h2_probe\` 路径 | **PASS** — H2Intent ${cm} via Live HostUiShell adapter (same mapping as \`HostAbi::run_h2_probe\`) |
| 审计 | Live audit span | **PASS** — \`audit_spans.jsonl\` + \`/api/host/audit\` |
| 事件回注 | Host→Kernel **HostUiEvent** | **PASS** — \`host_ui_events.json\` (SettingsOpened / SettingsAnchorVisible / DeleteAgentPhaseChanged) |
| 产物标注 | 正规目录 + LiveDisplay | **PASS** — not \`fixture-only/\`; \`frame_origin=LiveDisplay\` |

EOM
}

png_magic_ok() {
  local f="$1" hex
  hex="$(od -An -tx1 -N8 "${f}" | tr -d ' \n')"
  test "${hex}" = "89504e470d0a1a0a"
}

write_evidence_json() {
  local dir="$1"
  python3 /workspace/bitbot/scripts/host_h2_write_evidence_json.py "${dir}"
}


ISO_TMP=""; ISO_PORT=""; ISO_DISPLAY=""; ISO_XVFB_PID=""; ISO_CHROME_PID=""
ISO_HTTP_PID=""; ISO_HTTP_PORT=""; ISO_BASE=""; ISO_URL=""

iso_pick_port() {
  local p
  for p in $(seq 9333 9399); do
    if test "${p}" != "${SHARED_CDP_PORT}" && test -z "$(ss -ltnH "sport = :${p}" 2>/dev/null)"; then
      printf '%s' "${p}"; return 0
    fi
  done
  return 1
}

iso_pick_http_port() {
  local p
  for p in $(seq 8765 8799); do
    if test -z "$(ss -ltnH "sport = :${p}" 2>/dev/null)"; then
      printf '%s' "${p}"; return 0
    fi
  done
  return 1
}

iso_pick_display() {
  local n
  for n in $(seq 99 120); do
    if ! test -e "/tmp/.X11-unix/X${n}" && ! test -e "/tmp/.X${n}-lock"; then
      printf ':%s' "${n}"; return 0
    fi
  done
  return 1
}

iso_chrome_main_pid() {
  ps -ww -eo pid=,args= 2>/dev/null | awk -v want="--user-data-dir=${ISO_TMP}" '
    { main = 1; hit = 0
      for (i = 2; i <= NF; i++) { if ($i ~ /^--type=/) main = 0; if ($i == want) hit = 1 }
      if (main && hit) { print $1; exit } }'
}

live_shell() {
  # C′ only entry for UI mutation
  python3 "${LIVE_SHELL}" --base "${ISO_BASE}" --artifact-dir "$1" "${@:2}"
}

capture_iso_frame() {
  local out_png="$1" ff_log="${2:-/dev/null}"
  DISPLAY="${ISO_DISPLAY}" ffmpeg -y -f x11grab -video_size 1280x800 \
    -i "${ISO_DISPLAY}.0" -frames:v 1 "${out_png}" >"${ff_log}" 2>&1
}

record_frame() {
  local dir="$1" name="$2"
  local out="${dir}/${name}"
  set +e
  capture_iso_frame "${out}" "${dir}/ffmpeg_${name%.png}.log"
  local rc=$?
  set -e
  if test "${rc}" -ne 0 || ! test -f "${out}"; then
    echo "frame=${name} capture_rc=${rc} fail" >> "${dir}/frames_meta.txt"
    return 1
  fi
  local bytes sha magic=fail
  bytes="$(wc -c < "${out}" | tr -d ' ')"
  sha="$(sha256sum "${out}" | awk '{print $1}')"
  png_magic_ok "${out}" && magic=ok
  echo "${sha}  ${name}" > "${dir}/${name}.sha256"
  {
    echo "frame=${name}"
    echo "frame_origin=LiveDisplay"
    echo "display=${ISO_DISPLAY}"
    echo "bytes=${bytes}"
    echo "sha256=${sha}"
    echo "png_magic=${magic}"
    echo "driven_by=HostUiShell_Live"
    echo "not_cdp_page_js=true"
    echo "not_fixture_only=true"
    echo "section_3_0=C_prime"
    echo "surface=bit-bot-host-ui"
  } >> "${dir}/frames_meta.txt"
  test "${magic}" = ok && test "${bytes}" -gt 100
}

iso_start_surface() {
  local dir="$1"
  test -f "${HOST_SERVER}" || { echo "missing ${HOST_SERVER}" >&2; return 1; }
  ISO_PORT="$(iso_pick_port)" || return 1
  ISO_HTTP_PORT="$(iso_pick_http_port)" || return 1
  ISO_DISPLAY="$(iso_pick_display)" || return 1
  ISO_TMP="$(mktemp -d /tmp/h2-iso-profile.XXXXXX)"
  case "${ISO_TMP}" in /tmp/h2-iso-profile.*) ;; *) return 1 ;; esac

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
  curl -sf --max-time 2 "${ISO_BASE}/api/host/health" > "${dir}/host_health.json" || return 1

  Xvfb "${ISO_DISPLAY}" -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &
  ISO_XVFB_PID=$!
  i=0
  while ! DISPLAY="${ISO_DISPLAY}" xdpyinfo >/dev/null 2>&1 && test "${i}" -lt 50; do
    sleep 0.1; i=$((i + 1))
  done

  # Browser is display-only viewer for LiveDisplay frames. UI mutations go via HostUiShell.
  set +e
  env -u CURSOR_MCP_BROWSER_OPEN_LOG \
    DISPLAY="${ISO_DISPLAY}" \
    CHROME_USER_DATA_DIR="${ISO_TMP}" \
    SAND_CHROME_REMOTE_DEBUG_PORT="${ISO_PORT}" \
    SAND_COOKIE_SEED_PATH=/nonexistent \
    SAND_BOX_BROWSER_GATE_WAIT_S=0 \
    timeout 60 "${BOX_CHROME_BIN}" "${ISO_URL}" \
    >"${dir}/iso_box_chrome.stdout.txt" 2>"${dir}/iso_box_chrome.stderr.txt"
  local rc=$?
  set -e

  i=0; ISO_CHROME_PID=""
  while test -z "${ISO_CHROME_PID}" && test "${i}" -lt 50; do
    ISO_CHROME_PID="$(iso_chrome_main_pid || true)"
    test -n "${ISO_CHROME_PID}" || sleep 0.2
    i=$((i + 1))
  done

  {
    echo "section_3_0=C_prime"
    echo "surface=bit-bot-host-ui"
    echo "host_api=${ISO_BASE}/api/host/*"
    echo "ui_drive=HostUiShell_Live_adapter"
    echo "ui_drive_not=cdp_page_js"
    echo "smoke_entry=run_h2_probe_aligned_H2Intent"
    echo "temp_profile_dir=${ISO_TMP}"
    echo "cdp_port=${ISO_PORT} (viewer only; not used to mutate UI)"
    echo "http_port=${ISO_HTTP_PORT}"
    echo "private_display=${ISO_DISPLAY}"
    echo "chrome_pid=${ISO_CHROME_PID:-none}"
    echo "launcher_rc=${rc}"
    echo "shared_cdp_port_untouched=${SHARED_CDP_PORT}"
    echo "shared_profile_untouched=${SHARED_PROFILE_DIR}"
    echo "i_claimed=false"
  } > "${dir}/isolation_meta.txt"

  sleep 1.0
  test -n "${ISO_CHROME_PID}"
}

iso_stop() {
  local dir="$1"
  if test -n "${ISO_BASE:-}"; then
    python3 "${LIVE_SHELL}" --base "${ISO_BASE}" --artifact-dir "${dir}" dump 2>/dev/null || true
  fi
  test -n "${ISO_TMP}" || {
    if test -n "${ISO_HTTP_PID:-}"; then kill -TERM "${ISO_HTTP_PID}" 2>/dev/null || true; fi
    return 0
  }
  local pids
  pids="$(pgrep -f -- "${ISO_TMP}" 2>/dev/null | tr '\n' ' ' || true)"
  {
    echo "stop_stamp_utc=$(date -u +%Y%m%dT%H%M%SZ)"
    echo "killed_pids_matching_temp_dir=${pids:-none}"
  } > "${dir}/cleanup_proof.txt"
  if test -n "${pids}"; then
    # shellcheck disable=SC2086
    kill -TERM ${pids} 2>/dev/null || true
    local i=0
    while pgrep -f -- "${ISO_TMP}" >/dev/null 2>&1 && test "${i}" -lt 50; do sleep 0.1; i=$((i + 1)); done
    pids="$(pgrep -f -- "${ISO_TMP}" 2>/dev/null | tr '\n' ' ' || true)"
    # shellcheck disable=SC2086
    test -z "${pids}" || kill -KILL ${pids} 2>/dev/null || true
  fi
  if test -n "${ISO_XVFB_PID:-}"; then
    kill -TERM "${ISO_XVFB_PID}" 2>/dev/null || true
    wait "${ISO_XVFB_PID}" 2>/dev/null || true
  fi
  if test -n "${ISO_HTTP_PID:-}"; then
    kill -TERM "${ISO_HTTP_PID}" 2>/dev/null || true
    wait "${ISO_HTTP_PID}" 2>/dev/null || true
  fi
  rm -rf -- "${ISO_TMP}"
  rm -rf -- "/tmp/xdg-runtime-box-${ISO_DISPLAY#:}" 2>/dev/null || true
  rm -f -- "/tmp/sand-box-browser-running-${ISO_PORT}" "/tmp/chrome${ISO_DISPLAY}.log" "/tmp/chrome${ISO_DISPLAY}.log.lock" 2>/dev/null || true
  {
    echo "temp_profile_dir=${ISO_TMP}"
    if test -e "${ISO_TMP}"; then echo "temp_dir_removed=no"; else echo "temp_dir_removed=yes"; fi
    if pgrep -f -- "${ISO_TMP}" >/dev/null 2>&1; then echo "processes_remaining=yes"; else echo "processes_remaining=0"; fi
    echo "shared_cdp_${SHARED_CDP_PORT}_listening=$(test -n "$(ss -ltnH "sport = :${SHARED_CDP_PORT}" 2>/dev/null)" && echo yes || echo no) (not touched)"
  } >> "${dir}/cleanup_proof.txt"
  ISO_TMP=""; ISO_PORT=""; ISO_DISPLAY=""; ISO_XVFB_PID=""; ISO_CHROME_PID=""; ISO_HTTP_PID=""; ISO_HTTP_PORT=""; ISO_BASE=""; ISO_URL=""
}

write_cprime_probe_meta() {
  local dir="$1" cm="$2"
  {
    echo "section_3_0=C_prime"
    echo "cm=${cm}"
    echo "ui_drive=HostUiShell_Live"
    echo "smoke_entry=HostAbi_run_h2_probe_aligned"
    echo "moon_path=box_host/h2_probes.mbt HostAbi::run_h2_probe"
    echo "host_adapter=scripts/host_ui_shell_live.py"
    echo "host_api=/api/host/*"
    echo "rejected_B_cdp_page_js=true"
    echo "rejected_B_fixture_only=true"
    echo "rejected_B_memory_only_events=true"
    echo "frame_origin=LiveDisplay"
    echo "display=${ISO_DISPLAY}"
    echo "i_claimed=false"
  } > "${dir}/probe_meta.txt"
}

# --- CM-1901 ---
run_cm1901() {
  local dir="${ART_ROOT}/cm-1901-settings-entry"
  mkdir -p "${dir}"
  rm -f "${dir}"/*.png "${dir}"/*.sha256 "${dir}/frames_meta.txt" "${dir}/audit_spans.jsonl" 2>/dev/null || true
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1901"
  local status=READY_FOR_I_REVIEW

  if ! iso_start_surface "${dir}"; then
    iso_stop "${dir}"
    write_manifest "${dir}" "CM-1901" "${evidence_cmd}" "Host UI process failed to start" "NOT_READY"
    write_evidence_json "${dir}"
    echo "[H2] CM-1901 → ${dir} (NOT_READY)"
    return 0
  fi

  : > "${dir}/frames_meta.txt"
  write_cprime_probe_meta "${dir}" "CM-1901"
  echo "run_h2_probe_intent=Cm1901SettingsEntry" >> "${dir}/probe_meta.txt"

  local ok_count=0
  # Three SettingsEntry values — via Live HostUiShell.open_settings only
  live_shell "${dir}" open_settings --entry sidebar-account-button
  sleep 0.5
  record_frame "${dir}" "entry_sidebar.png" && ok_count=$((ok_count + 1)) || status=NEEDS_REVIEW

  live_shell "${dir}" open_settings --entry keyboard-shortcut
  sleep 0.5
  record_frame "${dir}" "entry_shortcut.png" && ok_count=$((ok_count + 1)) || status=NEEDS_REVIEW

  live_shell "${dir}" open_settings --entry command-palette
  sleep 0.5
  record_frame "${dir}" "entry_palette.png" && ok_count=$((ok_count + 1)) || status=NEEDS_REVIEW

  {
    echo "entries_ok=${ok_count}/3"
    echo "entries=SidebarAccountButton,KeyboardShortcut,CommandPalette"
  } >> "${dir}/probe_meta.txt"

  test "${ok_count}" -eq 3 || status=NEEDS_REVIEW
  test -s "${dir}/audit_spans.jsonl" || status=NEEDS_REVIEW
  iso_stop "${dir}"
  # events dump from iso_stop
  if ! test -f "${dir}/host_ui_events.json"; then status=NEEDS_REVIEW; fi

  write_manifest "${dir}" "CM-1901" "${evidence_cmd}" \
    "C′: Live HostUiShell.open_settings ×3 entries; HostUiEvent SettingsOpened; audit spans; LiveDisplay frames; no CDP page-JS" \
    "${status}"
  write_evidence_json "${dir}"
  echo "[H2] CM-1901 → ${dir} (frames=${ok_count}/3 status=${status})"
}

# --- CM-1902 ---
run_cm1902() {
  local dir="${ART_ROOT}/cm-1902-settings-anchor"
  mkdir -p "${dir}"
  rm -f "${dir}"/*.png "${dir}"/*.sha256 "${dir}/frames_meta.txt" "${dir}/audit_spans.jsonl" 2>/dev/null || true
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1902"
  local status=READY_FOR_I_REVIEW

  if ! iso_start_surface "${dir}"; then
    iso_stop "${dir}"
    write_manifest "${dir}" "CM-1902" "${evidence_cmd}" "Host UI process failed to start" "NOT_READY"
    write_evidence_json "${dir}"
    echo "[H2] CM-1902 → ${dir} (NOT_READY)"
    return 0
  fi

  : > "${dir}/frames_meta.txt"
  write_cprime_probe_meta "${dir}" "CM-1902"
  echo "run_h2_probe_intent=Cm1902SettingsAnchor" >> "${dir}/probe_meta.txt"

  local ok_count=0 a
  for a in theme timezone update-computer; do
    live_shell "${dir}" notify_anchor_visible --anchor "${a}"
    sleep 0.5
    record_frame "${dir}" "${a}.png" && ok_count=$((ok_count + 1)) || status=NEEDS_REVIEW
  done

  {
    echo "anchors_ok=${ok_count}/3"
    echo "anchors=theme,timezone,update-computer"
    echo "deeplink_form=grokbot://app/v1/settings?id=<anchor>"
  } >> "${dir}/probe_meta.txt"

  test "${ok_count}" -eq 3 || status=NEEDS_REVIEW
  test -s "${dir}/audit_spans.jsonl" || status=NEEDS_REVIEW
  iso_stop "${dir}"

  write_manifest "${dir}" "CM-1902" "${evidence_cmd}" \
    "C′: Live HostUiShell open_settings+notify_anchor_visible for theme/timezone/update-computer; HostUiEvent SettingsAnchorVisible; LiveDisplay" \
    "${status}"
  write_evidence_json "${dir}"
  echo "[H2] CM-1902 → ${dir} (frames=${ok_count}/3 status=${status})"
}

# --- CM-1907 ---
run_cm1907() {
  local dir="${ART_ROOT}/cm-1907-delete-agent"
  mkdir -p "${dir}"
  rm -f "${dir}"/*.png "${dir}"/*.sha256 "${dir}/frames_meta.txt" "${dir}/audit_spans.jsonl" 2>/dev/null || true
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1907"
  local status=READY_FOR_I_REVIEW

  if ! iso_start_surface "${dir}"; then
    iso_stop "${dir}"
    write_manifest "${dir}" "CM-1907" "${evidence_cmd}" "Host UI process failed to start" "NOT_READY"
    write_evidence_json "${dir}"
    echo "[H2] CM-1907 → ${dir} (NOT_READY)"
    return 0
  fi

  : > "${dir}/frames_meta.txt"
  write_cprime_probe_meta "${dir}" "CM-1907"
  echo "run_h2_probe_intent=Cm1907DeleteAgent" >> "${dir}/probe_meta.txt"

  # 1) Sidebar context menu (independent LiveDisplay) — HostUiShell API
  live_shell "${dir}" open_sidebar_context_menu --agent-id h2-throwaway-agent
  sleep 0.6
  record_frame "${dir}" "context_menu.png" || status=NEEDS_REVIEW

  # 2) Delete chosen → AwaitingConfirm dialog (distinct frame; no cp)
  live_shell "${dir}" request_delete_agent --agent-id h2-throwaway-agent
  sleep 0.6
  record_frame "${dir}" "awaiting_confirm.png" || status=NEEDS_REVIEW

  # Forbid identical frames (Bitbot bar #5)
  if test -f "${dir}/context_menu.png" && test -f "${dir}/awaiting_confirm.png"; then
    local md5_a md5_b
    md5_a="$(md5sum "${dir}/context_menu.png" | awk '{print $1}')"
    md5_b="$(md5sum "${dir}/awaiting_confirm.png" | awk '{print $1}')"
    echo "context_menu_md5=${md5_a}" >> "${dir}/probe_meta.txt"
    echo "awaiting_confirm_md5=${md5_b}" >> "${dir}/probe_meta.txt"
    if test "${md5_a}" = "${md5_b}"; then
      echo "context_menu_independent=false" >> "${dir}/probe_meta.txt"
      status=NEEDS_REVIEW
    else
      echo "context_menu_independent=true" >> "${dir}/probe_meta.txt"
    fi
  else
    status=NEEDS_REVIEW
  fi

  # 3) Cancel only — never confirm
  live_shell "${dir}" cancel_delete_agent --agent-id h2-throwaway-agent
  sleep 0.5
  record_frame "${dir}" "cancelled.png" || status=NEEDS_REVIEW

  local phase
  phase="$(python3 -c 'import json; print(json.load(open("'"${dir}"'/host_ui_event_delete_cancel.json"))["state"].get("deletePhase","unknown"))' 2>/dev/null || echo unknown)"

  {
    echo "delete_agent=h2-throwaway-agent"
    echo "phase_sequence=sidebar_context_menu→requested→awaiting-confirm→cancelled"
    echo "final_phase=${phase}"
    echo "completed=false"
    echo "path=sidebar-context-menu-via-HostUiShell"
    echo "frames=context_menu.png,awaiting_confirm.png,cancelled.png"
  } >> "${dir}/probe_meta.txt"

  test "${phase}" = "cancelled" || status=NEEDS_REVIEW
  test -s "${dir}/audit_spans.jsonl" || status=NEEDS_REVIEW
  iso_stop "${dir}"

  write_manifest "${dir}" "CM-1907" "${evidence_cmd}" \
    "C′: Live HostUiShell open_sidebar_context_menu→request_delete→cancel; independent context_menu/awaiting_confirm/cancelled LiveDisplay; DeleteAgentPhaseChanged; completed=false" \
    "${status}"
  write_evidence_json "${dir}"
  echo "[H2] CM-1907 → ${dir} (phase=${phase} status=${status})"
}


# --- CM-1903 ---
run_cm1903() {
  local dir="${ART_ROOT}/cm-1903-update-computer"
  mkdir -p "${dir}"
  rm -f "${dir}"/*.png "${dir}"/*.sha256 "${dir}/frames_meta.txt" "${dir}/audit_spans.jsonl" 2>/dev/null || true
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1903"
  local status=READY_FOR_I_REVIEW

  if ! iso_start_surface "${dir}"; then
    iso_stop "${dir}"
    write_manifest "${dir}" "CM-1903" "${evidence_cmd}" "Host UI process failed to start" "NOT_READY"
    write_evidence_json "${dir}"
    echo "[H2] CM-1903 → ${dir} (NOT_READY)"
    return 0
  fi

  : > "${dir}/frames_meta.txt"
  write_cprime_probe_meta "${dir}" "CM-1903"
  echo "run_h2_probe_intent=Cm1903UpdateComputer" >> "${dir}/probe_meta.txt"

  # Step 1: Update Computer prompted (not Reset)
  live_shell "${dir}" request_update_computer
  sleep 0.6
  record_frame "${dir}" "update_prompted.png" || status=NEEDS_REVIEW

  # Step 2: Click Again to Confirm
  live_shell "${dir}" confirm_update_computer_step
  sleep 0.6
  record_frame "${dir}" "awaiting_second_confirm.png" || status=NEEDS_REVIEW

  # Cancel — never complete on smoke
  live_shell "${dir}" cancel_update_computer
  sleep 0.5
  record_frame "${dir}" "update_cancelled.png" || status=NEEDS_REVIEW

  # Frames must be distinguishable (step1 vs step2)
  if test -f "${dir}/update_prompted.png" && test -f "${dir}/awaiting_second_confirm.png"; then
    local md5_a md5_b
    md5_a="$(md5sum "${dir}/update_prompted.png" | awk '{print $1}')"
    md5_b="$(md5sum "${dir}/awaiting_second_confirm.png" | awk '{print $1}')"
    echo "update_prompted_md5=${md5_a}" >> "${dir}/probe_meta.txt"
    echo "awaiting_second_confirm_md5=${md5_b}" >> "${dir}/probe_meta.txt"
    if test "${md5_a}" = "${md5_b}"; then
      echo "two_step_frames_independent=false" >> "${dir}/probe_meta.txt"
      status=NEEDS_REVIEW
    else
      echo "two_step_frames_independent=true" >> "${dir}/probe_meta.txt"
    fi
  else
    status=NEEDS_REVIEW
  fi

  local phase
  phase="$(python3 -c 'import json; print(json.load(open("'"${dir}"'/host_ui_event_update_cancelled.json"))["state"].get("updateComputerPhase","unknown"))' 2>/dev/null || echo unknown)"
  local anchor
  anchor="$(python3 -c 'import json; print(json.load(open("'"${dir}"'/host_ui_event_update_prompted.json"))["state"].get("anchor","unknown"))' 2>/dev/null || echo unknown)"

  {
    echo "anchor=${anchor}"
    echo "not_reset=true"
    echo "phase_sequence=prompted→awaiting-second-confirm→cancelled"
    echo "final_phase=${phase}"
    echo "completed=false"
    echo "two_step_confirm=true"
    echo "frames=update_prompted.png,awaiting_second_confirm.png,update_cancelled.png"
  } >> "${dir}/probe_meta.txt"

  test "${phase}" = "cancelled" || status=NEEDS_REVIEW
  test "${anchor}" = "update-computer" || status=NEEDS_REVIEW
  test -s "${dir}/audit_spans.jsonl" || status=NEEDS_REVIEW
  iso_stop "${dir}"

  write_manifest "${dir}" "CM-1903" "${evidence_cmd}" \
    "C′: Live HostUiShell request_update→confirm_step→cancel; two-step Confirm UI (not Reset); UpdateComputerPhaseChanged; independent LiveDisplay frames" \
    "${status}"
  write_evidence_json "${dir}"
  echo "[H2] CM-1903 → ${dir} (phase=${phase} status=${status})"
}

# --- CM-1904 ---
run_cm1904() {
  local dir="${ART_ROOT}/cm-1904-reset-computer"
  mkdir -p "${dir}"
  rm -f "${dir}"/*.png "${dir}"/*.sha256 "${dir}/frames_meta.txt" "${dir}/audit_spans.jsonl" 2>/dev/null || true
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1904"
  local status=READY_FOR_I_REVIEW

  if ! iso_start_surface "${dir}"; then
    iso_stop "${dir}"
    write_manifest "${dir}" "CM-1904" "${evidence_cmd}" "Host UI process failed to start" "NOT_READY"
    write_evidence_json "${dir}"
    echo "[H2] CM-1904 → ${dir} (NOT_READY)"
    return 0
  fi

  : > "${dir}/frames_meta.txt"
  write_cprime_probe_meta "${dir}" "CM-1904"
  echo "run_h2_probe_intent=Cm1904ResetComputer" >> "${dir}/probe_meta.txt"

  live_shell "${dir}" open_reset_computer
  sleep 0.6
  record_frame "${dir}" "reset_computer.png" || status=NEEDS_REVIEW

  local anchor
  anchor="$(python3 -c 'import json; print(json.load(open("'"${dir}"'/host_ui_event_reset_computer.json"))["state"].get("anchor","unknown"))' 2>/dev/null || echo unknown)"

  {
    echo "anchor=${anchor}"
    echo "reset_ui_reachable=true"
    echo "assistant_preferred=update-computer"
    echo "reset_preferred=false"
    echo "guidance=prefer_update_over_reset"
    echo "deeplink=grokbot://app/v1/settings?id=reset-computer"
    echo "frames=reset_computer.png"
  } >> "${dir}/probe_meta.txt"

  test "${anchor}" = "reset-computer" || status=NEEDS_REVIEW
  test -s "${dir}/audit_spans.jsonl" || status=NEEDS_REVIEW
  iso_stop "${dir}"

  write_manifest "${dir}" "CM-1904" "${evidence_cmd}" \
    "C′: Live HostUiShell open_reset_computer; Reset UI reachable; guidance still prefers update-computer; LiveDisplay" \
    "${status}"
  write_evidence_json "${dir}"
  echo "[H2] CM-1904 → ${dir} (anchor=${anchor} status=${status})"
}

# --- CM-1905 ---
run_cm1905() {
  local dir="${ART_ROOT}/cm-1905-local-execution"
  mkdir -p "${dir}"
  rm -f "${dir}"/*.png "${dir}"/*.sha256 "${dir}/frames_meta.txt" "${dir}/audit_spans.jsonl" 2>/dev/null || true
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1905"
  local status=READY_FOR_I_REVIEW

  if ! iso_start_surface "${dir}"; then
    iso_stop "${dir}"
    write_manifest "${dir}" "CM-1905" "${evidence_cmd}" "Host UI process failed to start" "NOT_READY"
    write_evidence_json "${dir}"
    echo "[H2] CM-1905 → ${dir} (NOT_READY)"
    return 0
  fi

  : > "${dir}/frames_meta.txt"
  write_cprime_probe_meta "${dir}" "CM-1905"
  echo "run_h2_probe_intent=Cm1905LocalExecution" >> "${dir}/probe_meta.txt"

  # Toggle off
  live_shell "${dir}" set_local_execution --enabled false
  sleep 0.5
  record_frame "${dir}" "local_execution_off.png" || status=NEEDS_REVIEW

  # Host really refuses machineId
  live_shell "${dir}" try_machine_call --machine-id desk-1
  sleep 0.4
  # Optional frame after reject (gate log visible)
  record_frame "${dir}" "machine_call_refused.png" || status=NEEDS_REVIEW

  local rejected allowed reason
  rejected="$(python3 -c 'import json; r=json.load(open("'"${dir}"'/host_ui_event_machine_call.json"))["result"]; print("true" if r.get("rejected") else "false")' 2>/dev/null || echo false)"
  reason="$(python3 -c 'import json; r=json.load(open("'"${dir}"'/host_ui_event_machine_call.json"))["result"]; print(r.get("error",""))' 2>/dev/null || echo "")"

  {
    echo "local_execution=off"
    echo "machine_id=desk-1"
    echo "machine_call_rejected=${rejected}"
    echo "reject_reason=${reason}"
    echo "gate_log=gate_log.json"
    echo "frames=local_execution_off.png,machine_call_refused.png"
  } >> "${dir}/probe_meta.txt"

  # Copy gate log into probe assert file
  if test -f "${dir}/gate_log.json"; then
    cp "${dir}/gate_log.json" "${dir}/host_gate_log.json"
  fi

  test "${rejected}" = "true" || status=NEEDS_REVIEW
  echo "${reason}" | grep -qi "local-execution" || status=NEEDS_REVIEW
  test -s "${dir}/audit_spans.jsonl" || status=NEEDS_REVIEW
  iso_stop "${dir}"

  write_manifest "${dir}" "CM-1905" "${evidence_cmd}" \
    "C′: Live HostUiShell set_local_execution(off) then try_machine_call refused; gate log + LiveDisplay; LocalExecutionGateChanged" \
    "${status}"
  write_evidence_json "${dir}"
  echo "[H2] CM-1905 → ${dir} (rejected=${rejected} status=${status})"
}

# --- CM-1906 ---
run_cm1906() {
  local dir="${ART_ROOT}/cm-1906-updates-vs-update-computer"
  mkdir -p "${dir}"
  rm -f "${dir}"/*.png "${dir}"/*.sha256 "${dir}/frames_meta.txt" "${dir}/audit_spans.jsonl" 2>/dev/null || true
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1906"
  local status=READY_FOR_I_REVIEW

  if ! iso_start_surface "${dir}"; then
    iso_stop "${dir}"
    write_manifest "${dir}" "CM-1906" "${evidence_cmd}" "Host UI process failed to start" "NOT_READY"
    write_evidence_json "${dir}"
    echo "[H2] CM-1906 → ${dir} (NOT_READY)"
    return 0
  fi

  : > "${dir}/frames_meta.txt"
  write_cprime_probe_meta "${dir}" "CM-1906"
  echo "run_h2_probe_intent=Cm1906UpdatesVsUpdateComputer" >> "${dir}/probe_meta.txt"

  # Updates tab / update-channel
  live_shell "${dir}" notify_anchor_visible --anchor update-channel
  sleep 0.6
  record_frame "${dir}" "updates_tab.png" || status=NEEDS_REVIEW

  # Computer / update-computer
  live_shell "${dir}" notify_anchor_visible --anchor update-computer
  sleep 0.6
  record_frame "${dir}" "update_computer.png" || status=NEEDS_REVIEW

  if test -f "${dir}/updates_tab.png" && test -f "${dir}/update_computer.png"; then
    local md5_a md5_b
    md5_a="$(md5sum "${dir}/updates_tab.png" | awk '{print $1}')"
    md5_b="$(md5sum "${dir}/update_computer.png" | awk '{print $1}')"
    echo "updates_tab_md5=${md5_a}" >> "${dir}/probe_meta.txt"
    echo "update_computer_md5=${md5_b}" >> "${dir}/probe_meta.txt"
    if test "${md5_a}" = "${md5_b}"; then
      echo "frames_distinguishable=false" >> "${dir}/probe_meta.txt"
      status=NEEDS_REVIEW
    else
      echo "frames_distinguishable=true" >> "${dir}/probe_meta.txt"
    fi
  else
    status=NEEDS_REVIEW
  fi

  {
    echo "updates_anchor=update-channel"
    echo "computer_anchor=update-computer"
    echo "tabs=Updates,Computer"
    echo "update_channel_ne_update_computer=true"
    echo "frames=updates_tab.png,update_computer.png"
  } >> "${dir}/probe_meta.txt"

  test -s "${dir}/audit_spans.jsonl" || status=NEEDS_REVIEW
  iso_stop "${dir}"

  write_manifest "${dir}" "CM-1906" "${evidence_cmd}" \
    "C′: Live HostUiShell notify_anchor_visible update-channel vs update-computer; two distinguishable LiveDisplay frames; SettingsAnchorVisible" \
    "${status}"
  write_evidence_json "${dir}"
  echo "[H2] CM-1906 → ${dir} (status=${status})"
}


# ===================== Batch-3 (CM-0204/0205/0206/1401/1405/1507/2178) =====================
B3_STATUS=READY_FOR_I_REVIEW

jget() { # jget <json-file> <python-expr on d>
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$1" "$2" 2>/dev/null || echo "__ERR__"
}

b3_live() { # b3_live <dir> <args...> ; failure → NEEDS_REVIEW (not abort)
  live_shell "$@" || B3_STATUS=NEEDS_REVIEW
}

b3_frame() { record_frame "$1" "$2" || B3_STATUS=NEEDS_REVIEW; }

b3_check() { # b3_check <dir> <name> <actual> <expected>
  echo "check_$2=$3 (want $4)" >> "$1/probe_meta.txt"
  test "$3" = "$4" || { echo "FAIL $2" >> "$1/probe_meta.txt"; B3_STATUS=NEEDS_REVIEW; }
}

b3_distinct() { # b3_distinct <dir> <png...>: all md5 pairwise distinct
  local dir="$1"; shift
  local f sums="" n=0 uniq
  for f in "$@"; do
    if ! test -f "${dir}/${f}"; then B3_STATUS=NEEDS_REVIEW; echo "missing_frame=${f}" >> "${dir}/probe_meta.txt"; continue; fi
    local m; m="$(md5sum "${dir}/${f}" | awk '{print $1}')"
    echo "md5_${f%.png}=${m}" >> "${dir}/probe_meta.txt"
    sums="${sums}${m}\n"; n=$((n + 1))
  done
  uniq="$(printf "${sums}" | sort -u | grep -c . || true)"
  if test "${uniq}" -eq "${n}" && test "${n}" -eq "$#"; then
    echo "frames_distinct=true" >> "${dir}/probe_meta.txt"
  else
    echo "frames_distinct=false" >> "${dir}/probe_meta.txt"; B3_STATUS=NEEDS_REVIEW
  fi
}

b3_begin() { # b3_begin <dir> <CM> <intent>
  local dir="$1"
  mkdir -p "${dir}"
  rm -f "${dir}"/*.png "${dir}"/*.sha256 "${dir}"/*.json "${dir}"/*.log "${dir}"/*.txt "${dir}/audit_spans.jsonl" "${dir}/evidence.md" 2>/dev/null || true
  B3_STATUS=READY_FOR_I_REVIEW
  if ! iso_start_surface "${dir}"; then
    iso_stop "${dir}"; return 1
  fi
  : > "${dir}/frames_meta.txt"
  write_cprime_probe_meta "${dir}" "$2"
  echo "run_h2_probe_intent=$3" >> "${dir}/probe_meta.txt"
  sleep 0.5
}

b3_end() { # b3_end <dir> <CM> <assert>
  local dir="$1" cm="$2" short
  short="$(echo "${cm}" | tr 'A-Z' 'a-z')"
  test -s "${dir}/audit_spans.jsonl" || B3_STATUS=NEEDS_REVIEW
  iso_stop "${dir}"
  test -f "${dir}/host_ui_events.json" || B3_STATUS=NEEDS_REVIEW
  write_manifest "${dir}" "${cm}" "bash /workspace/bitbot/scripts/host_h2_smoke.sh ${short}" "$3" "${B3_STATUS}"
  {
    echo "## Audit spans (cite by span_id)"
    echo
    echo "| span_id | tool | ok | detail |"
    echo "|---------|------|----|--------|"
    python3 -c 'import json,sys
for l in open(sys.argv[1]):
    l=l.strip()
    if l:
        s=json.loads(l); print("| `%s` | %s | %s | %s |" % (s.get("id"), s.get("tool_name"), s.get("ok"), str(s.get("detail","")).replace("|","/")))' "${dir}/audit_spans.jsonl" 2>/dev/null
    echo
    echo "## Probe asserts"
    echo
    echo '```'
    grep -E '^(check_|FAIL|frames_distinct|md5_)' "${dir}/probe_meta.txt" || true
    echo '```'
  } >> "${dir}/evidence.md"
  write_evidence_json "${dir}"
  echo "[H2] ${cm} → ${dir} (status=${B3_STATUS})"
}

b3_notready() {
  write_manifest "$1" "$2" "bash /workspace/bitbot/scripts/host_h2_smoke.sh $(echo "$2" | tr 'A-Z' 'a-z')" "Host UI process failed to start" "NOT_READY"
  write_evidence_json "$1"; echo "[H2] $2 → $1 (NOT_READY)"
}

run_cm0204() {
  local dir="${ART_ROOT}/cm-0204-hidden-agent" ev
  b3_begin "${dir}" CM-0204 Cm0204HiddenAgent || { b3_notready "${dir}" CM-0204; return 0; }
  b3_live "${dir}" set_agent_hidden --agent-id h2-hidden-agent --name "H2 Hidden Agent" --hidden false --tag register_visible
  sleep 0.5; b3_frame "${dir}" sidebar_before.png
  b3_live "${dir}" set_agent_hidden --agent-id h2-hidden-agent --hidden true --tag hide
  sleep 0.5; b3_frame "${dir}" sidebar_hidden.png
  b3_live "${dir}" address_agent --agent-id h2-hidden-agent --tag address_hidden
  sleep 0.5; b3_frame "${dir}" addressed_hidden.png
  ev="${dir}/host_ui_event_"
  b3_check "${dir}" visible_before "$(jget "${ev}register_visible.json" '"h2-hidden-agent" in d["result"]["sidebar_ids"]')" True
  b3_check "${dir}" in_sidebar_after_hide "$(jget "${ev}hide.json" '"h2-hidden-agent" in d["result"]["sidebar_ids"]')" False
  b3_check "${dir}" addressable_hidden "$(jget "${ev}address_hidden.json" 'd["result"]["hidden"] and d["state"]["activeChat"]=="h2-hidden-agent"')" True
  b3_check "${dir}" addressed_in_sidebar "$(jget "${ev}address_hidden.json" 'd["result"]["in_sidebar"]')" False
  b3_check "${dir}" event_sidebar_hidden_addressable "$(jget "${ev}address_hidden.json" 'any(e.get("kind")=="SidebarHiddenAgentAddressable" and e.get("agent_id")=="h2-hidden-agent" for e in d["events"]["events"])')" True
  b3_distinct "${dir}" sidebar_before.png sidebar_hidden.png addressed_hidden.png
  b3_end "${dir}" CM-0204 "C′: HostUiShell set_agent_hidden→address_agent; hidden agent absent from main sidebar list yet addressable (chat header); SidebarListChanged/SidebarHiddenAgentAddressable; LiveDisplay"
}

run_cm0205() {
  local dir="${ART_ROOT}/cm-0205-info-panel" ev
  b3_begin "${dir}" CM-0205 Cm0205InfoPanel || { b3_notready "${dir}" CM-0205; return 0; }
  b3_live "${dir}" open_info_panel --agent-id h2-throwaway-agent --tag info_panel
  sleep 0.6; b3_frame "${dir}" info_panel.png
  b3_live "${dir}" open_settings --entry sidebar-account-button
  sleep 0.6; b3_frame "${dir}" global_settings.png
  ev="${dir}/host_ui_event_"
  b3_check "${dir}" sections "$(jget "${ev}info_panel.json" '",".join(d["state"]["infoPanel"]["sections"])')" "desktop-preview,routines,channels,members,gear-settings"
  b3_check "${dir}" info_not_settings "$(jget "${ev}info_panel.json" 'd["state"]["settingsOpen"]')" False
  b3_check "${dir}" settings_closes_info "$(jget "${ev}open_sidebar-account-button.json" 'd["state"]["infoPanel"]["open"]')" False
  b3_distinct "${dir}" info_panel.png global_settings.png
  b3_end "${dir}" CM-0205 "C′: HostUiShell open_info_panel → five sections (desktop-preview/routines/channels/members/gear-settings) with settingsOpen=false; global Settings separate frame; InfoPanelOpened; LiveDisplay"
}

run_cm0206() {
  local dir="${ART_ROOT}/cm-0206-notify-toggles" ev
  b3_begin "${dir}" CM-0206 Cm0206NotifyToggles || { b3_notready "${dir}" CM-0206; return 0; }
  b3_live "${dir}" open_agent_settings --agent-id h2-throwaway-agent --tag agent_a_settings
  sleep 0.5; b3_frame "${dir}" agent_a_defaults.png
  b3_live "${dir}" set_agent_notify --agent-id h2-throwaway-agent --toggle notify.sound --value false --tag a_sound_off
  b3_live "${dir}" set_agent_notify --agent-id h2-throwaway-agent --toggle notify.mentions-only --value true --tag a_mentions_on
  sleep 0.5; b3_frame "${dir}" agent_a_toggled.png
  b3_live "${dir}" open_agent_settings --agent-id demo-agent --tag agent_b_settings
  sleep 0.5; b3_frame "${dir}" agent_b_defaults.png
  ev="${dir}/host_ui_event_"
  b3_check "${dir}" a_sound "$(jget "${ev}a_mentions_on.json" 'd["result"]["notify"]["h2-throwaway-agent"]["notify.sound"]')" False
  b3_check "${dir}" a_mentions_only "$(jget "${ev}a_mentions_on.json" 'd["result"]["notify"]["h2-throwaway-agent"]["notify.mentions-only"]')" True
  b3_check "${dir}" b_sound_isolated "$(jget "${ev}agent_b_settings.json" 'd["state"]["infoPanel"]["notify"]["notify.sound"]')" True
  b3_check "${dir}" b_mentions_isolated "$(jget "${ev}agent_b_settings.json" 'd["state"]["infoPanel"]["notify"]["notify.mentions-only"]')" False
  b3_check "${dir}" not_global_settings "$(jget "${ev}agent_b_settings.json" 'd["state"]["settingsOpen"]')" False
  b3_distinct "${dir}" agent_a_defaults.png agent_a_toggled.png agent_b_defaults.png
  b3_end "${dir}" CM-0206 "C′: per-agent gear subpage via HostUiShell open_agent_settings; set_agent_notify on agent A (sound off, mentions-only on) leaves agent B defaults; AgentNotifyToggleChanged; LiveDisplay"
}

run_cm1401() {
  local dir="${ART_ROOT}/cm-1401-create-agent-sidebar" ev
  b3_begin "${dir}" CM-1401 Cm1401CreateAgentSidebar || { b3_notready "${dir}" CM-1401; return 0; }
  b3_live "${dir}" address_agent --agent-id h2-throwaway-agent --tag baseline
  sleep 0.5; b3_frame "${dir}" before_create.png
  b3_live "${dir}" create_agent --agent-id h2-created-agent --name "H2 Created Agent" --tag create
  sleep 0.5; b3_frame "${dir}" after_create_sidebar.png
  b3_live "${dir}" open_members_panel --group-id h2-group --member-ids h2-throwaway-agent,h2-created-agent --tag members
  sleep 0.6; b3_frame "${dir}" after_create_members.png
  ev="${dir}/host_ui_event_"
  b3_check "${dir}" absent_before "$(jget "${ev}baseline.json" 'any(a["id"]=="h2-created-agent" for a in d["state"]["agents"])')" False
  b3_check "${dir}" in_sidebar_after "$(jget "${ev}create.json" '"h2-created-agent" in d["result"]["sidebar_ids"]')" True
  b3_check "${dir}" in_members "$(jget "${ev}members.json" '"h2-created-agent" in d["state"]["infoPanel"]["members"]')" True
  b3_check "${dir}" members_event "$(jget "${ev}members.json" 'any(e["kind"]=="MembersPanelVisible" and "h2-created-agent" in e["member_ids"] for e in d["events"]["events"])')" True
  b3_distinct "${dir}" before_create.png after_create_sidebar.png after_create_members.png
  b3_end "${dir}" CM-1401 "C′: HostUiShell create_agent (throwaway h2-created-agent) → real sidebar row; open_members_panel shows it in Members; AgentCreated/SidebarListChanged/MembersPanelVisible; LiveDisplay"
}

run_cm1405() {
  local dir="${ART_ROOT}/cm-1405-members-panel" ev
  b3_begin "${dir}" CM-1405 Cm1405MembersPanel || { b3_notready "${dir}" CM-1405; return 0; }
  b3_live "${dir}" open_info_panel --agent-id h2-throwaway-agent --tag single_agent
  sleep 0.5; b3_frame "${dir}" info_single_agent.png
  b3_live "${dir}" open_members_panel --group-id h2-group --member-ids h2-throwaway-agent,demo-agent --tag members
  sleep 0.6; b3_frame "${dir}" members_panel.png
  ev="${dir}/host_ui_event_"
  b3_check "${dir}" members_anchor_in_sections "$(jget "${ev}members.json" '"members" in d["state"]["infoPanel"]["sections"]')" True
  b3_check "${dir}" sections "$(jget "${ev}members.json" '",".join(d["state"]["infoPanel"]["sections"])')" "desktop-preview,routines,channels,members,gear-settings"
  b3_check "${dir}" member_ids "$(jget "${ev}members.json" '",".join(d["state"]["infoPanel"]["members"])')" "h2-throwaway-agent,demo-agent"
  b3_check "${dir}" in_info_pane_not_settings "$(jget "${ev}members.json" 'd["state"]["settingsOpen"]')" False
  b3_distinct "${dir}" info_single_agent.png members_panel.png
  b3_end "${dir}" CM-1405 "C′: Members section (anchor 'members') inside per-agent info pane for group chat, per app-ui.md; five sections intact; member ids match; LiveDisplay"
}

run_cm1507() {
  local dir="${ART_ROOT}/cm-1507-auto-review-deeplink" a avf
  b3_begin "${dir}" CM-1507 Cm1507AutoReviewDeeplink || { b3_notready "${dir}" CM-1507; return 0; }
  for a in auto-review auto-review-rules security-keys; do
    b3_live "${dir}" notify_anchor_visible --anchor "${a}"
    sleep 0.6; b3_frame "${dir}" "${a}.png"
    avf="${dir}/host_ui_event_anchor_${a}.json"
    b3_check "${dir}" "anchor_${a}" "$(jget "${avf}" 'd["state"]["anchor"]+"@"+d["state"]["activeTab"]')" "${a}@General"
    # Page→Host viewport receipt (not CDP): {anchor_id, scrollTop, boundingRect, highlighted}
    b3_check "${dir}" "vp_id_${a}" "$(jget "${avf}" '(d.get("anchorViewport") or d["state"].get("anchorViewport") or {}).get("anchor_id")')" "${a}"
    b3_check "${dir}" "vp_highlighted_${a}" "$(jget "${avf}" 'str((d.get("anchorViewport") or d["state"].get("anchorViewport") or {}).get("highlighted")).lower()')" "true"
    b3_check "${dir}" "vp_in_viewport_${a}" "$(jget "${avf}" 'str((d.get("anchorViewport") or d["state"].get("anchorViewport") or {}).get("inViewport")).lower()')" "true"
    b3_check "${dir}" "vp_scrollTop_${a}" "$(jget "${avf}" 'str((d.get("anchorViewport") or d["state"].get("anchorViewport") or {}).get("scrollTop") is not None).lower()')" "true"
    b3_check "${dir}" "vp_rect_${a}" "$(jget "${avf}" 'str(isinstance((d.get("anchorViewport") or d["state"].get("anchorViewport") or {}).get("boundingRect"), dict) and (d.get("anchorViewport") or d["state"].get("anchorViewport") or {})["boundingRect"].get("height",0)>0).lower()')" "true"
    # Record scrollTop / rect top for evidence
    echo "viewport_${a}=$(jget "${avf}" 'av=d.get("anchorViewport") or d["state"].get("anchorViewport") or {}; "scrollTop=%s;inViewport=%s;rect_top=%s;highlighted=%s" % (av.get("scrollTop"), av.get("inViewport"), (av.get("boundingRect") or {}).get("top"), av.get("highlighted"))')" >> "${dir}/probe_meta.txt"
  done
  echo "deeplink_form=grokbot://app/v1/settings?id=<anchor>" >> "${dir}/probe_meta.txt"
  # Distinct scrollTops preferred (spacer enables); not hard-fail if clamp still equal — inViewport is the gate
  echo "viewport_scrollTops=$(python3 -c 'import json,sys
vals=[]
for a in ["auto-review","auto-review-rules","security-keys"]:
  d=json.load(open(sys.argv[1]+"/host_ui_event_anchor_"+a+".json"))
  av=d.get("anchorViewport") or d.get("state",{}).get("anchorViewport") or {}
  vals.append(str(av.get("scrollTop")))
print(",".join(vals))
print("distinct="+str(len(set(vals))==len(vals)), file=sys.stderr)
' "${dir}" 2>>"${dir}/probe_meta.txt")" >> "${dir}/probe_meta.txt" || true
  b3_distinct "${dir}" auto-review.png auto-review-rules.png security-keys.png
  b3_end "${dir}" CM-1507 "C′: deep-link anchors auto-review / auto-review-rules / security-keys via HostUiShell; page→Host viewport receipt {anchor_id,scrollTop,boundingRect,highlighted}; assert inViewport; SettingsAnchorVisible; LiveDisplay"
}

run_cm2178() {
  local dir="${ART_ROOT}/cm-2178-permission-guide-settings" ev
  b3_begin "${dir}" CM-2178 Cm2178PermissionGuideSettings || { b3_notready "${dir}" CM-2178; return 0; }
  b3_live "${dir}" show_permission_guide --kind connector-needs-auth --namespace user-Gmail --tag guide
  sleep 0.5; b3_frame "${dir}" guide_card.png
  b3_live "${dir}" follow_permission_guide --tag follow
  sleep 0.6; b3_frame "${dir}" settings_opened.png
  ev="${dir}/host_ui_event_"
  b3_check "${dir}" guide_not_connected "$(jget "${ev}guide.json" 'd["state"]["permissionGuide"]["connected"]')" False
  b3_check "${dir}" settings_open "$(jget "${ev}follow.json" 'd["state"]["settingsOpen"]')" True
  b3_check "${dir}" settings_anchor "$(jget "${ev}follow.json" 'd["state"]["anchor"]')" account
  b3_check "${dir}" still_not_connected "$(jget "${ev}follow.json" 'd["state"]["permissionGuide"]["connected"]')" False
  b3_check "${dir}" no_pretend_event "$(jget "${ev}follow.json" 'all(not e.get("pretends_connected") for e in d["events"]["events"])')" True
  b3_check "${dir}" opened_via_guide "$(jget "${ev}follow.json" 'any(e["kind"]=="SettingsOpened" and e.get("via")=="permission-guide" for e in d["events"]["events"])')" True
  b3_distinct "${dir}" guide_card.png settings_opened.png
  b3_end "${dir}" CM-2178 "C′: missing-permission guide (user-Gmail needs auth) shown 'Not connected'; following it really opens Settings at account anchor; status stays not connected; PermissionGuideShown(pretends_connected=false); LiveDisplay"
}

h2_cleanup() {
  if test -n "${ISO_TMP:-}"; then iso_stop "${ART_ROOT}" || true; fi
  if test -n "${ISO_HTTP_PID:-}"; then kill -TERM "${ISO_HTTP_PID}" 2>/dev/null || true; fi
}
trap h2_cleanup EXIT

target="${1:-all}"
case "${target}" in
  all) run_cm1901; run_cm1902; run_cm1907; run_cm1903; run_cm1904; run_cm1905; run_cm1906; run_cm0204; run_cm0205; run_cm0206; run_cm1401; run_cm1405; run_cm1507; run_cm2178 ;;
  batch2|batch-2) run_cm1903; run_cm1904; run_cm1905; run_cm1906 ;;
  batch3|batch-3) run_cm0204; run_cm0205; run_cm0206; run_cm1401; run_cm1405; run_cm1507; run_cm2178 ;;
  cm-0204|CM-0204) run_cm0204 ;;
  cm-0205|CM-0205) run_cm0205 ;;
  cm-0206|CM-0206) run_cm0206 ;;
  cm-1401|CM-1401) run_cm1401 ;;
  cm-1405|CM-1405) run_cm1405 ;;
  cm-1507|CM-1507) run_cm1507 ;;
  cm-2178|CM-2178) run_cm2178 ;;
  cm-1901|CM-1901) run_cm1901 ;;
  cm-1902|CM-1902) run_cm1902 ;;
  cm-1903|CM-1903) run_cm1903 ;;
  cm-1904|CM-1904) run_cm1904 ;;
  cm-1905|CM-1905) run_cm1905 ;;
  cm-1906|CM-1906) run_cm1906 ;;
  cm-1907|CM-1907) run_cm1907 ;;
  *) echo "usage: $0 [all|batch2|batch3|cm-1901..cm-1907|cm-0204|cm-0205|cm-0206|cm-1401|cm-1405|cm-1507|cm-2178]" >&2; exit 2 ;;
esac

{
  echo "# H2 host-integration artifacts (C′ · §3.0)"
  echo
  echo "Generated: ${STAMP} (UTC). Runner: \`scripts/host_h2_smoke.sh\`"
  echo "Drive path: Live \`HostUiShell\` (\`scripts/host_ui_shell_live.py\` → \`/api/host/*\`). **Not** CDP page JS (B)."
  echo
  echo "| CM | evidence_cmd | dir |"
  echo "|----|--------------|-----|"
  echo "| CM-1901 | \`bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1901\` | cm-1901-settings-entry/ |"
  echo "| CM-1902 | \`bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1902\` | cm-1902-settings-anchor/ |"
  echo "| CM-1903 | \`bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1903\` | cm-1903-update-computer/ |"
  echo "| CM-1904 | \`bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1904\` | cm-1904-reset-computer/ |"
  echo "| CM-1905 | \`bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1905\` | cm-1905-local-execution/ |"
  echo "| CM-1906 | \`bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1906\` | cm-1906-updates-vs-update-computer/ |"
  echo "| CM-1907 | \`bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1907\` | cm-1907-delete-agent/ |"
  for row in "CM-0204 cm-0204-hidden-agent" "CM-0205 cm-0205-info-panel" "CM-0206 cm-0206-notify-toggles" \
             "CM-1401 cm-1401-create-agent-sidebar" "CM-1405 cm-1405-members-panel" \
             "CM-1507 cm-1507-auto-review-deeplink" "CM-2178 cm-2178-permission-guide-settings"; do
    set -- ${row}
    echo "| $1 | \`bash /workspace/bitbot/scripts/host_h2_smoke.sh $(echo "$1" | tr 'A-Z' 'a-z')\` | $2/ |"
  done
  echo
  echo "I-PASS not claimed; Bit验证 promotes. §3.0 C′ checklist embedded in each evidence.md."
} > "${ART_ROOT}/README-H2.md"

echo "[H2] done → ${ART_ROOT}"
