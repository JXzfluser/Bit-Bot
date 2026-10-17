#!/usr/bin/env bash
# Host H1 smoke — real OS probes for CM-0605 / CM-0802 / CM-2160 / CM-0806.
# Does NOT use HostAbi::mock() or Placeholder PNG as I evidence.
# SECURITY: never drives/kills the shared logged-in Chrome (:1 / CDP 9223); CM-0802/2160 use an
# isolated throwaway box-chrome (mktemp profile, own port, private Xvfb). CM-0806 hashes in place only.
# Artifacts → docs/qa/artifacts/.
# Usage:
#   bash scripts/host_h1_smoke.sh           # all H1
#   bash scripts/host_h1_smoke.sh cm-0605   # one CM
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ART_ROOT="${ROOT}/docs/qa/artifacts"
USER_IANA="${USER_IANA:-Asia/Shanghai}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DISPLAY_ID="${H1_DISPLAY:-:1}"
# Xvfb :1 is 1920x1200 on this box (xdpyinfo).
CAPTURE_SIZE="${H1_CAPTURE_SIZE:-1920x1200}"
BOX_CHROME_BIN="${BOX_CHROME_BIN:-/usr/local/bin/box-chrome}"
LOCKFILE="${H1_LOCKFILE:-/tmp/box-chrome.lock}"
NAV_URL="${H1_NAV_URL:-https://example.com}"
# Primary profile used by box-chrome on DISPLAY=:1
CHROME_PROFILE_DIR="${CHROME_USER_DATA_DIR:-/home/box/chrome-profile}"
COOKIE_CANDIDATES=(
  "${CHROME_PROFILE_DIR}/Default/Cookies"
  "${CHROME_PROFILE_DIR}/Default/Network/Cookies"
  "${HOME}/.config/google-chrome/Default/Cookies"
  "${HOME}/.config/google-chrome/Default/Network/Cookies"
)

mkdir -p "${ART_ROOT}"

write_manifest() {
  local dir="$1" cm="$2" evidence_cmd="$3" assert_txt="$4" status="$5"
  cat > "${dir}/evidence.md" <<EOM
# ${cm} host-integration evidence

| field | value |
|-------|-------|
| CM | ${cm} |
| evidence_cmd | \`${evidence_cmd}\` |
| artifact_dir | \`${dir}\` |
| env | box Host smoke; display=${MANIFEST_DISPLAY:-${DISPLAY_ID}}; USER_IANA=${USER_IANA}; stamp_utc=${STAMP} |
| assert | ${assert_txt} |
| status | ${status} |
| note | Produced by scripts/host_h1_smoke.sh — **not** HostAbi::mock() / Placeholder PNG. Bit验证 decides I-PASS. |

EOM
}

png_magic_ok() {
  local f="$1"
  # PNG signature: 89 50 4e 47 0d 0a 1a 0a
  local hex
  hex="$(od -An -tx1 -N8 "${f}" | tr -d ' \n')"
  test "${hex}" = "89504e470d0a1a0a"
}

capture_display_frame() {
  local out_png="$1"
  local ff_log="${2:-/dev/null}"
  DISPLAY="${DISPLAY_ID}" ffmpeg -y -f x11grab -video_size "${CAPTURE_SIZE}" \
    -i "${DISPLAY_ID}.0" -frames:v 1 "${out_png}" >"${ff_log}" 2>&1
}

find_cookie_jar() {
  local c
  for c in "${COOKIE_CANDIDATES[@]}"; do
    if test -f "${c}"; then
      printf '%s' "${c}"
      return 0
    fi
  done
  return 1
}

# --- CM-0605: real :1 screenshot (priority) ---
run_cm0605() {
  local dir="${ART_ROOT}/cm-0605-screenshot"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0605"
  local status=READY_FOR_I_REVIEW
  local out_png="${dir}/live_display.png"
  local shots_copy="${ROOT}/../.bitbot/shots/h1-cm0605-live.png"
  # Prefer workspace-local shots under bitbot if parent .bitbot missing
  if ! mkdir -p "$(dirname "${shots_copy}")" 2>/dev/null; then
    shots_copy="${ROOT}/docs/qa/artifacts/cm-0605-screenshot/workspace_shots_copy.png"
  fi

  # Preflight display
  {
    echo "display=${DISPLAY_ID}"
    echo "x11_sock=/tmp/.X11-unix/X${DISPLAY_ID#:}"
    if test -e "/tmp/.X11-unix/X${DISPLAY_ID#:}"; then
      echo "x11_sock_present=yes"
    else
      echo "x11_sock_present=no"
      status=NEEDS_REVIEW
    fi
    if DISPLAY="${DISPLAY_ID}" xdpyinfo >/dev/null 2>&1; then
      echo "xdpyinfo=ok"
      DISPLAY="${DISPLAY_ID}" xdpyinfo 2>/dev/null | grep -E 'name of display|dimensions' || true
    else
      echo "xdpyinfo=fail"
      status=NEEDS_REVIEW
    fi
  } > "${dir}/display_meta.txt"

  set +e
  capture_display_frame "${out_png}" "${dir}/ffmpeg.log"
  local rc=$?
  set -e

  if test "${rc}" -ne 0 || ! test -f "${out_png}"; then
    status=NEEDS_REVIEW
    echo "capture_rc=${rc}" > "${dir}/probe_meta.txt"
    write_manifest "${dir}" "CM-0605" "${evidence_cmd}" \
      "ffmpeg x11grab failed; no LiveDisplay frame" \
      "${status}"
    echo "[H1] CM-0605 → ${dir} (CAPTURE FAIL)"
    return 0
  fi

  local bytes sha
  bytes="$(wc -c < "${out_png}" | tr -d ' ')"
  sha="$(sha256sum "${out_png}" | awk '{print $1}')"

  local magic=fail
  if png_magic_ok "${out_png}"; then
    magic=ok
  else
    status=NEEDS_REVIEW
  fi

  if test "${bytes}" -lt 100; then
    status=NEEDS_REVIEW
  fi

  # Reject known mock placeholder substring if somehow present (text overlay check N/A for binary;
  # assert non-tiny + PNG magic + real capture cmd).
  {
    echo "frame_origin=LiveDisplay"
    echo "display=${DISPLAY_ID}"
    echo "path=${out_png}"
    echo "bytes=${bytes}"
    echo "sha256=${sha}"
    echo "png_magic=${magic}"
    echo "read_only=true"
    echo "clicked=false"
    echo "capture_cmd=DISPLAY=${DISPLAY_ID} ffmpeg -y -f x11grab -video_size ${CAPTURE_SIZE} -i ${DISPLAY_ID}.0 -frames:v 1 ${out_png}"
    echo "not_placeholder=true"
    echo "not_HostAbi_mock=true"
  } > "${dir}/probe_meta.txt"

  # Optional workspace shots copy for Live path helper
  mkdir -p "$(dirname "${shots_copy}")" 2>/dev/null || true
  cp -f "${out_png}" "${shots_copy}" 2>/dev/null || true
  echo "shots_copy=${shots_copy}" >> "${dir}/probe_meta.txt"

  # sha file for convenience
  echo "${sha}  live_display.png" > "${dir}/live_display.png.sha256"

  write_manifest "${dir}" "CM-0605" "${evidence_cmd}" \
    "real :1 x11grab PNG; png_magic=ok; bytes>0; sha256 recorded; frame_origin=LiveDisplay; read_only; clicked=false; not Placeholder/mock" \
    "${status}"
  echo "[H1] CM-0605 → ${dir} (bytes=${bytes} sha=${sha:0:12}… status=${status})"
}

# ---------------------------------------------------------------------------
# Isolation red line (Bitbot security): NEVER drive, CDP-attach, restart or kill
# the shared logged-in Chrome (DISPLAY=:1, CDP 9223, /home/box/chrome-profile,
# ~/.config/google-chrome). CM-0802 / CM-2160 use a throwaway browser:
#   - private Xvfb display (not the user's :1 desktop)
#   - --user-data-dir=$(mktemp -d)  (via box-chrome's CHROME_USER_DATA_DIR)
#   - own CDP port (9333+, never 9223)
#   - SAND_COOKIE_SEED_PATH=/nonexistent so box-chrome does NOT push the
#     user's saved login cookie seed into the throwaway profile
# Cleanup kills ONLY processes whose argv contains the unique temp dir, the
# private Xvfb pid, and rm -rf's the temp dir.
# ---------------------------------------------------------------------------
SHARED_CDP_PORT=9223
SHARED_PROFILE_DIR=/home/box/chrome-profile
ISO_TMP=""
ISO_PORT=""
ISO_DISPLAY=""
ISO_XVFB_PID=""
ISO_CHROME_PID=""

iso_pick_port() {
  local p
  for p in $(seq 9333 9399); do
    if test "${p}" != "${SHARED_CDP_PORT}" && test -z "$(ss -ltnH "sport = :${p}" 2>/dev/null)"; then
      printf '%s' "${p}"
      return 0
    fi
  done
  return 1
}

iso_pick_display() {
  local n
  for n in $(seq 99 120); do
    if ! test -e "/tmp/.X11-unix/X${n}" && ! test -e "/tmp/.X${n}-lock"; then
      printf ':%s' "${n}"
      return 0
    fi
  done
  return 1
}

iso_chrome_main_pid() {
  # Main browser process = no --type=, argv carries our unique temp dir.
  ps -ww -eo pid=,args= 2>/dev/null | awk -v want="--user-data-dir=${ISO_TMP}" '
    { main = 1; hit = 0
      for (i = 2; i <= NF; i++) { if ($i ~ /^--type=/) main = 0; if ($i == want) hit = 1 }
      if (main && hit) { print $1; exit } }'
}

# iso_start <artifact_dir> [url]   — launches throwaway box-chrome; fills ISO_*.
iso_start() {
  local dir="$1"
  test -n "${ISO_TMP}" && return 0
  ISO_PORT="$(iso_pick_port)" || { echo "iso: no free port" >&2; return 1; }
  ISO_DISPLAY="$(iso_pick_display)" || { echo "iso: no free display" >&2; return 1; }
  ISO_TMP="$(mktemp -d /tmp/h1-iso-profile.XXXXXX)"
  case "${ISO_TMP}" in
    /tmp/h1-iso-profile.*) ;;
    *) echo "iso: unexpected temp dir ${ISO_TMP}" >&2; return 1 ;;
  esac
  Xvfb "${ISO_DISPLAY}" -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &
  ISO_XVFB_PID=$!
  local i=0
  while ! DISPLAY="${ISO_DISPLAY}" xdpyinfo >/dev/null 2>&1 && test "${i}" -lt 50; do
    sleep 0.1; i=$((i + 1))
  done
  set +e
  env -u CURSOR_MCP_BROWSER_OPEN_LOG \
    DISPLAY="${ISO_DISPLAY}" \
    CHROME_USER_DATA_DIR="${ISO_TMP}" \
    SAND_CHROME_REMOTE_DEBUG_PORT="${ISO_PORT}" \
    SAND_COOKIE_SEED_PATH=/nonexistent \
    SAND_BOX_BROWSER_GATE_WAIT_S=0 \
    timeout 60 "${BOX_CHROME_BIN}" ${2:+"$2"} \
    >"${dir}/iso_box_chrome.stdout.txt" 2>"${dir}/iso_box_chrome.stderr.txt"
  local rc=$?
  set -e
  i=0
  ISO_CHROME_PID=""
  while test -z "${ISO_CHROME_PID}" && test "${i}" -lt 50; do
    ISO_CHROME_PID="$(iso_chrome_main_pid || true)"
    test -n "${ISO_CHROME_PID}" || sleep 0.2
    i=$((i + 1))
  done
  {
    echo "isolated=true"
    echo "launcher=${BOX_CHROME_BIN} (env CHROME_USER_DATA_DIR / SAND_CHROME_REMOTE_DEBUG_PORT honored by launcher)"
    echo "launcher_rc=${rc}"
    echo "temp_profile_dir=${ISO_TMP}"
    echo "cdp_port=${ISO_PORT}"
    echo "shared_cdp_port_untouched=${SHARED_CDP_PORT}"
    echo "shared_profile_untouched=${SHARED_PROFILE_DIR}"
    echo "private_display=${ISO_DISPLAY}"
    echo "private_xvfb_pid=${ISO_XVFB_PID}"
    echo "chrome_pid=${ISO_CHROME_PID:-none}"
    echo "cookie_seed_injection=disabled (SAND_COOKIE_SEED_PATH=/nonexistent)"
  } > "${dir}/isolation_meta.txt"
  test -n "${ISO_CHROME_PID}"
}

# iso_stop <artifact_dir>  — kill only our pids; rm temp dir; write proof.
iso_stop() {
  local dir="$1"
  test -n "${ISO_TMP}" || return 0
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
    sleep 0.3
  fi
  if test -n "${ISO_XVFB_PID}"; then
    kill -TERM "${ISO_XVFB_PID}" 2>/dev/null || true
    wait "${ISO_XVFB_PID}" 2>/dev/null || true
  fi
  rm -rf -- "${ISO_TMP}"
  rm -rf -- "/tmp/xdg-runtime-box-${ISO_DISPLAY#:}" 2>/dev/null || true
  rm -f -- "/tmp/sand-box-browser-running-${ISO_PORT}" "/tmp/chrome${ISO_DISPLAY}.log" "/tmp/chrome${ISO_DISPLAY}.log.lock" 2>/dev/null || true
  {
    echo "temp_profile_dir=${ISO_TMP}"
    if test -e "${ISO_TMP}"; then echo "temp_dir_removed=no"; else echo "temp_dir_removed=yes"; fi
    if pgrep -f -- "${ISO_TMP}" >/dev/null 2>&1; then echo "processes_remaining=yes"; else echo "processes_remaining=0"; fi
    if test -n "${ISO_CHROME_PID}" && kill -0 "${ISO_CHROME_PID}" 2>/dev/null; then echo "chrome_pid_${ISO_CHROME_PID}_alive=yes"; else echo "chrome_pid_${ISO_CHROME_PID:-none}_alive=no"; fi
    if test -n "${ISO_XVFB_PID}" && kill -0 "${ISO_XVFB_PID}" 2>/dev/null; then echo "xvfb_pid_${ISO_XVFB_PID}_alive=yes"; else echo "xvfb_pid_${ISO_XVFB_PID:-none}_alive=no"; fi
    if test -n "$(ss -ltnH "sport = :${ISO_PORT}" 2>/dev/null)"; then echo "cdp_port_${ISO_PORT}_listening=yes"; else echo "cdp_port_${ISO_PORT}_listening=no"; fi
    echo "shared_cdp_${SHARED_CDP_PORT}_listening=$(test -n "$(ss -ltnH "sport = :${SHARED_CDP_PORT}" 2>/dev/null)" && echo yes || echo no) (not touched)"
  } >> "${dir}/cleanup_proof.txt"
  ISO_TMP=""; ISO_PORT=""; ISO_DISPLAY=""; ISO_XVFB_PID=""; ISO_CHROME_PID=""
}

# Host-side launch guard (CM-0802 negative path). Only box-chrome launchers pass.
# Usage: h1_launch_guard "<command line>" <log>  → 0 allowed, 3 refused. Never execs.
h1_launch_guard() {
  local cmdline="$1" log="$2"
  local argv0 resolved base
  argv0="${cmdline%% *}"
  if resolved="$(command -v -- "${argv0}" 2>/dev/null)"; then
    resolved="$(readlink -f -- "${resolved}" 2>/dev/null || printf '%s' "${resolved}")"
  else
    resolved="unresolved(not on PATH)"
  fi
  base="$(basename -- "${argv0}")"
  case "${resolved}" in
    /usr/local/bin/box-chrome|/usr/local/libexec/sand/box-chrome|/opt/sand/sand-host/box-launchers/box-chrome)
      echo "ALLOWED argv0=${argv0} resolved=${resolved} reason=box-chrome launcher" >> "${log}"
      return 0 ;;
  esac
  case "${base}" in
    chrome|google-chrome|google-chrome-stable|chromium|chromium-browser|chrome-wrapper)
      echo "REFUSED argv0=${argv0} resolved=${resolved} reason=bare chrome forbidden; must launch via ${BOX_CHROME_BIN}" >> "${log}" ;;
    *)
      echo "REFUSED argv0=${argv0} resolved=${resolved} reason=not a box-chrome launcher" >> "${log}" ;;
  esac
  return 3
}

# Guarded launcher: runs the command ONLY if the guard allows it.
h1_guarded_launch() {
  local log="$1"; shift
  if h1_launch_guard "$*" "${log}"; then
    "$@"
  else
    return 3
  fi
}

# --- CM-0802: box-chrome process + lockfile (isolated throwaway) ---
run_cm0802() {
  local dir="${ART_ROOT}/cm-0802-box-chrome"
  mkdir -p "${dir}"
  rm -f "${dir}"/box-chrome.stdout.txt "${dir}"/box-chrome.stderr.txt "${dir}"/ps_pid_line.txt
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0802"
  local status=READY_FOR_I_REVIEW

  {
    echo "policy=refuse bare chrome; must launch via ${BOX_CHROME_BIN}"
    echo "box_chrome_bin=${BOX_CHROME_BIN}"
    if test -x "${BOX_CHROME_BIN}"; then echo "box_chrome_present=yes"; else echo "box_chrome_present=no"; fi
    echo "isolation=throwaway profile + own CDP port + private Xvfb; shared :1/9223/${SHARED_PROFILE_DIR} never driven"
  } > "${dir}/policy.txt"
  test -x "${BOX_CHROME_BIN}" || status=NEEDS_REVIEW

  # ---- Negative path: bare chrome must be refused by the Host guard ----
  local refusal="${dir}/bare_refusal.txt"
  local marker
  marker="$(mktemp -d /tmp/h1-bare-marker.XXXXXX)"
  {
    echo "# CM-0802 bare-chrome refusal (scripts/host_h1_smoke.sh h1_launch_guard)"
    echo "stamp_utc=${STAMP}"
    echo "marker_profile=${marker} (would be --user-data-dir if a bare launch slipped through)"
  } > "${refusal}"
  local refused=0 allowed_bare=0 cand rc
  for cand in google-chrome-stable /opt/google/chrome/chrome chrome chromium google-chrome; do
    set +e
    h1_guarded_launch "${refusal}" "${cand}" --no-sandbox --user-data-dir="${marker}" --headless=new about:blank
    rc=$?
    set -e
    if test "${rc}" -eq 3; then refused=$((refused + 1)); else allowed_bare=$((allowed_bare + 1)); fi
  done
  sleep 0.5
  local leaked
  leaked="$(pgrep -f -- "${marker}" 2>/dev/null | tr '\n' ' ' || true)"
  set +e
  h1_launch_guard "${BOX_CHROME_BIN} --version-probe-only" "${refusal}"
  local pos_rc=$?
  set -e
  {
    echo "bare_candidates_refused=${refused}/5"
    echo "bare_candidates_allowed=${allowed_bare}"
    echo "bare_processes_started=${leaked:-0}"
    if test -d "${marker}" && test -z "$(ls -A "${marker}")"; then echo "marker_profile_untouched=yes"; else echo "marker_profile_untouched=no"; fi
    echo "box_chrome_guard_rc=${pos_rc} (0=allowed; guard check only, not executed)"
  } >> "${refusal}"
  # Flag (never kill) any running main chrome lacking box-chrome lineage markers.
  {
    echo "# running main chrome processes without --class=box-chrome (flag only; nothing killed)"
    ps -ww -eo pid=,args= | awk '/\/opt\/google\/chrome\/chrome / && !/--type=/ && !/--class=box-chrome/ {print "FLAGGED_BARE pid=" $1}' || true
    echo "end_flag_scan"
  } >> "${refusal}"
  rm -rf -- "${marker}"
  if test "${refused}" -ne 5 || test -n "${leaked}" || test "${pos_rc}" -ne 0; then
    status=NEEDS_REVIEW
  fi

  # ---- Positive path: isolated box-chrome, real pid, lockfile ----
  if ! iso_start "${dir}"; then
    iso_stop "${dir}"
    write_manifest "${dir}" "CM-0802" "${evidence_cmd}" \
      "isolated box-chrome did not produce a browser pid; see isolation_meta.txt" "NEEDS_REVIEW"
    echo "[H1] CM-0802 → ${dir} (NO PID)"
    return 0
  fi
  local pid="${ISO_CHROME_PID}"
  local MANIFEST_DISPLAY="${ISO_DISPLAY} (private Xvfb; isolated throwaway box-chrome, port ${ISO_PORT})"
  ps -ww -o pid,ppid,args -p "${pid}" > "${dir}/ps_box_chrome.txt" 2>&1 || true
  ps -ww -eo pid=,args= | awk -v t="${ISO_TMP}" 'index($0, t) && /box-bounded-log/ {print}' > "${dir}/ps_launcher_wrapper.txt" || true
  local lineage=ok
  grep -q -- '--class=box-chrome' "${dir}/ps_box_chrome.txt" || lineage=missing_class
  grep -q -- '--sand-box-chrome-launcher=' "${dir}/ps_box_chrome.txt" || lineage="${lineage}+missing_launcher_flag"
  grep -q -- "--remote-debugging-port=${ISO_PORT}" "${dir}/ps_box_chrome.txt" || lineage="${lineage}+wrong_port"
  test "${lineage}" = ok || status=NEEDS_REVIEW
  local launcher_lock=no
  test -e "${ISO_TMP}/.sand-launch.lock" && launcher_lock=yes

  {
    echo "pid=${pid}"
    echo "path=${BOX_CHROME_BIN}"
    echo "status=running"
    echo "profile=${ISO_TMP}"
    echo "cdp_port=${ISO_PORT}"
    echo "display=${ISO_DISPLAY}"
    echo "stamp_utc=${STAMP}"
    echo "isolated=true"
  } > "${LOCKFILE}"
  cp -f "${LOCKFILE}" "${dir}/box-chrome.lock.running"
  grep -Eq '^pid=[0-9]+$' "${LOCKFILE}" || status=NEEDS_REVIEW
  ! grep -q 'mock-box-chrome' "${LOCKFILE}" || status=NEEDS_REVIEW
  kill -0 "${pid}" 2>/dev/null || status=NEEDS_REVIEW

  iso_stop "${dir}"
  {
    echo "pid=${pid}"
    echo "path=${BOX_CHROME_BIN}"
    echo "status=stopped"
    echo "stopped_by=host_h1_smoke cleanup (isolated throwaway only)"
    echo "stamp_utc=$(date -u +%Y%m%dT%H%M%SZ)"
  } > "${LOCKFILE}"
  cp -f "${LOCKFILE}" "${dir}/box-chrome.lock.stopped"
  rm -f "${dir}/box-chrome.lock"
  grep -q 'temp_dir_removed=yes' "${dir}/cleanup_proof.txt" || status=NEEDS_REVIEW
  grep -q 'processes_remaining=0' "${dir}/cleanup_proof.txt" || status=NEEDS_REVIEW

  {
    echo "pid=${pid}"
    echo "lockfile=${LOCKFILE} (snapshots: box-chrome.lock.running / .stopped)"
    echo "launcher_flock_present=${launcher_lock} (box-chrome's own <profile>/.sand-launch.lock)"
    echo "lineage=${lineage}"
    echo "bare_refusal=bare_refusal.txt (${refused}/5 refused, none started)"
    echo "shared_session=not touched (no CDP to ${SHARED_CDP_PORT}, no kill/restart)"
  } > "${dir}/probe_meta.txt"

  write_manifest "${dir}" "CM-0802" "${evidence_cmd}" \
    "isolated throwaway box-chrome: real numeric pid in ${LOCKFILE} (running→stopped snapshots), --class=box-chrome + --sand-box-chrome-launcher lineage, own CDP port; Host guard refused 5/5 bare chrome launches with no process started (bare_refusal.txt); temp profile + pids cleaned (cleanup_proof.txt)" \
    "${status}"
  echo "[H1] CM-0802 → ${dir} (pid=${pid} refused=${refused}/5 status=${status})"
}

# --- CM-2160: navigate public URL in isolated browser + capture frame ---
run_cm2160() {
  local dir="${ART_ROOT}/cm-2160-navigate"
  mkdir -p "${dir}"
  # Drop stale files from the earlier (shared-session) run.
  rm -f "${dir}"/cdp_new.json "${dir}"/cdp_new.err "${dir}"/cdp_list.json "${dir}"/cdp_version.json \
        "${dir}"/box-chrome-nav.stdout.txt "${dir}"/box-chrome-nav.stderr.txt \
        "${dir}"/box-chrome.stdout.txt "${dir}"/box-chrome.stderr.txt
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-2160"
  local status=READY_FOR_I_REVIEW
  local url="${NAV_URL}"
  case "${url}" in https://*|http://*) ;; *) echo "public http(s) URL required" >&2; return 2 ;; esac

  echo "url=${url}" > "${dir}/nav_meta.txt"
  if ! iso_start "${dir}"; then
    iso_stop "${dir}"
    echo "nav_method=none (isolated browser failed to start)" >> "${dir}/nav_meta.txt"
    write_manifest "${dir}" "CM-2160" "${evidence_cmd}" "isolated browser failed to start; no navigation" "NEEDS_REVIEW"
    echo "[H1] CM-2160 → ${dir} (NO BROWSER)"
    return 0
  fi
  local base="http://127.0.0.1:${ISO_PORT}"
  local MANIFEST_DISPLAY="${ISO_DISPLAY} (private Xvfb; isolated throwaway box-chrome, port ${ISO_PORT})"
  curl -sf --max-time 3 "${base}/json/version" > "${dir}/cdp_version.json" || true

  local method="" target_id="" rc
  set +e
  curl -sf --max-time 10 -X PUT "${base}/json/new?${url}" > "${dir}/cdp_put_new.json" 2> "${dir}/cdp_put_new.err"
  rc=$?
  set -e
  echo "put_json_new_rc=${rc}" >> "${dir}/nav_meta.txt"
  if test "${rc}" -eq 0; then
    method="cdp_put_json_new"
    target_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("id",""))' "${dir}/cdp_put_new.json" 2>/dev/null || true)"
  else
    # Page.navigate over CDP websocket on the isolated port (node has WebSocket).
    local ws
    ws="$(curl -sf --max-time 3 "${base}/json/list" | python3 -c 'import json,sys; p=[t for t in json.load(sys.stdin) if t.get("type")=="page"]; print(p[0]["webSocketDebuggerUrl"] if p else "")' 2>/dev/null || true)"
    if test -n "${ws}"; then
      set +e
      /exec-daemon/node -e '
        const ws = new WebSocket(process.argv[1]);
        const t = setTimeout(() => process.exit(4), 10000);
        ws.onopen = () => ws.send(JSON.stringify({id:1, method:"Page.navigate", params:{url:process.argv[2]}}));
        ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) { console.log(JSON.stringify(d)); clearTimeout(t); process.exit(d.error ? 5 : 0); } };
        ws.onerror = () => process.exit(6);' "${ws}" "${url}" > "${dir}/cdp_page_navigate.json" 2>&1
      rc=$?
      set -e
      echo "page_navigate_rc=${rc}" >> "${dir}/nav_meta.txt"
      test "${rc}" -eq 0 && method="cdp_page_navigate"
    fi
  fi
  if test -z "${method}"; then
    method="url_launch_fallback"
    set +e
    env DISPLAY="${ISO_DISPLAY}" CHROME_USER_DATA_DIR="${ISO_TMP}" SAND_CHROME_REMOTE_DEBUG_PORT="${ISO_PORT}" \
      SAND_COOKIE_SEED_PATH=/nonexistent timeout 30 "${BOX_CHROME_BIN}" "${url}" >/dev/null 2>&1
    set -e
  fi
  echo "nav_method=${method}" >> "${dir}/nav_meta.txt"
  echo "target_id=${target_id:-n/a}" >> "${dir}/nav_meta.txt"

  # Poll isolated /json/list until the page reports the URL + loaded title.
  local i=0 title="" seen_url=""
  while test "${i}" -lt 40; do
    curl -sf --max-time 2 "${base}/json/list" > "${dir}/cdp_list.json" 2>/dev/null || true
    read -r seen_url title < <(python3 - "${dir}/cdp_list.json" "${url}" "${target_id}" <<'PY' 2>/dev/null || true
import json, sys
try:
    tabs = json.load(open(sys.argv[1]))
except Exception:
    tabs = []
want, tid = sys.argv[2].rstrip("/"), sys.argv[3]
for t in tabs:
    if t.get("type") != "page":
        continue
    if tid and t.get("id") != tid:
        continue
    if t.get("url", "").rstrip("/").startswith(want):
        print(t.get("url"), t.get("title", "").replace(" ", "_"))
        break
PY
)
    if test -n "${seen_url}" && test -n "${title}" && test "${title}" != "${seen_url}"; then break; fi
    sleep 0.25; i=$((i + 1))
  done
  test -n "${target_id}" && curl -sf --max-time 2 "${base}/json/activate/${target_id}" >/dev/null 2>&1 || true
  sleep 1.5

  local out_png="${dir}/post_navigate_frame.png"
  set +e
  DISPLAY="${ISO_DISPLAY}" ffmpeg -y -f x11grab -video_size 1280x800 -i "${ISO_DISPLAY}.0" -frames:v 1 "${out_png}" > "${dir}/ffmpeg.log" 2>&1
  local cap_rc=$?
  set -e
  local iso_tmp_used="${ISO_TMP}" iso_port_used="${ISO_PORT}" iso_disp_used="${ISO_DISPLAY}" iso_pid_used="${ISO_CHROME_PID}"
  iso_stop "${dir}"

  local bytes=0 sha=none magic=fail
  if test "${cap_rc}" -eq 0 && test -f "${out_png}"; then
    bytes="$(wc -c < "${out_png}" | tr -d ' ')"
    sha="$(sha256sum "${out_png}" | awk '{print $1}')"
    png_magic_ok "${out_png}" && magic=ok
    echo "${sha}  post_navigate_frame.png" > "${dir}/post_navigate_frame.png.sha256"
  fi
  test "${magic}" = ok || status=NEEDS_REVIEW
  test -n "${seen_url}" || status=NEEDS_REVIEW
  test "${method}" != url_launch_fallback || status=NEEDS_REVIEW
  grep -q 'temp_dir_removed=yes' "${dir}/cleanup_proof.txt" || status=NEEDS_REVIEW

  {
    echo "url=${url}"
    echo "nav_method=${method}"
    echo "page_url_in_isolated_cdp=${seen_url:-not_seen}"
    echo "page_title=${title:-none}"
    echo "frame_path=${out_png}"
    echo "frame_bytes=${bytes}"
    echo "frame_sha256=${sha}"
    echo "png_magic=${magic}"
    echo "frame_display=${iso_disp_used} (private Xvfb; user's :1 not used)"
    echo "temp_profile_dir=${iso_tmp_used}"
    echo "cdp_port=${iso_port_used}"
    echo "chrome_pid=${iso_pid_used}"
  } > "${dir}/probe_meta.txt"

  local nav_desc
  case "${method}" in
    cdp_put_json_new) nav_desc="navigated via CDP \`PUT /json/new?${url}\` on isolated port ${iso_port_used}" ;;
    cdp_page_navigate) nav_desc="navigated via CDP \`Page.navigate\` on isolated port ${iso_port_used}" ;;
    *) nav_desc="**FALLBACK: CDP navigate failed; navigation happened by launching box-chrome with the URL as argv** (isolated profile)" ;;
  esac
  write_manifest "${dir}" "CM-2160" "${evidence_cmd}" \
    "${nav_desc}; isolated /json/list shows page url=${seen_url:-not_seen} title=${title:-none}; post-navigate frame PNG sha256=${sha}; throwaway profile/pid cleaned (cleanup_proof.txt)" \
    "${status}"
  echo "[H1] CM-2160 → ${dir} (method=${method} title=${title:-none} status=${status})"
}

# --- CM-0806: cookie/login jar — digest IN PLACE only, never copied ---
run_cm0806() {
  local dir="${ART_ROOT}/cm-0806-session-jar"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0806"
  local status=NEEDS_REVIEW
  local MANIFEST_DISPLAY="n/a (file digest only; no browser touched)"
  # Remove stale outputs of the old (copying) version; never write DB copies.
  rm -f "${dir}"/Cookies* "${dir}"/jar_before.txt "${dir}"/jar_after.txt \
        "${dir}"/box-chrome*.txt "${dir}"/jar_search.txt

  jar_digest_line() {
    local label="$1" jar="$2" sha bytes rows="n/a" rows_method="none"
    sha="$(sha256sum "${jar}" | awk '{print $1}')"
    bytes="$(wc -c < "${jar}" | tr -d ' ')"
    if command -v sqlite3 >/dev/null 2>&1; then
      rows="$(sqlite3 -readonly "file:${jar}?mode=ro&immutable=1" 'SELECT COUNT(*) FROM cookies;' 2>/dev/null || echo err)"
      rows_method="sqlite3_cli_readonly_in_place"
    elif python3 -c 'import sqlite3' >/dev/null 2>&1; then
      rows="$(python3 - "${jar}" <<'PY' 2>/dev/null || echo err
import sqlite3, sys, urllib.parse
uri = "file:" + urllib.parse.quote(sys.argv[1]) + "?mode=ro&immutable=1"
con = sqlite3.connect(uri, uri=True)
print(con.execute("SELECT COUNT(*) FROM cookies").fetchone()[0])
con.close()
PY
)"
      rows_method="python3_sqlite3_readonly_in_place"
    fi
    echo "${label} path=${jar} sha256=${sha} bytes=${bytes} cookie_rows=${rows} rows_method=${rows_method}"
  }

  local jar=""
  if jar="$(find_cookie_jar)"; then
    {
      echo "# CM-0806 cookie jar digest — hashed/counted IN PLACE; DB never copied; no cookie names/values read"
      jar_digest_line "t0" "${jar}"
      sleep 2
      jar_digest_line "t1" "${jar}"
    } > "${dir}/jar_digest.txt"
    local s0 s1
    s0="$(awk '/^t0 /{for(i=1;i<=NF;i++) if($i ~ /^sha256=/) print $i}' "${dir}/jar_digest.txt")"
    s1="$(awk '/^t1 /{for(i=1;i<=NF;i++) if($i ~ /^sha256=/) print $i}' "${dir}/jar_digest.txt")"
    {
      echo "jar_present=yes"
      echo "jar_path=${jar}"
      if test "${s0}" = "${s1}"; then echo "same_session_hash_stable=yes"; else echo "same_session_hash_stable=no (live browser writes)"; fi
      echo "lifecycle_step=none — t0/t1 hashes are taken within ONE running session"
      echo "proves_update_computer_lifecycle=NO"
      echo "update_computer_ui=not_automated (by design; Bitbot: do not automate)"
      echo "shared_browser=not restarted, not killed, no CDP"
      echo "reason_status=NEEDS_REVIEW — before/after hashes from a single running session do not prove the jar survives Update Computer; GAP stays open for Bit验证"
    } > "${dir}/probe_meta.txt"
  else
    {
      echo "jar_present=no"
      echo "searched:"
      printf '  %s\n' "${COOKIE_CANDIDATES[@]}"
    } > "${dir}/probe_meta.txt"
  fi

  ls -la "${HOME}/.config/google-chrome" > "${dir}/google-chrome-config.ls.txt" 2>&1 || true
  ls -la "${CHROME_PROFILE_DIR}" > "${dir}/chrome-profile.ls.txt" 2>&1 || true
  printf 'Cookies*\nLogin Data*\nWeb Data*\nHistory*\n!jar_digest.txt\n' > "${dir}/.gitignore"

  write_manifest "${dir}" "CM-0806" "${evidence_cmd}" \
    "cookie jar present; sha256/bytes/row-count read in place (jar_digest.txt), DB never copied. t0/t1 hashes are taken in ONE running session and do NOT prove the Update Computer lifecycle; Update Computer UI not automated" \
    "${status}"
  echo "[H1] CM-0806 → ${dir} (status=${status})"
}

# Sweep: no browser-profile DBs may live under artifacts (only listings/digests).
h1_profile_db_sweep() {
  local hits
  hits="$(find "${ART_ROOT}" -type f \( -name 'Cookies*' -o -name 'Login Data*' -o -name 'Web Data*' -o -name 'History*' -o -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.db' \) 2>/dev/null || true)"
  local f
  while IFS= read -r f; do
    test -n "${f}" || continue
    if head -c 16 "${f}" 2>/dev/null | grep -q 'SQLite format'; then hits="${hits}"$'\n'"${f}"; fi
  done < <(find "${ART_ROOT}" -type f -size +1k 2>/dev/null)
  hits="$(printf '%s\n' "${hits}" | sed '/^$/d' | sort -u)"
  if test -n "${hits}"; then
    echo "[H1] SWEEP: removing browser profile DB copies under artifacts:" >&2
    printf '%s\n' "${hits}" >&2
    printf '%s\n' "${hits}" | while IFS= read -r f; do rm -f -- "${f}"; done
  fi
  echo "[H1] profile-DB sweep: $(test -n "${hits}" && echo "removed" || echo "clean")"
}

h1_cleanup() {
  # Only ever tears down our isolated throwaway browser. Shared session untouched.
  if test -n "${ISO_TMP}"; then
    iso_stop "${ART_ROOT}" || true
  fi
}
trap h1_cleanup EXIT

target="${1:-all}"
case "${target}" in
  all)
    run_cm0605
    run_cm0802
    run_cm2160
    run_cm0806
    ;;
  cm-0605|CM-0605) run_cm0605 ;;
  cm-0802|CM-0802) run_cm0802 ;;
  cm-2160|CM-2160) run_cm2160 ;;
  cm-0806|CM-0806) run_cm0806 ;;
  *)
    echo "usage: $0 [all|cm-0605|cm-0802|cm-2160|cm-0806]" >&2
    exit 2
    ;;
esac

{
  echo "# H1 host-integration artifacts"
  echo
  echo "Generated: ${STAMP} (UTC). Runner: \`scripts/host_h1_smoke.sh\`"
  echo
  echo "| CM | evidence_cmd | dir |"
  echo "|----|--------------|-----|"
  echo "| CM-0605 | \`bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0605\` | cm-0605-screenshot/ |"
  echo "| CM-0802 | \`bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0802\` | cm-0802-box-chrome/ |"
  echo "| CM-2160 | \`bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-2160\` | cm-2160-navigate/ |"
  echo "| CM-0806 | \`bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0806\` | cm-0806-session-jar/ |"
  echo
  echo "I-PASS is **not** claimed by this script; Bit验证 promotes from evidence."
  echo "H0 artifacts (if present) remain under cm-0607/0608/2175; this index covers H1 dirs."
} > "${ART_ROOT}/README-H1.md"

# Append H1 rows into main README if H0 wrote one — keep both.
if test -f "${ART_ROOT}/README.md"; then
  if ! grep -q 'CM-0605' "${ART_ROOT}/README.md"; then
    {
      echo
      echo "## H1"
      echo
      echo "| CM | evidence_cmd | dir |"
      echo "|----|--------------|-----|"
      echo "| CM-0605 | \`bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0605\` | cm-0605-screenshot/ |"
      echo "| CM-0802 | \`bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0802\` | cm-0802-box-chrome/ |"
      echo "| CM-2160 | \`bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-2160\` | cm-2160-navigate/ |"
      echo "| CM-0806 | \`bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0806\` | cm-0806-session-jar/ |"
    } >> "${ART_ROOT}/README.md"
  fi
fi

h1_profile_db_sweep
echo "[H1] done → ${ART_ROOT}"
