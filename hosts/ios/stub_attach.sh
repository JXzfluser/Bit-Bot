#!/usr/bin/env bash
# iOS HostAbi attach — mobile_host + MoonBit brain (machine_kind=ios).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.moon/bin:${PATH}"

echo "[hosts/ios] MachineKind::Ios → hosts/mobile_host"
bash "$ROOT/scripts/host_mobile_stub.sh" ios
echo
node "$ROOT/hosts/mobile_host/run.js" --machine-kind ios --session-id ios-stub "ListMachines"
echo
node "$ROOT/hosts/mobile_host/run.js" --machine-kind ios "device tools"
