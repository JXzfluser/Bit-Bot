# BitBotHost (Android)

Native Android Host shell for Bit Bot. **MoonBit** (`cmd/desktop_turn`) remains the product brain; this app only:

1. Collects user text
2. Invokes `hosts/mobile_host/run.js` with `--machine-kind android` (ADR 0002 Host FFI)
3. Renders the `v:1` JSON turn transcript

## Layout

- `app/src/main/java/com/bitbot/host/` — Compose UI + `TurnBridge`
- Gradle Kotlin DSL (`settings.gradle.kts`, `app/build.gradle.kts`)

## Shared Desktop brain (ADR 0008)

`TurnBridge` posts to Desktop `POST /v1/turn` with `Authorization: Bearer <BITBOT_TURN_TOKEN>` (prefs key or env). Desktop listens on `127.0.0.1:18765` unless `BITBOT_BIND_LAN=1`. The emulator uses `http://10.0.2.2:18765` and still needs the same token. A missing bearer is HTTP 401 and does not start a turn. The DeepSeek key stays on Desktop.

## Local attach (no Play Store yet)

```bash
export BITBOT_REPO_ROOT=/path/to/bitbot
bash hosts/android/stub_attach.sh
# Android Studio: open hosts/android/BitBotHost with BITBOT_REPO_ROOT set
```

Play Store packaging still requires signing; the HostAbi + turn path is the same as Desktop.
