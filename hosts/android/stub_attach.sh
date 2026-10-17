#!/usr/bin/env bash
# Android HostAbi attach stub — documents registration; lists MachineKinds via MoonBit.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.moon/bin:${PATH}"

echo "[hosts/android] MachineKind::Android attach checklist"
echo "  1. Embed or invoke MoonBit turn CLI / future JNI lib"
echo "  2. Register machine id with kind=android in MachineRegistry"
echo "  3. Forward user text → cmd/desktop_turn JSON v:1"
echo "  4. Execute effects when needs_host_ffi=true (device FFI)"
echo

exec bash "$ROOT/scripts/host_mobile_stub.sh" android
