#!/usr/bin/env bash
# iOS HostAbi attach — same MoonBit brain + Host FFI as Desktop (machine_kind=ios).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.moon/bin:${PATH}"

echo "[hosts/ios] MachineKind::Ios attach"
echo "  Host runner: hosts/cli_host/run_turn.js --machine-kind ios"
echo

bash "$ROOT/scripts/host_mobile_stub.sh" ios

echo
echo "[hosts/ios] product turn via shared Host FFI:"
node "$ROOT/hosts/cli_host/run_turn.js" --machine-kind ios --session-id ios-stub "ListMachines"
