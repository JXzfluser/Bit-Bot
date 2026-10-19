#!/usr/bin/env bash
# Injectable scp mock for CopyBox cross-machine residual smoke (BITBOT_SCP_BIN).
# Never talks to a real remote host. Logs args and exits 0.
set -euo pipefail
LOG_DIR="${BITBOT_SCP_MOCK_LOG_DIR:-/tmp/bitbot-scp-mock}"
mkdir -p "$LOG_DIR"
echo "$*" >>"$LOG_DIR/invocations.log"
# Last arg is typically user@host:/remote/path — record for assertability.
printf '%s\n' "$@" >"$LOG_DIR/last-args.txt"
echo '{"ok":true,"mock":true,"args":'"$(printf '%s\n' "$@" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().splitlines()))')"'"}' \
  >"$LOG_DIR/last-scp.json"
exit 0
