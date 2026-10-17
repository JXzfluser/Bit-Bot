# iOS host stub

Registers `MachineKind::Ios` against the shared MoonBit HostAbi surface.

## Attach model

1. Host process embeds or shells to MoonBit (`cmd/desktop_turn` JSON `v:1`, or a future `libbitbot` dylib).
2. On session start, seed / merge into `@box_host.MachineRegistry` with `kind: Ios`.
3. User turns call the same open_turn → policy → deliver path as Desktop.
4. Host FFI on device owns permissions (Photos, Files, network). MoonBit emits `effects` + `needs_host_ffi`; the iOS host executes them.

## Stub today

```bash
# From repo root — proves Ios appears in ListMachines seed set
bash scripts/host_mobile_stub.sh ios
```

`stub_attach.sh` prints the HostAbi attach checklist and the MachineKind list from MoonBit.

## Not in scope here

- App Store packaging
- Python LocalBrain
- Desktop-only freelancing APIs that skip `MachineKind`
