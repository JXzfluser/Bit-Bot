# Android host stub

Registers `MachineKind::Android` against the shared MoonBit HostAbi surface.

## Attach model

1. Host process embeds or shells to MoonBit (`cmd/desktop_turn` JSON `v:1`, or a future JNI/`libbitbot`).
2. On session start, seed / merge into `@box_host.MachineRegistry` with `kind: Android`.
3. User turns call the same open_turn → policy → deliver path as Desktop.
4. Host FFI on device owns permissions (storage, network). MoonBit emits `effects` + `needs_host_ffi`; the Android host executes them.

## Stub today

```bash
bash scripts/host_mobile_stub.sh android
```

`stub_attach.sh` prints the HostAbi attach checklist and the MachineKind list from MoonBit.

## Not in scope here

- Play Store packaging
- Python LocalBrain
- Desktop-only freelancing APIs that skip `MachineKind`
