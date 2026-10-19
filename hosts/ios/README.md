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

## Product shell (chat-first)

`BitBotHost` ContentView is a Grok-style chat: bubbles + composer; 「能力」sheet for 钉钉/飞书/企微 and device tools. Turns go through `TurnBridge` → `hosts/mobile_host` → MoonBit `llm_chat` (same brain as Desktop).

## Still open

- **本阶段真机暂缓**（用户：可先不考虑 iOS/Android）；壳与同脑路径保留
- App Store / TestFlight signing & packaging
- Device-side build of BitBotHost (needs macOS / Xcode)
- Python LocalBrain (demoted — not used)
