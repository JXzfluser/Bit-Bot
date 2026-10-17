#!/usr/bin/env bash
# Android HostAbi attach — mobile_host + MoonBit brain (machine_kind=android).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.moon/bin:${PATH}"

echo "[hosts/android] MachineKind::Android → hosts/mobile_host"
bash "$ROOT/scripts/host_mobile_stub.sh" android
echo
node "$ROOT/hosts/mobile_host/run.js" --machine-kind android --session-id android-stub "ListMachines"
echo
node "$ROOT/hosts/mobile_host/run.js" --machine-kind android "device tools"
