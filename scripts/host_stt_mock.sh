#!/usr/bin/env bash
# Injectable STT mock for voice_stt residual smoke (BITBOT_STT_BIN).
set -euo pipefail
LOG_DIR="${BITBOT_STT_MOCK_LOG_DIR:-/tmp/bitbot-stt-mock}"
mkdir -p "$LOG_DIR"
wav="${1:-}"
echo "$wav" >>"$LOG_DIR/invocations.log"
if [[ -z "$wav" || ! -f "$wav" ]]; then
  echo "host_stt_mock: missing wav" >&2
  exit 2
fi
echo '{"ok":true,"mock":true,"wav":"'"$wav"'"}' >"$LOG_DIR/last-stt.json"
echo "mock stt transcript from $(basename "$wav")"
exit 0
