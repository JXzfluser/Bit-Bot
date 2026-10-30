#!/usr/bin/env bash
# Injectable xdotool(/wmctrl) mock for CU native OS residual smoke (BITBOT_XDOTOOL_BIN).
# Succeeds probe (getmouselocation / search / wmctrl -l), click, and type; logs JSON.
set -euo pipefail
LOG_DIR="${BITBOT_XDOTOOL_MOCK_LOG_DIR:-/tmp/bitbot-xdotool-mock}"
mkdir -p "$LOG_DIR"
echo "$*" >>"$LOG_DIR/invocations.log"

args=("$@")
kind="unknown"
out=""

if [[ "${1:-}" == "-l" ]]; then
  # wmctrl -l style (BITBOT_WMCTRL_BIN may point here too).
  kind="wmctrl_list"
  out=$'0x01a00001  0 hostname BitBot Mock Window\n0x01a00002  0 hostname Another Window'
elif [[ "${1:-}" == "getmouselocation" ]]; then
  kind="probe"
  out=$'X=120\nY=80\nSCREEN=0\nWINDOW=123456'
elif [[ "${1:-}" == "search" ]]; then
  kind="search"
  out=$'123456\n123457'
elif [[ "${1:-}" == "mousemove" ]]; then
  kind="click"
  out=""
elif [[ "${1:-}" == "type" ]]; then
  kind="type"
  out=""
else
  kind="passthrough"
  out=""
fi

# shellcheck disable=SC2016
python3 - "$LOG_DIR" "$kind" ${args[@]+"${args[@]}"} <<'PY'
import json, os, sys
log_dir, kind = sys.argv[1], sys.argv[2]
payload = {"ok": True, "mock": True, "kind": kind, "args": sys.argv[3:]}
path = os.path.join(log_dir, "last-xdotool.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
    f.write("\n")
PY

if [[ -n "$out" ]]; then
  printf '%s\n' "$out"
fi
exit 0
