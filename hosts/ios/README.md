# iOS host

Registers `MachineKind::Ios` against the shared MoonBit HostAbi surface.

## Native shell

`BitBotHost/` — SwiftUI app that bridges turns to `hosts/mobile_host` (same MoonBit brain as Desktop). See `BitBotHost/README.md`.

## Attach model

1. Host process embeds or shells to MoonBit (`cmd/desktop_turn` JSON `v:1`, or a future `libbitbot` dylib).
2. On session start, seed / merge into `@box_host.MachineRegistry` with `kind: Ios`.
3. User turns call the same open_turn → policy → deliver path as Desktop.
4. Host FFI on device owns permissions (Photos, Files, network). MoonBit emits `effects` + `needs_host_ffi`; the iOS host executes them.

## Verify

```bash
bash hosts/ios/stub_attach.sh
bash scripts/verify_native_shells.sh
```

## Still open

- App Store / TestFlight signing & packaging
- Python LocalBrain (demoted — not used)
