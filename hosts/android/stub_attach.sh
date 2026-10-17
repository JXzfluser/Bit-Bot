#!/usr/bin/env bash
# Android HostAbi attach — same MoonBit brain + Host FFI (machine_kind=android).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.moon/bin:${PATH}"

echo "[hosts/android] MachineKind::Android attach"
echo "  Host runner: hosts/cli_host/run_turn.js --machine-kind android"
echo

bash "$ROOT/scripts/host_mobile_stub.sh" android

echo
echo "[hosts/android] product turn via shared Host FFI:"
node "$ROOT/hosts/cli_host/run_turn.js" --machine-kind android --session-id android-stub "ListMachines"
