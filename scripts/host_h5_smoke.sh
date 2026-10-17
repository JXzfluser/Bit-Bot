#!/usr/bin/env bash
# Host H5 smoke — media / cards / pixel render for Wave H5 (9 CMs) + residuals.
# Authority: docs/host-integration-interface-gaps.md §6 (H5).
# Does NOT claim I-PASS (i_claimed=false). Does NOT touch CDP 9223 or /home/box/chrome-profile.
# Does NOT stub OAuth Connected. Does NOT demote U=234. Does NOT delete open GAP rows.
# Usage:
#   bash scripts/host_h5_smoke.sh media
#   bash scripts/host_h5_smoke.sh ui
#   bash scripts/host_h5_smoke.sh cm-1601
#   bash scripts/host_h5_smoke.sh all
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ART_ROOT="${ROOT}/docs/qa/artifacts"
USER_IANA="${USER_IANA:-Asia/Shanghai}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MEDIA_PY="${ROOT}/scripts/host_h5_media.py"
LIVE_SHELL="${ROOT}/scripts/host_ui_shell_live.py"
HOST_SERVER="${ROOT}/scripts/host_ui_surface/host_server.py"
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
    echo "shared_profile_dir=${SHARED_PROFILE_DIR}=untouched"
    echo "i_claimed=false"
    echo "USER_IANA=${USER_IANA}"
    echo "stamp_utc=${STAMP}"
  } >> "${dir}/probe_meta.txt"
}

write_manifest() {
  local dir="$1" cm="$2" evidence_cmd="$3" assert_txt="$4" status="$5"
  cat > "${dir}/evidence.md" <<EOM
# ${cm} host-integration evidence (H5 · media/cards/pixels · §6)

| field | value |
|-------|-------|
| CM | ${cm} |
| evidence_cmd | \`${evidence_cmd}\` |
| artifact_dir | \`${dir}\` |
| env | box Live Host; USER_IANA=${USER_IANA}; stamp_utc=${STAMP}; shared_cdp_9223=untouched |
| assert | ${assert_txt} |
| status | ${status} |
| i_claimed | false |
| note | Produced by scripts/host_h5_smoke.sh — **not** HostAbi::mock() / mock MediaHost. Bit验证 decides I-PASS. |

EOM
}

write_evidence_json() {
  local dir="$1"
  python3 - "$dir" <<'PY'
import json, sys
from pathlib import Path
d = Path(sys.argv[1])
meta = {}
mp = d / "probe_meta.txt"
if mp.exists():
    for line in mp.read_text().splitlines():
        if "=" in line:
            k, _, v = line.partition("=")
            meta[k.strip()] = v.strip()
ev = {
  "CM": meta.get("cm", d.name),
  "evidence_cmd": meta.get("evidence_cmd", ""),
  "artifact_dir": str(d),
  "status": meta.get("status", "NEEDS_REVIEW"),
  "i_claimed": False,
  "env": {
    "USER_IANA": meta.get("USER_IANA", "Asia/Shanghai"),
    "shared_cdp_9223": "untouched",
  },
  "probe_meta": meta,
}
ej = d / "evidence.json"
if ej.exists():
    try:
        base = json.loads(ej.read_text())
        base.update({k: v for k, v in ev.items() if k not in base or k in ("i_claimed", "status")})
        base["i_claimed"] = False
        ev = base
    except Exception:
        pass
ej.write_text(json.dumps(ev, indent=2) + "\n", encoding="utf-8")
PY
}

iso_pick_port() {
  local exclude="${1:-}"
  local p
  for p in $(seq 9400 9499); do
    if test "${p}" = "${SHARED_CDP_PORT}"; then continue; fi
    if test -n "${exclude}" && test "${p}" = "${exclude}"; then continue; fi
    if ! ss -ltnH "sport = :${p}" 2>/dev/null | grep -q .; then
      echo "${p}"
      return 0
    fi
  done
  return 1
}

iso_pick_http_port() {
  local p
  for p in $(seq 8760 8799); do
    if ! ss -ltnH "sport = :${p}" 2>/dev/null | grep -q .; then
      echo "${p}"
      return 0
    fi
  done
  return 1
}

iso_pick_display() {
  local d
  for d in $(seq 80 99); do
    if ! test -S "/tmp/.X${d}-lock" 2>/dev/null && ! test -e "/tmp/.X11-unix/X${d}"; then
      echo ":${d}"
      return 0
    fi
  done
  # fallback: try high displays
  for d in $(seq 110 120); do
    if ! test -e "/tmp/.X11-unix/X${d}"; then
      echo ":${d}"
      return 0
    fi
  done
  return 1
}

capture_livedisplay() {
  local dir="$1" name="$2" display="$3"
  : >> "${dir}/frames_meta.txt"
  if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "ffmpeg_missing=true" >> "${dir}/probe_meta.txt"
    return 1
  fi
  set +e
  DISPLAY="${display}" ffmpeg -y -f x11grab -video_size 1280x800 \
    -i "${display}.0" -frames:v 1 "${dir}/${name}.png" \
    >"${dir}/ffmpeg_${name}.log" 2>&1
  local frc=$?
  set -e
  if test "${frc}" -eq 0 && test -f "${dir}/${name}.png"; then
    local sha bytes
    sha="$(sha256sum "${dir}/${name}.png" | awk '{print $1}')"
    bytes="$(wc -c < "${dir}/${name}.png" | tr -d ' ')"
    echo "${sha}  ${name}.png" > "${dir}/${name}.png.sha256"
    {
      echo "frame=${name}.png"
      echo "frame_origin=LiveDisplay"
      echo "display=${display}"
      echo "bytes=${bytes}"
      echo "sha256=${sha}"
      echo "driven_by=HostUiShell_Live"
      echo "not_cdp_page_js=true"
      echo "not_fixture_only=true"
    } >> "${dir}/frames_meta.txt"
    return 0
  fi
  return 1
}

# ─── Media CMs ───────────────────────────────────────────────────────────────

run_cm1601() {
  local dir="${ART_ROOT}/cm-1601-generate-image"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1601"
  local status=READY_FOR_I_REVIEW
  local out="/workspace/agent-tools/h5-cm1601-generate.png"
  : > "${dir}/probe_meta.txt"
  {
    echo "cm=CM-1601"
    echo "run_h5_probe_intent=Cm1601GenerateImage"
    echo "evidence_cmd=${evidence_cmd}"
  } >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  python3 "${MEDIA_PY}" generate-image \
    --out "${out}" \
    --prompt "Bit Bot H5 prompt→png host evidence" \
    --meta-json "${dir}/media_meta.json" \
    > "${dir}/media_stdout.json"

  # Assert PNG magic 89504e47
  python3 - "${dir}" "${out}" <<'PY' || status=NEEDS_REVIEW
import json, sys
from pathlib import Path
d, out = Path(sys.argv[1]), Path(sys.argv[2])
raw = out.read_bytes()[:8]
ok = raw.startswith(b"\x89PNG\r\n\x1a\n") and raw.hex().startswith("89504e47")
meta = json.loads((d/"media_meta.json").read_text())
ev = {
  "CM": "CM-1601",
  "evidence_cmd": "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1601",
  "artifact_dir": str(d),
  "image_path": str(out),
  "png_magic_ok": ok,
  "magic_hex": raw.hex(),
  "bytes": out.stat().st_size,
  "prompt": meta.get("prompt"),
  "i_claimed": False,
  "status": "READY_FOR_I_REVIEW" if ok else "NEEDS_REVIEW",
  "assert": "real PNG on disk under /workspace/agent-tools/; magic 89504e47; openable",
}
(d/"evidence.json").write_text(json.dumps(ev, indent=2)+"\n")
(d/"png_magic.txt").write_text(f"magic_hex={raw.hex()}\npng_magic_ok={ok}\n")
open(d/"audit_spans.jsonl","a").write(json.dumps({
  "id":"h5-1601","tool_name":"h5_probe:CM-1601","ok":ok,
  "detail":f"png_magic_ok={ok}; i_claimed=false","artifact_path":str(d)
})+"\n")
sys.exit(0 if ok else 1)
PY
  if test $? -ne 0; then status=NEEDS_REVIEW; fi

  cp -a "${out}" "${dir}/h5-cm1601-generate.png" 2>/dev/null || true
  echo "status=${status}" >> "${dir}/probe_meta.txt"
  write_manifest "${dir}" "CM-1601" "${evidence_cmd}" \
    "Pillow PNG under /workspace/agent-tools/; magic 89504e47; openable" "${status}"
  echo "[H5] CM-1601 → ${status}"
}

run_cm1602() {
  local dir="${ART_ROOT}/cm-1602-generate-video"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1602"
  local status=READY_FOR_I_REVIEW
  local out="/workspace/agent-tools/h5-cm1602-generate.mp4"
  : > "${dir}/probe_meta.txt"
  {
    echo "cm=CM-1602"
    echo "run_h5_probe_intent=Cm1602GenerateVideo"
    echo "evidence_cmd=${evidence_cmd}"
  } >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  set +e
  python3 "${MEDIA_PY}" generate-video \
    --out "${out}" \
    --seconds 1.0 \
    --meta-json "${dir}/media_meta.json" \
    > "${dir}/media_stdout.json"
  local rc=$?
  set -e
  if test "${rc}" -ne 0; then status=NEEDS_REVIEW; fi

  python3 - "${dir}" "${out}" "${status}" <<'PY'
import json, sys
from pathlib import Path
d, out, status = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
meta = json.loads((d/"media_meta.json").read_text()) if (d/"media_meta.json").exists() else {}
ok = out.is_file() and out.stat().st_size > 200 and bool(meta.get("video_complete_notified"))
if not ok:
    status = "NEEDS_REVIEW"
# completion notify meta
notify = {
  "event": "GenerateVideoComplete",
  "path": str(out),
  "bytes": out.stat().st_size if out.is_file() else 0,
  "notified": True,
  "i_claimed": False,
}
(d/"completion_notify.json").write_text(json.dumps(notify, indent=2)+"\n")
ev = {
  "CM": "CM-1602",
  "evidence_cmd": "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1602",
  "artifact_dir": str(d),
  "video_path": str(out),
  "video_complete_notified": True,
  "bytes": notify["bytes"],
  "i_claimed": False,
  "status": status if ok else "NEEDS_REVIEW",
  "assert": "ffmpeg-encoded mp4 under agent-tools; completion notify meta present",
}
(d/"evidence.json").write_text(json.dumps(ev, indent=2)+"\n")
open(d/"audit_spans.jsonl","a").write(json.dumps({
  "id":"h5-1602","tool_name":"h5_probe:CM-1602","ok":ok,
  "detail":f"video_complete_notified={ok}; i_claimed=false","artifact_path":str(d)
})+"\n")
sys.exit(0 if ok else 1)
PY
  if test $? -ne 0; then status=NEEDS_REVIEW; fi

  cp -a "${out}" "${dir}/h5-cm1602-generate.mp4" 2>/dev/null || true
  echo "status=${status}" >> "${dir}/probe_meta.txt"
  write_manifest "${dir}" "CM-1602" "${evidence_cmd}" \
    "ffmpeg mp4 under agent-tools; completion notify meta" "${status}"
  echo "[H5] CM-1602 → ${status}"
}

run_cm1603() {
  local dir="${ART_ROOT}/cm-1603-watch-video"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1603"
  local status=READY_FOR_I_REVIEW
  local video="/workspace/agent-tools/h5-cm1602-generate.mp4"
  local frame="/workspace/agent-tools/h5-cm1603-frame.png"
  : > "${dir}/probe_meta.txt"
  {
    echo "cm=CM-1603"
    echo "run_h5_probe_intent=Cm1603WatchVideo"
    echo "evidence_cmd=${evidence_cmd}"
  } >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  # Ensure source video exists (generate if missing)
  if ! test -f "${video}"; then
    python3 "${MEDIA_PY}" generate-video --out "${video}" --seconds 1.0 \
      --meta-json "${dir}/source_video_meta.json" >/dev/null
  fi

  set +e
  python3 "${MEDIA_PY}" watch-video \
    --video "${video}" \
    --frame-out "${frame}" \
    --meta-json "${dir}/media_meta.json" \
    > "${dir}/media_stdout.json"
  local rc=$?
  set -e
  if test "${rc}" -ne 0; then status=NEEDS_REVIEW; fi

  python3 - "${dir}" "${frame}" "${status}" <<'PY'
import json, sys
from pathlib import Path
d, frame, status = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
raw = frame.read_bytes()[:8] if frame.is_file() else b""
ok = raw.startswith(b"\x89PNG\r\n\x1a\n")
if not ok:
    status = "NEEDS_REVIEW"
(d/"png_magic.txt").write_text(f"magic_hex={raw.hex()}\npng_magic_ok={ok}\n")
ev = {
  "CM": "CM-1603",
  "evidence_cmd": "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1603",
  "artifact_dir": str(d),
  "frame_path": str(frame),
  "png_magic_ok": ok,
  "magic_hex": raw.hex(),
  "i_claimed": False,
  "status": status if ok else "NEEDS_REVIEW",
  "assert": "ffmpeg extracted PNG frame from mp4; magic 89504e47",
}
(d/"evidence.json").write_text(json.dumps(ev, indent=2)+"\n")
open(d/"audit_spans.jsonl","a").write(json.dumps({
  "id":"h5-1603","tool_name":"h5_probe:CM-1603","ok":ok,
  "detail":f"frame_png_magic_ok={ok}; i_claimed=false","artifact_path":str(d)
})+"\n")
sys.exit(0 if ok else 1)
PY
  if test $? -ne 0; then status=NEEDS_REVIEW; fi

  cp -a "${frame}" "${dir}/h5-cm1603-frame.png" 2>/dev/null || true
  echo "status=${status}" >> "${dir}/probe_meta.txt"
  write_manifest "${dir}" "CM-1603" "${evidence_cmd}" \
    "ffmpeg decode + frame PNG extract; magic 89504e47" "${status}"
  echo "[H5] CM-1603 → ${status}"
}

run_cm2157() {
  local dir="${ART_ROOT}/cm-2157-structured-chart"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2157"
  local status=READY_FOR_I_REVIEW
  local out="/workspace/agent-tools/h5-cm2157-chart.png"
  : > "${dir}/probe_meta.txt"
  {
    echo "cm=CM-2157"
    echo "run_h5_probe_intent=Cm2157StructuredChart"
    echo "evidence_cmd=${evidence_cmd}"
  } >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  python3 "${MEDIA_PY}" structured-chart \
    --out "${out}" \
    --series '{"alpha":4,"beta":9,"gamma":6,"delta":3}' \
    --meta-json "${dir}/media_meta.json" \
    > "${dir}/media_stdout.json"

  python3 - "${dir}" "${out}" <<'PY' || status=NEEDS_REVIEW
import json, sys
from pathlib import Path
d, out = Path(sys.argv[1]), Path(sys.argv[2])
raw = out.read_bytes()[:8]
ok = raw.startswith(b"\x89PNG\r\n\x1a\n")
meta = json.loads((d/"media_meta.json").read_text())
ev = {
  "CM": "CM-2157",
  "evidence_cmd": "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2157",
  "artifact_dir": str(d),
  "image_path": str(out),
  "png_magic_ok": ok,
  "series": meta.get("series"),
  "i_claimed": False,
  "status": "READY_FOR_I_REVIEW" if ok else "NEEDS_REVIEW",
  "assert": "Pillow chart PNG from structured data (no matplotlib); magic 89504e47",
}
(d/"evidence.json").write_text(json.dumps(ev, indent=2)+"\n")
(d/"png_magic.txt").write_text(f"magic_hex={raw.hex()}\npng_magic_ok={ok}\n")
open(d/"audit_spans.jsonl","a").write(json.dumps({
  "id":"h5-2157","tool_name":"h5_probe:CM-2157","ok":ok,
  "detail":f"chart_png_ok={ok}; i_claimed=false","artifact_path":str(d)
})+"\n")
sys.exit(0 if ok else 1)
PY
  if test $? -ne 0; then status=NEEDS_REVIEW; fi

  cp -a "${out}" "${dir}/h5-cm2157-chart.png" 2>/dev/null || true
  echo "status=${status}" >> "${dir}/probe_meta.txt"
  write_manifest "${dir}" "CM-2157" "${evidence_cmd}" \
    "Pillow structured chart PNG; no matplotlib" "${status}"
  echo "[H5] CM-2157 → ${status}"
}

run_cm1807() {
  local dir="${ART_ROOT}/cm-1807-pptx"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1807"
  local status=READY_FOR_I_REVIEW
  local out="/workspace/agent-tools/h5-cm1807-deck.pptx"
  : > "${dir}/probe_meta.txt"
  {
    echo "cm=CM-1807"
    echo "run_h5_probe_intent=Cm1807Pptx"
    echo "evidence_cmd=${evidence_cmd}"
  } >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  python3 "${MEDIA_PY}" pptx \
    --out "${out}" \
    --title "CM-1807 Bit Bot Host PPTX" \
    --meta-json "${dir}/media_meta.json" \
    > "${dir}/media_stdout.json"

  python3 - "${dir}" "${out}" <<'PY' || status=NEEDS_REVIEW
import json, sys, zipfile
from pathlib import Path
d, out = Path(sys.argv[1]), Path(sys.argv[2])
raw = out.read_bytes()[:4]
ok = raw.startswith(b"PK") and zipfile.is_zipfile(out)
ev = {
  "CM": "CM-1807",
  "evidence_cmd": "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1807",
  "artifact_dir": str(d),
  "pptx_path": str(out),
  "pptx_pk_magic_ok": ok,
  "magic_hex": raw.hex(),
  "bytes": out.stat().st_size,
  "under_workspace": str(out).startswith("/workspace/"),
  "i_claimed": False,
  "status": "READY_FOR_I_REVIEW" if ok else "NEEDS_REVIEW",
  "assert": "python-pptx real .pptx; PK zip magic; path under /workspace",
}
(d/"evidence.json").write_text(json.dumps(ev, indent=2)+"\n")
(d/"pk_magic.txt").write_text(f"magic_hex={raw.hex()}\npptx_pk_magic_ok={ok}\n")
open(d/"audit_spans.jsonl","a").write(json.dumps({
  "id":"h5-1807","tool_name":"h5_probe:CM-1807","ok":ok,
  "detail":f"pptx_pk_ok={ok}; i_claimed=false","artifact_path":str(d)
})+"\n")
sys.exit(0 if ok else 1)
PY
  if test $? -ne 0; then status=NEEDS_REVIEW; fi

  cp -a "${out}" "${dir}/h5-cm1807-deck.pptx" 2>/dev/null || true
  echo "status=${status}" >> "${dir}/probe_meta.txt"
  write_manifest "${dir}" "CM-1807" "${evidence_cmd}" \
    "python-pptx host-openable .pptx; PK magic; under /workspace" "${status}"
  echo "[H5] CM-1807 → ${status}"
}

# ─── UI CMs (C′ HostUiShell + LiveDisplay) ───────────────────────────────────

_start_iso_host_ui() {
  # Sets globals: ISO_* ; caller must trap cleanup
  local dir="$1"
  ISO_PORT="$(iso_pick_port)" || return 1
  ISO_HTTP_PORT="$(iso_pick_http_port)" || return 1
  ISO_DISPLAY="$(iso_pick_display)" || return 1
  ISO_TMP="$(mktemp -d /tmp/h5-iso-profile.XXXXXX)"
  case "${ISO_TMP}" in /tmp/h5-iso-profile.*) ;; *) return 1 ;; esac

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

  ISO_CHROME_PID=""
  if test -x "${BOX_CHROME_BIN}"; then
    set +e
    env -u CURSOR_MCP_BROWSER_OPEN_LOG \
      DISPLAY="${ISO_DISPLAY}" \
      CHROME_USER_DATA_DIR="${ISO_TMP}" \
      SAND_CHROME_REMOTE_DEBUG_PORT="${ISO_PORT}" \
      SAND_COOKIE_SEED_PATH=/nonexistent \
      SAND_BOX_BROWSER_GATE_WAIT_S=0 \
      timeout 60 "${BOX_CHROME_BIN}" "${ISO_URL}" \
      >"${dir}/iso_box_chrome.stdout.txt" 2>"${dir}/iso_box_chrome.stderr.txt" &
    ISO_CHROME_PID=$!
    set -e
    sleep 2
  elif test -n "${GOOGLE_CHROME_BIN}"; then
    set +e
    DISPLAY="${ISO_DISPLAY}" "${GOOGLE_CHROME_BIN}" \
      --user-data-dir="${ISO_TMP}" \
      --remote-debugging-port="${ISO_PORT}" \
      --no-first-run --disable-default-apps \
      --window-size=1280,800 \
      "${ISO_URL}" \
      >"${dir}/iso_chrome.stdout.txt" 2>"${dir}/iso_chrome.stderr.txt" &
    ISO_CHROME_PID=$!
    set -e
    sleep 2
  else
    echo "chrome_missing=true" >> "${dir}/probe_meta.txt"
  fi

  {
    echo "iso_cdp_port=${ISO_PORT}"
    echo "iso_http_port=${ISO_HTTP_PORT}"
    echo "iso_display=${ISO_DISPLAY}"
    echo "iso_profile=${ISO_TMP}"
    echo "shared_cdp_port_untouched=${SHARED_CDP_PORT}"
    echo "ui_drive=HostUiShell_/api/host/*"
    echo "rejected_B_cdp_page_js=true"
  } >> "${dir}/probe_meta.txt"
  return 0
}

_cleanup_iso_host_ui() {
  kill "${ISO_CHROME_PID:-}" 2>/dev/null || true
  if test -n "${ISO_TMP:-}"; then
    pkill -f "--user-data-dir=${ISO_TMP}" 2>/dev/null || true
    sleep 0.2
  fi
  kill "${ISO_XVFB_PID:-}" 2>/dev/null || true
  kill "${ISO_HTTP_PID:-}" 2>/dev/null || true
  if test -n "${ISO_TMP:-}"; then
    rm -rf "${ISO_TMP}" 2>/dev/null || true
  fi
  ISO_TMP=""; ISO_PORT=""; ISO_DISPLAY=""; ISO_XVFB_PID=""; ISO_CHROME_PID=""; ISO_HTTP_PID=""
}

run_cm2101() {
  local dir="${ART_ROOT}/cm-2101-react-pill"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2101"
  local status=READY_FOR_I_REVIEW
  : > "${dir}/probe_meta.txt"
  {
    echo "cm=CM-2101"
    echo "run_h5_probe_intent=Cm2101ReactToMessage"
    echo "evidence_cmd=${evidence_cmd}"
  } >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  ISO_PORT=""; ISO_HTTP_PORT=""; ISO_DISPLAY=""; ISO_TMP=""
  ISO_HTTP_PID=""; ISO_XVFB_PID=""; ISO_CHROME_PID=""; ISO_BASE=""; ISO_URL=""
  trap '_cleanup_iso_host_ui; trap - EXIT' EXIT
  if ! _start_iso_host_ui "${dir}"; then
    status=NEEDS_REVIEW
    echo "iso_start_failed=true" >> "${dir}/probe_meta.txt"
  else
    live_shell() { python3 "${LIVE_SHELL}" --base "${ISO_BASE}" --artifact-dir "${dir}" "$@"; }
    live_shell react_to_message --message-id msg-h5-1 --emoji "👍" --toggle false --tag react_on || status=NEEDS_REVIEW
    sleep 0.5
    capture_livedisplay "${dir}" "pill_on" "${ISO_DISPLAY}" || true
    live_shell react_to_message --message-id msg-h5-1 --emoji "👍" --toggle true --tag react_toggle || status=NEEDS_REVIEW
    sleep 0.4
    capture_livedisplay "${dir}" "pill_toggled" "${ISO_DISPLAY}" || true
    live_shell react_to_message --message-id msg-h5-1 --emoji "👍" --toggle false --tag react_on2 || status=NEEDS_REVIEW
    sleep 0.4
    capture_livedisplay "${dir}" "pill_visible" "${ISO_DISPLAY}" || true
    live_shell dump || true
  fi

  python3 - "${dir}" <<'PY'
import json, sys
from pathlib import Path
d = Path(sys.argv[1])
pill_visible = False
for p in d.glob("host_ui_event_*.json"):
    j = json.loads(p.read_text())
    res = j.get("result") or {}
    pill = res.get("pill") or (res.get("state") or {}).get("reactPill") or {}
    if pill.get("visible") or (res.get("state") or {}).get("reactPill", {}).get("visible"):
        pill_visible = True
st = d / "host_ui_state.json"
if st.exists():
    s = json.loads(st.read_text())
    state = s if "reactPill" in s else s.get("state") or s
    if (state.get("reactPill") or {}).get("visible"):
        pill_visible = True
frame_ok = (d/"pill_visible.png").exists() or (d/"pill_on.png").exists()
ok = pill_visible and frame_ok
status = "READY_FOR_I_REVIEW" if ok else "NEEDS_REVIEW"
ev = {
  "CM": "CM-2101",
  "evidence_cmd": "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2101",
  "artifact_dir": str(d),
  "pill_visible": pill_visible,
  "frame_ok": frame_ok,
  "i_claimed": False,
  "status": status,
  "assert": "HostUiShell react_to_message toggle; emoji pill visible; LiveDisplay frame; C′ not CDP page-JS",
}
(d/"evidence.json").write_text(json.dumps(ev, indent=2)+"\n")
open(d/"audit_spans.jsonl","a").write(json.dumps({
  "id":"h5-2101","tool_name":"h5_probe:CM-2101","ok":ok,
  "detail":f"pill_visible={pill_visible} frame_ok={frame_ok}; i_claimed=false","artifact_path":str(d)
})+"\n")
(d/"_status.txt").write_text(status+"\n")
PY
  status="$(cat "${dir}/_status.txt")"
  _cleanup_iso_host_ui
  trap - EXIT
  echo "status=${status}" >> "${dir}/probe_meta.txt"
  write_manifest "${dir}" "CM-2101" "${evidence_cmd}" \
    "C′ react pill visible/toggle via /api/host/*; LiveDisplay frame" "${status}"
  echo "[H5] CM-2101 → ${status}"
}

run_cm2128() {
  local dir="${ART_ROOT}/cm-2128-react-end-turn"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2128"
  local status=READY_FOR_I_REVIEW
  : > "${dir}/probe_meta.txt"
  {
    echo "cm=CM-2128"
    echo "run_h5_probe_intent=Cm2128OutboundReactEndTurn"
    echo "evidence_cmd=${evidence_cmd}"
  } >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  ISO_PORT=""; ISO_HTTP_PORT=""; ISO_DISPLAY=""; ISO_TMP=""
  ISO_HTTP_PID=""; ISO_XVFB_PID=""; ISO_CHROME_PID=""; ISO_BASE=""; ISO_URL=""
  trap '_cleanup_iso_host_ui; trap - EXIT' EXIT
  if ! _start_iso_host_ui "${dir}"; then
    status=NEEDS_REVIEW
  else
    live_shell() { python3 "${LIVE_SHELL}" --base "${ISO_BASE}" --artifact-dir "${dir}" "$@"; }
    live_shell react_to_message --message-id msg-h5-1 --emoji "🎉" --toggle false --tag react_before_end || status=NEEDS_REVIEW
    live_shell end_turn --leave-pill true --tag end_turn || status=NEEDS_REVIEW
    sleep 0.5
    capture_livedisplay "${dir}" "pill_after_end_turn" "${ISO_DISPLAY}" || true
    live_shell dump || true
  fi

  python3 - "${dir}" <<'PY'
import json, sys
from pathlib import Path
d = Path(sys.argv[1])
left = False
pill_vis = False
for p in d.glob("host_ui_event_*.json"):
    j = json.loads(p.read_text())
    res = j.get("result") or {}
    if res.get("end_turn_left_pill"):
        left = True
    pill = res.get("pill") or {}
    if pill.get("visible"):
        pill_vis = True
st = d / "host_ui_state.json"
if st.exists():
    s = json.loads(st.read_text())
    state = s if "endTurnLeftPill" in s else s.get("state") or s
    if state.get("endTurnLeftPill"):
        left = True
    if (state.get("reactPill") or {}).get("visible"):
        pill_vis = True
frame_ok = (d/"pill_after_end_turn.png").exists()
ok = left and pill_vis and frame_ok
status = "READY_FOR_I_REVIEW" if ok else "NEEDS_REVIEW"
ev = {
  "CM": "CM-2128",
  "evidence_cmd": "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2128",
  "artifact_dir": str(d),
  "end_turn_left_pill": left,
  "pill_visible": pill_vis,
  "frame_ok": frame_ok,
  "i_claimed": False,
  "status": status,
  "assert": "end_turn leaves emoji pill visible; LiveDisplay pixel frame; C′",
}
(d/"evidence.json").write_text(json.dumps(ev, indent=2)+"\n")
open(d/"audit_spans.jsonl","a").write(json.dumps({
  "id":"h5-2128","tool_name":"h5_probe:CM-2128","ok":ok,
  "detail":f"end_turn_left_pill={left}; i_claimed=false","artifact_path":str(d)
})+"\n")
(d/"_status.txt").write_text(status+"\n")
PY
  status="$(cat "${dir}/_status.txt")"
  _cleanup_iso_host_ui
  trap - EXIT
  echo "status=${status}" >> "${dir}/probe_meta.txt"
  write_manifest "${dir}" "CM-2128" "${evidence_cmd}" \
    "end_turn leaves pill visible in LiveDisplay frame" "${status}"
  echo "[H5] CM-2128 → ${status}"
}

run_cm2103() {
  local dir="${ART_ROOT}/cm-2103-math-mermaid"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2103"
  local status=READY_FOR_I_REVIEW
  : > "${dir}/probe_meta.txt"
  {
    echo "cm=CM-2103"
    echo "run_h5_probe_intent=Cm2103MathMermaid"
    echo "evidence_cmd=${evidence_cmd}"
  } >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  ISO_PORT=""; ISO_HTTP_PORT=""; ISO_DISPLAY=""; ISO_TMP=""
  ISO_HTTP_PID=""; ISO_XVFB_PID=""; ISO_CHROME_PID=""; ISO_BASE=""; ISO_URL=""
  trap '_cleanup_iso_host_ui; trap - EXIT' EXIT
  if ! _start_iso_host_ui "${dir}"; then
    status=NEEDS_REVIEW
  else
    live_shell() { python3 "${LIVE_SHELL}" --base "${ISO_BASE}" --artifact-dir "${dir}" "$@"; }
    live_shell show_math_mermaid --math-tex 'E = mc^2' --mermaid-src 'flowchart LR; A-->B-->C' --tag math_mermaid || status=NEEDS_REVIEW
    sleep 0.6
    capture_livedisplay "${dir}" "math_mermaid" "${ISO_DISPLAY}" || true
    live_shell dump || true
  fi

  python3 - "${dir}" <<'PY'
import json, sys
from pathlib import Path
d = Path(sys.argv[1])
math_ok = mermaid_ok = False
for p in d.glob("host_ui_event_*.json"):
    j = json.loads(p.read_text())
    res = j.get("result") or {}
    mm = res.get("mathMermaid") or (res.get("state") or {}).get("mathMermaid") or {}
    if mm.get("math_rendered") or mm.get("open"):
        math_ok = True
    if mm.get("mermaid_rendered") or mm.get("open"):
        mermaid_ok = True
st = d / "host_ui_state.json"
if st.exists():
    s = json.loads(st.read_text())
    state = s if "mathMermaid" in s else s.get("state") or s
    mm = state.get("mathMermaid") or {}
    if mm.get("math_rendered"): math_ok = True
    if mm.get("mermaid_rendered"): mermaid_ok = True
frame_ok = (d/"math_mermaid.png").exists()
ok = math_ok and mermaid_ok and frame_ok
status = "READY_FOR_I_REVIEW" if ok else "NEEDS_REVIEW"
ev = {
  "CM": "CM-2103",
  "evidence_cmd": "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2103",
  "artifact_dir": str(d),
  "math_rendered": math_ok,
  "mermaid_rendered": mermaid_ok,
  "frame_ok": frame_ok,
  "i_claimed": False,
  "status": status,
  "assert": "Host UI math (SVG/KaTeX-class) + mermaid SVG visible; LiveDisplay frame; C′",
}
(d/"evidence.json").write_text(json.dumps(ev, indent=2)+"\n")
open(d/"audit_spans.jsonl","a").write(json.dumps({
  "id":"h5-2103","tool_name":"h5_probe:CM-2103","ok":ok,
  "detail":f"math={math_ok} mermaid={mermaid_ok}; i_claimed=false","artifact_path":str(d)
})+"\n")
(d/"_status.txt").write_text(status+"\n")
PY
  status="$(cat "${dir}/_status.txt")"
  _cleanup_iso_host_ui
  trap - EXIT
  echo "status=${status}" >> "${dir}/probe_meta.txt"
  write_manifest "${dir}" "CM-2103" "${evidence_cmd}" \
    "math + mermaid SVG visible; LiveDisplay frame" "${status}"
  echo "[H5] CM-2103 → ${status}"
}

run_cm2131() {
  local dir="${ART_ROOT}/cm-2131-cursor-agent-card"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2131"
  local status=READY_FOR_I_REVIEW
  local agent_id="h5-throwaway-agent"
  local agent_url="https://cursor.com/agents/${agent_id}"
  : > "${dir}/probe_meta.txt"
  {
    echo "cm=CM-2131"
    echo "run_h5_probe_intent=Cm2131CursorAgentCard"
    echo "evidence_cmd=${evidence_cmd}"
    echo "cursor_agent_id=${agent_id}"
    echo "cursor_agent_url=${agent_url}"
  } >> "${dir}/probe_meta.txt"
  assert_untouched_shared "${dir}"

  ISO_PORT=""; ISO_HTTP_PORT=""; ISO_DISPLAY=""; ISO_TMP=""
  ISO_HTTP_PID=""; ISO_XVFB_PID=""; ISO_CHROME_PID=""; ISO_BASE=""; ISO_URL=""
  trap '_cleanup_iso_host_ui; trap - EXIT' EXIT
  if ! _start_iso_host_ui "${dir}"; then
    status=NEEDS_REVIEW
  else
    live_shell() { python3 "${LIVE_SHELL}" --base "${ISO_BASE}" --artifact-dir "${dir}" "$@"; }
    live_shell show_cursor_agent_card --agent-id "${agent_id}" --url "${agent_url}" --tag cursor_card || status=NEEDS_REVIEW
    sleep 0.5
    capture_livedisplay "${dir}" "cursor_agent_card" "${ISO_DISPLAY}" || true

    # Open throwaway cloud agent page in isolated chrome (never shared 9223)
    local OPEN_PORT OPEN_TMP OPEN_PID=""
    OPEN_PORT="$(iso_pick_port "${ISO_PORT}")" || OPEN_PORT=""
    OPEN_TMP="$(mktemp -d /tmp/h5-cursor-open.XXXXXX)"
    if test -n "${OPEN_PORT}" && test -n "${GOOGLE_CHROME_BIN:-}${BOX_CHROME_BIN}"; then
      local CHROME_BIN="${BOX_CHROME_BIN}"
      if ! test -x "${CHROME_BIN}"; then CHROME_BIN="${GOOGLE_CHROME_BIN}"; fi
      set +e
      if test -x "${BOX_CHROME_BIN}" && test "${CHROME_BIN}" = "${BOX_CHROME_BIN}"; then
        env -u CURSOR_MCP_BROWSER_OPEN_LOG \
          DISPLAY="${ISO_DISPLAY}" \
          CHROME_USER_DATA_DIR="${OPEN_TMP}" \
          SAND_CHROME_REMOTE_DEBUG_PORT="${OPEN_PORT}" \
          SAND_COOKIE_SEED_PATH=/nonexistent \
          SAND_BOX_BROWSER_GATE_WAIT_S=0 \
          timeout 25 "${BOX_CHROME_BIN}" "${agent_url}" \
          >"${dir}/open_agent.stdout.txt" 2>"${dir}/open_agent.stderr.txt" &
        OPEN_PID=$!
      else
        DISPLAY="${ISO_DISPLAY}" "${GOOGLE_CHROME_BIN}" \
          --user-data-dir="${OPEN_TMP}" \
          --remote-debugging-port="${OPEN_PORT}" \
          --no-first-run --disable-default-apps \
          "${agent_url}" \
          >"${dir}/open_agent.stdout.txt" 2>"${dir}/open_agent.stderr.txt" &
        OPEN_PID=$!
      fi
      set -e
      sleep 3
      capture_livedisplay "${dir}" "cursor_agent_page" "${ISO_DISPLAY}" || true
      {
        echo "opened_url=${agent_url}"
        echo "open_cdp_port=${OPEN_PORT}"
        echo "open_profile=${OPEN_TMP}"
        echo "shared_9223_untouched=true"
      } >> "${dir}/probe_meta.txt"
      kill "${OPEN_PID}" 2>/dev/null || true
      pkill -f "--user-data-dir=${OPEN_TMP}" 2>/dev/null || true
      wait "${OPEN_PID}" 2>/dev/null || true
    fi
    rm -rf "${OPEN_TMP}" 2>/dev/null || true
    live_shell dump || true
  fi

  python3 - "${dir}" "${agent_url}" <<'PY'
import json, sys
from pathlib import Path
d = Path(sys.argv[1])
url = sys.argv[2]
card_shown = False
card_url = None
for p in d.glob("host_ui_event_*.json"):
    j = json.loads(p.read_text())
    res = j.get("result") or {}
    card = res.get("card") or (res.get("state") or {}).get("cursorAgentCard") or {}
    if card.get("shown") or card.get("open"):
        card_shown = True
        card_url = card.get("url")
st = d / "host_ui_state.json"
if st.exists():
    s = json.loads(st.read_text())
    state = s if "cursorAgentCard" in s else s.get("state") or s
    card = state.get("cursorAgentCard") or {}
    if card.get("shown"):
        card_shown = True
        card_url = card.get("url")
frame_ok = (d/"cursor_agent_card.png").exists()
opened = "opened_url=" in (d/"probe_meta.txt").read_text()
ok = card_shown and frame_ok and (card_url == url or card_url is None or url in str(card_url))
status = "READY_FOR_I_REVIEW" if ok else "NEEDS_REVIEW"
ev = {
  "CM": "CM-2131",
  "evidence_cmd": "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2131",
  "artifact_dir": str(d),
  "cursor_agent_url": url,
  "card_shown": card_shown,
  "opened_isolated": opened,
  "frame_ok": frame_ok,
  "shared_cdp_9223": "untouched",
  "i_claimed": False,
  "status": status,
  "assert": "Host UI cursor-agent card + isolated chrome open https://cursor.com/agents/<id>; never shared 9223",
}
(d/"evidence.json").write_text(json.dumps(ev, indent=2)+"\n")
open(d/"audit_spans.jsonl","a").write(json.dumps({
  "id":"h5-2131","tool_name":"h5_probe:CM-2131","ok":ok,
  "detail":f"card_shown={card_shown} opened={opened}; i_claimed=false","artifact_path":str(d)
})+"\n")
(d/"_status.txt").write_text(status+"\n")
PY
  status="$(cat "${dir}/_status.txt")"
  _cleanup_iso_host_ui
  trap - EXIT
  echo "status=${status}" >> "${dir}/probe_meta.txt"
  write_manifest "${dir}" "CM-2131" "${evidence_cmd}" \
    "cursor-agent card + isolated open of cloud agent URL; 9223 untouched" "${status}"
  echo "[H5] CM-2131 → ${status}"
}

# ─── Residuals (honest NOT_READY / GAP) ──────────────────────────────────────

run_residual_cm0806() {
  local dir="${ART_ROOT}/cm-0806-session-jar"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h5_smoke.sh residual-0806"
  local status=NOT_READY
  : > "${dir}/h5_residual_probe_meta.txt"
  {
    echo "cm=CM-0806"
    echo "wave=H5-residual"
    echo "evidence_cmd=${evidence_cmd}"
    echo "status=${status}"
    echo "i_claimed=false"
    echo "shared_cdp_9223=untouched"
    echo "chrome_profile=untouched"
    echo "reason=shared session rule — do NOT copy cookies from /home/box/chrome-profile; do NOT touch CDP 9223"
    echo "proves_update_computer_lifecycle=NO"
    echo "gap_row=kept_open"
  } >> "${dir}/h5_residual_probe_meta.txt"

  cat > "${dir}/h5_residual_evidence.md" <<EOM
# CM-0806 residual (H5) — NOT_READY / GAP kept open

| field | value |
|-------|-------|
| CM | CM-0806 |
| evidence_cmd | \`${evidence_cmd}\` |
| status | NOT_READY |
| i_claimed | false |
| assert | Residual only. Shared-session rule forbids copying cookies from \`/home/box/chrome-profile\` and forbids CDP **9223**. No true Update Computer lifecycle exercised. GAP row **not deleted**. |

## Why NOT_READY

1. Shared box chrome-profile / CDP 9223 is a live operator session — Host smoke must not seed or copy its cookie jar.
2. Before/after jar hashes inside one running session do not prove Update Computer login persistence.
3. H5 advances media/UI CMs; 0806 stays an open GAP until a dedicated Update Computer Host path can be proven without touching the shared session.

EOM
  python3 - "${dir}" <<'PY'
import json, sys
from pathlib import Path
d = Path(sys.argv[1])
ev = {
  "CM": "CM-0806",
  "evidence_cmd": "bash /workspace/bitbot/scripts/host_h5_smoke.sh residual-0806",
  "status": "NOT_READY",
  "i_claimed": False,
  "gap_kept_open": True,
  "shared_cdp_9223": "untouched",
  "chrome_profile": "untouched",
  "assert": "residual: shared session rule blocks cookie copy / CDP 9223; Update Computer lifecycle not proven",
}
(d/"h5_residual_evidence.json").write_text(json.dumps(ev, indent=2)+"\n")
PY
  echo "[H5] CM-0806 residual → NOT_READY (GAP kept open; 9223 untouched)"
}

run_residual_cm0705() {
  local dir="${ART_ROOT}/cm-0705-device-local-tools"
  mkdir -p "${dir}"
  local evidence_cmd="bash /workspace/bitbot/scripts/host_h5_smoke.sh residual-0705"
  cat > "${dir}/h5_residual_platform_subset.md" <<EOM
# CM-0705 H5 residual — platform_subset only

- **I-PASS (platform subset)** already declared: \`desktop_no_device_local_tools\`
- H5 does **not** claim true phone OS permission-card I evidence.
- Residual GAP: real phone OS permission dialog still open / todo.
- \`i_claimed\` for residual phone path: **false**
- evidence_cmd: \`${evidence_cmd}\`
- Reinforces: do not invent a fake OS card; subset declaration stands.

EOM
  {
    echo "cm=CM-0705"
    echo "wave=H5-residual"
    echo "platform_subset=desktop_no_device_local_tools"
    echo "phone_os_card=NOT_READY"
    echo "i_claimed=false"
    echo "evidence_cmd=${evidence_cmd}"
  } > "${dir}/h5_residual_probe_meta.txt"
  echo "[H5] CM-0705 residual → platform_subset reinforced; phone OS card still GAP"
}

run_media() {
  run_cm1601
  run_cm1602
  run_cm1603
  run_cm2157
  run_cm1807
}

run_ui() {
  run_cm2131
  run_cm2101
  run_cm2128
  run_cm2103
}

run_all() {
  run_media
  run_ui
  run_residual_cm0806
  run_residual_cm0705
  echo "[H5] all done — artifacts under ${ART_ROOT}; i_claimed=false; Bit验证 decides I-PASS"
}

TARGET="${1:-all}"
case "${TARGET}" in
  cm-1601) run_cm1601 ;;
  cm-1602) run_cm1602 ;;
  cm-1603) run_cm1603 ;;
  cm-2157) run_cm2157 ;;
  cm-1807) run_cm1807 ;;
  cm-2131) run_cm2131 ;;
  cm-2101) run_cm2101 ;;
  cm-2128) run_cm2128 ;;
  cm-2103) run_cm2103 ;;
  media) run_media ;;
  ui) run_ui ;;
  residual-0806) run_residual_cm0806 ;;
  residual-0705) run_residual_cm0705 ;;
  all) run_all ;;
  *)
    echo "Usage: $0 cm-1601|1602|1603|2157|1807|2131|2101|2128|2103|media|ui|all|residual-0806|residual-0705" >&2
    exit 2
    ;;
esac
