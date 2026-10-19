#!/usr/bin/env bash
# iOS HostAbi attach — BitBotHost shell + mobile_host + MoonBit brain.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.moon/bin:${PATH}"

echo "[hosts/ios] MachineKind::Ios → BitBotHost + mobile_host"
test -f "$ROOT/hosts/ios/BitBotHost/Sources/BitBotHost/TurnBridge.swift"
bash "$ROOT/scripts/host_mobile_stub.sh" ios
echo
node "$ROOT/hosts/mobile_host/run.js" --machine-kind ios --session-id ios-stub "ListMachines"
echo
node "$ROOT/hosts/mobile_host/run.js" --machine-kind ios "device tools"
