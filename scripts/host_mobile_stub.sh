#!/usr/bin/env bash
# Print MachineKind list (desktop + ios + android) via MoonBit ListMachines.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.moon/bin:${PATH}"
TARGET="${BITBOT_MOON_TARGET:-native}"
FOCUS="${1:-all}"

if ! command -v moon >/dev/null 2>&1; then
  echo "error: moon not found on PATH" >&2
  exit 1
fi

echo "[host_mobile_stub] focus=${FOCUS} target=${TARGET}"
JSON="$(cd "$ROOT" && moon run cmd/desktop_turn --target "$TARGET" -- "ListMachines")"
echo "$JSON"

# Extract kinds without requiring jq
KINDS="$(printf '%s\n' "$JSON" | tr ',' '\n' | sed -n 's/.*"kind":"\([^"]*\)".*/\1/p' | sort -u | tr '\n' ' ')"
echo "[host_mobile_stub] kinds: ${KINDS}"

case "$FOCUS" in
  all)
    echo "$JSON" | grep -q '"kind":"desktop"'
    echo "$JSON" | grep -q '"kind":"ios"'
    echo "$JSON" | grep -q '"kind":"android"'
    echo "[host_mobile_stub] ok: desktop+ios+android present"
    ;;
  ios)
    echo "$JSON" | grep -q '"kind":"ios"'
    echo "[host_mobile_stub] ok: ios present"
    ;;
  android)
    echo "$JSON" | grep -q '"kind":"android"'
    echo "[host_mobile_stub] ok: android present"
    ;;
  desktop)
    echo "$JSON" | grep -q '"kind":"desktop"'
    echo "[host_mobile_stub] ok: desktop present"
    ;;
  *)
    echo "usage: $0 [all|desktop|ios|android]" >&2
    exit 2
    ;;
esac
