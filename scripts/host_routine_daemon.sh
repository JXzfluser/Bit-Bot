#!/usr/bin/env bash
# Host routine daemon — one-shot or interval sweeps (not systemd cron).
# Product brain stays MoonBit; this only drives Host FFI routine_tick.
# Usage:
#   bash scripts/host_routine_daemon.sh                 # one sweep
#   bash scripts/host_routine_daemon.sh --sweeps 3
#   bash scripts/host_routine_daemon.sh --sweeps 3 --interval-ms 500
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SWEEPS=1
INTERVAL_MS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sweeps)
      SWEEPS="${2:-1}"
      shift 2
      ;;
    --interval-ms)
      INTERVAL_MS="${2:-0}"
      shift 2
      ;;
    *)
      echo "usage: $0 [--sweeps N] [--interval-ms MS]" >&2
      exit 2
      ;;
  esac
done
STATUS_DIR="$ROOT/data/routines"
mkdir -p "$STATUS_DIR"
export BITBOT_ROUTINE_DAEMON=1
ok=0
fail=0
for ((i=1; i<=SWEEPS; i++)); do
  echo "==> routine daemon sweep $i/$SWEEPS"
  if node hosts/cli_host/run_turn.js "tick routines" >"$STATUS_DIR/daemon-sweep-$i.json"; then
    ok=$((ok + 1))
  else
    fail=$((fail + 1))
  fi
  if [[ "$i" -lt "$SWEEPS" && "$INTERVAL_MS" -gt 0 ]]; then
    python3 - "$INTERVAL_MS" <<'PY'
import sys, time
time.sleep(max(0, int(sys.argv[1])) / 1000.0)
PY
  fi
done
python3 - "$STATUS_DIR" "$SWEEPS" "$ok" "$fail" "$INTERVAL_MS" <<'PY'
import json, os, sys, time
root, sweeps, ok, fail, interval_ms = (
  sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
)
status = {
  "daemon": True,
  "long_lived": False,
  "systemd_unit": False,
  "sweeps": sweeps,
  "interval_ms": interval_ms,
  "ok": ok,
  "fail": fail,
  "note": "interval-capable Host sweep driver — not systemd cron",
  "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
path = os.path.join(root, "daemon-status.json")
with open(path, "w") as f:
  json.dump(status, f, indent=2)
print("daemon-status", path, status)
PY
test "$fail" -eq 0
echo "OK: host_routine_daemon.sh"
