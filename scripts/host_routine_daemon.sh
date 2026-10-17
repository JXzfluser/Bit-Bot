#!/usr/bin/env bash
# Host routine daemon — one-shot, interval, or long-lived sweeps (not pretend systemd).
# Product brain stays MoonBit; this only drives Host FFI routine_tick.
# Usage:
#   bash scripts/host_routine_daemon.sh                 # one sweep
#   bash scripts/host_routine_daemon.sh --sweeps 3
#   bash scripts/host_routine_daemon.sh --sweeps 3 --interval-ms 500
#   bash scripts/host_routine_daemon.sh --long-lived --interval-ms 1000
#   bash scripts/host_routine_daemon.sh --write-systemd-unit
#   bash scripts/host_routine_daemon.sh --install-user-unit
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SWEEPS=1
INTERVAL_MS=0
LONG_LIVED=0
WRITE_UNIT=0
INSTALL_USER=0
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
    --long-lived)
      LONG_LIVED=1
      shift
      ;;
    --write-systemd-unit)
      WRITE_UNIT=1
      shift
      ;;
    --install-user-unit)
      INSTALL_USER=1
      WRITE_UNIT=1
      shift
      ;;
    *)
      echo "usage: $0 [--sweeps N] [--interval-ms MS] [--long-lived] [--write-systemd-unit] [--install-user-unit]" >&2
      exit 2
      ;;
  esac
done
STATUS_DIR="$ROOT/data/routines"
mkdir -p "$STATUS_DIR"
export BITBOT_ROUTINE_DAEMON=1

UNIT_SRC="$ROOT/scripts/bitbot-routine-daemon.service.example"
UNIT_DST="$STATUS_DIR/bitbot-routine-daemon.service"
USER_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
USER_UNIT_DST="$USER_UNIT_DIR/bitbot-routine-daemon.service"
SYSTEMD_UNIT=0
SYSTEMD_SCOPE=""
if [[ "$WRITE_UNIT" -eq 1 || "$LONG_LIVED" -eq 1 || "${BITBOT_ROUTINE_LONG_LIVED:-}" == "1" || "$INSTALL_USER" -eq 1 ]]; then
  if [[ -f "$UNIT_SRC" ]]; then
    # Materialize unit under data/routines (system install to /etc is operator step).
    sed "s|/workspace|$ROOT|g" "$UNIT_SRC" >"$UNIT_DST"
  fi
fi
if [[ "$INSTALL_USER" -eq 1 ]]; then
  mkdir -p "$USER_UNIT_DIR"
  if [[ -f "$UNIT_DST" ]]; then
    cp "$UNIT_DST" "$USER_UNIT_DST"
  elif [[ -f "$UNIT_SRC" ]]; then
    sed "s|/workspace|$ROOT|g" "$UNIT_SRC" >"$USER_UNIT_DST"
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    # enable without starting long-lived loop in smoke (operator starts with --now)
    systemctl --user enable bitbot-routine-daemon.service >/dev/null 2>&1 || true
  fi
fi
# Detect installed systemd unit (system or user) without requiring root.
if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-enabled bitbot-routine-daemon.service >/dev/null 2>&1 \
    || systemctl is-active bitbot-routine-daemon.service >/dev/null 2>&1 \
    || [[ -f /etc/systemd/system/bitbot-routine-daemon.service ]]; then
    SYSTEMD_UNIT=1
    SYSTEMD_SCOPE="system"
  elif systemctl --user is-enabled bitbot-routine-daemon.service >/dev/null 2>&1 \
    || systemctl --user is-active bitbot-routine-daemon.service >/dev/null 2>&1 \
    || [[ -f "$USER_UNIT_DST" ]]; then
    SYSTEMD_UNIT=1
    SYSTEMD_SCOPE="user"
  fi
fi
if [[ ( "$WRITE_UNIT" -eq 1 || "$INSTALL_USER" -eq 1 ) && "$LONG_LIVED" -eq 0 && "$SWEEPS" -eq 1 && "$INTERVAL_MS" -eq 0 ]]; then
  # Unit-scaffold / user-install only — do not run sweeps.
  python3 - "$STATUS_DIR" "$SYSTEMD_UNIT" "$UNIT_DST" "$USER_UNIT_DST" "$SYSTEMD_SCOPE" "$INSTALL_USER" <<'PY'
import json, os, sys, time
root, systemd_unit, unit_dst, user_dst, scope, install_user = (
  sys.argv[1], sys.argv[2] == "1", sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6] == "1"
)
status = {
  "daemon": False,
  "long_lived": False,
  "systemd_unit": systemd_unit,
  "systemd_unit_path": unit_dst if os.path.isfile(unit_dst) else None,
  "systemd_user_unit_path": user_dst if os.path.isfile(user_dst) else None,
  "systemd_unit_installed": systemd_unit,
  "systemd_scope": scope or None,
  "sweeps": 0,
  "interval_ms": 0,
  "ok": 0,
  "fail": 0,
  "note": (
    f"systemd {scope or 'user'} unit installed"
    if systemd_unit and install_user
    else "systemd unit scaffold written — --install-user-unit or /etc install closes residual"
  ),
  "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
path = os.path.join(root, "daemon-status.json")
with open(path, "w") as f:
  json.dump(status, f, indent=2)
print("daemon-status", path, status)
PY
  if [[ "$INSTALL_USER" -eq 1 ]]; then
    echo "OK: installed user systemd unit → $USER_UNIT_DST (systemd_unit=$SYSTEMD_UNIT scope=$SYSTEMD_SCOPE)"
  else
    echo "OK: wrote systemd unit scaffold → $UNIT_DST"
  fi
  exit 0
fi

if [[ "$LONG_LIVED" -eq 1 || "${BITBOT_ROUTINE_LONG_LIVED:-}" == "1" ]]; then
  export BITBOT_ROUTINE_LONG_LIVED=1
  LONG_LIVED=1
  if [[ "$INTERVAL_MS" -le 0 ]]; then
    INTERVAL_MS=60000
  fi
  # Bounded long-lived for smoke: BITBOT_ROUTINE_MAX_SWEEPS (default unlimited / very high).
  MAX_SWEEPS="${BITBOT_ROUTINE_MAX_SWEEPS:-0}"
  ok=0
  fail=0
  i=0
  while true; do
    i=$((i + 1))
    echo "==> routine daemon long-lived sweep $i"
    if node hosts/cli_host/run_turn.js "tick routines" >"$STATUS_DIR/daemon-sweep-$i.json"; then
      ok=$((ok + 1))
    else
      fail=$((fail + 1))
    fi
    python3 - "$STATUS_DIR" "$i" "$ok" "$fail" "$INTERVAL_MS" "$SYSTEMD_UNIT" "$UNIT_DST" "$SYSTEMD_SCOPE" "$USER_UNIT_DST" <<'PY'
import json, os, sys, time
root, sweeps, ok, fail, interval_ms, systemd_unit, unit_dst, scope, user_dst = (
  sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]),
  int(sys.argv[5]), sys.argv[6] == "1", sys.argv[7], sys.argv[8], sys.argv[9],
)
status = {
  "daemon": True,
  "long_lived": True,
  "systemd_unit": systemd_unit,
  "systemd_unit_path": unit_dst if os.path.isfile(unit_dst) else None,
  "systemd_user_unit_path": user_dst if os.path.isfile(user_dst) else None,
  "systemd_unit_installed": systemd_unit,
  "systemd_scope": scope or None,
  "sweeps": sweeps,
  "interval_ms": interval_ms,
  "ok": ok,
  "fail": fail,
  "note": (
    f"long-lived Host sweep loop + installed systemd {scope} unit"
    if systemd_unit
    else "long-lived Host sweep loop — systemd unit scaffold present; install to close residual"
  ),
  "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
path = os.path.join(root, "daemon-status.json")
with open(path, "w") as f:
  json.dump(status, f, indent=2)
print("daemon-status", path, status)
PY
    if [[ "$MAX_SWEEPS" -gt 0 && "$i" -ge "$MAX_SWEEPS" ]]; then
      break
    fi
    python3 - "$INTERVAL_MS" <<'PY'
import sys, time
time.sleep(max(0, int(sys.argv[1])) / 1000.0)
PY
  done
  test "$fail" -eq 0
  echo "OK: host_routine_daemon.sh (long-lived)"
  exit 0
fi

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
python3 - "$STATUS_DIR" "$SWEEPS" "$ok" "$fail" "$INTERVAL_MS" "$SYSTEMD_UNIT" "$UNIT_DST" "$SYSTEMD_SCOPE" "$USER_UNIT_DST" <<'PY'
import json, os, sys, time
root, sweeps, ok, fail, interval_ms, systemd_unit, unit_dst, scope, user_dst = (
  sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]),
  int(sys.argv[5]), sys.argv[6] == "1", sys.argv[7], sys.argv[8], sys.argv[9],
)
status = {
  "daemon": True,
  "long_lived": False,
  "systemd_unit": systemd_unit,
  "systemd_unit_path": unit_dst if os.path.isfile(unit_dst) else None,
  "systemd_user_unit_path": user_dst if os.path.isfile(user_dst) else None,
  "systemd_unit_installed": systemd_unit,
  "systemd_scope": scope or None,
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
