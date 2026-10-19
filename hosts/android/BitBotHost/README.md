# BitBotHost (Android)

Native Android Host shell for Bit Bot. **MoonBit** (`cmd/desktop_turn`) remains the product brain; this app only:

1. Collects user text
2. Invokes `hosts/mobile_host/run.js` with `--machine-kind android` (ADR 0002 Host FFI)
3. Renders the `v:1` JSON turn transcript

## Layout

- `app/src/main/java/com/bitbot/host/` — Compose UI + `TurnBridge`
- Gradle Kotlin DSL (`settings.gradle.kts`, `app/build.gradle.kts`)

## Local attach (no Play Store yet)

```bash
export BITBOT_REPO_ROOT=/path/to/bitbot
bash hosts/android/stub_attach.sh
# Android Studio: open hosts/android/BitBotHost with BITBOT_REPO_ROOT set
```

Play Store packaging still requires signing; the HostAbi + turn path is the same as Desktop.
