# Android host

Registers `MachineKind::Android` against the shared MoonBit HostAbi surface.

## Native shell

`BitBotHost/` — Compose app that bridges turns to `hosts/mobile_host` (same MoonBit brain as Desktop). See `BitBotHost/README.md`.

## Attach model

1. Host process embeds or shells to MoonBit (`cmd/desktop_turn` JSON `v:1`, or a future JNI/`libbitbot`).
2. On session start, seed / merge into `@box_host.MachineRegistry` with `kind: Android`.
3. User turns call the same open_turn → policy → deliver path as Desktop.
4. Host FFI on device owns permissions (storage, network). MoonBit emits `effects` + `needs_host_ffi`; the Android host executes them.

## Verify

```bash
bash hosts/android/stub_attach.sh
bash scripts/verify_native_shells.sh
```

## Product shell (chat-first)

`BitBotHost` MainActivity is a Grok-style chat: bubbles + composer; 「能力」sheet for 钉钉/飞书/企微 and device tools. Turns go through `TurnBridge` → `hosts/mobile_host` → MoonBit `llm_chat` (same brain as Desktop).

## Still open

- Play Store / 国内渠道包 signing（`BITBOT_ANDROID_STORE_*`）
- Device/emulator build of BitBotHost (needs Android SDK)
- Python LocalBrain (demoted — not used)
