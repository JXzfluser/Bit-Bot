#!/usr/bin/env bash
# Android HostAbi attach — BitBotHost shell + mobile_host + MoonBit brain.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.moon/bin:${PATH}"

echo "[hosts/android] MachineKind::Android → BitBotHost + mobile_host"
test -f "$ROOT/hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/TurnBridge.kt"
bash "$ROOT/scripts/host_mobile_stub.sh" android
echo
node "$ROOT/hosts/mobile_host/run.js" --machine-kind android --session-id android-stub "ListMachines"
echo
node "$ROOT/hosts/mobile_host/run.js" --machine-kind android "device tools"
