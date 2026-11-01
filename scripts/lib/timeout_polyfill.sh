#!/usr/bin/env bash
# Shared `timeout(1)` polyfill for macOS.
#
# macOS ships bash 3.2 and NO coreutils `timeout`. Every script that wrapped a
# command in `timeout N ...` therefore failed on a macOS box with
# "timeout: command not found" — and the surrounding smoke script then reported
# a wall of red assertions that had nothing to do with the product. The polyfill
# used to be copy-pasted into `smoke_grok_desktop_parity.sh` only, so every other
# smoke script that calls `timeout` still broke on macOS.
#
# Usage:  source "$(dirname "$0")/lib/timeout_polyfill.sh"
#
# The fallback has the same contract as coreutils `timeout`:
#   - runs the command
#   - returns the command's exit status
#   - returns 124 when the time limit is reached (coreutils convention)
if ! command -v timeout >/dev/null 2>&1; then
  timeout() {
    local secs=$1
    shift
    "$@" &
    local pid=$!
    local st=0
    while kill -0 "$pid" 2>/dev/null; do
      if [ "$st" -ge "$secs" ]; then
        kill -TERM "$pid" 2>/dev/null
        sleep 2
        kill -KILL "$pid" 2>/dev/null
        return 124
      fi
      sleep 1
      st=$((st + 1))
    done
    wait "$pid"
    return $?
  }
fi
