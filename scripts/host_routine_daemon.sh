#!/usr/bin/env bash
# Host routine daemon — one-shot or N-sweep tick (not a long-lived cron).
# Product brain stays MoonBit; this only drives Host FFI routine_tick.
# Usage:
#   bash scripts/host_routine_daemon.sh            # one sweep
#   bash scripts/host_routine_daemon.sh --sweeps 3
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SWEEPS=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sweeps)
      SWEEPS="${2:-1}"
      shift 2
      ;;
    *)
      echo "usage: $0 [--sweeps N]" >&2
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
done
python3 - "$STATUS_DIR" "$SWEEPS" "$ok" "$fail" <<'PY'
import json, os, sys, time
root, sweeps, ok, fail = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
status = {
  "daemon": True,
  "long_lived": False,
  "sweeps": sweeps,
  "ok": ok,
  "fail": fail,
  "note": "one-shot Host sweep driver — not systemd cron",
  "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
path = os.path.join(root, "daemon-status.json")
with open(path, "w") as f:
  json.dump(status, f, indent=2)
print("daemon-status", path, status)
PY
test "$fail" -eq 0
echo "OK: host_routine_daemon.sh"
