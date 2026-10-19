# BitBotHost (iOS)

Native iOS Host shell for Bit Bot. **MoonBit** (`cmd/desktop_turn`) remains the product brain; this app only:

1. Collects user text
2. Invokes `hosts/mobile_host/run.js` with `--machine-kind ios` (ADR 0002 Host FFI)
3. Renders the `v:1` JSON turn transcript

## Layout

- `Sources/BitBotHost/` — SwiftUI app + `TurnBridge`
- `project.yml` — XcodeGen project (open in Xcode after `xcodegen generate`)

## Product path — share Desktop brain

真机 / Simulator 优先走 Desktop 共享大脑 HTTP：

```bash
# Desktop 已启动（入站 :18765）时：
export BITBOT_HOST_URL=http://<desk-lan-ip>:18765
# Simulator 默认 127.0.0.1:18765；物理机填局域网 IP。
```

`TurnBridge` → `POST /v1/turn`（与 Android 同脑）。DeepSeek key 只配在 Desktop Settings。

## Local attach (dev checkout)

```bash
export BITBOT_REPO_ROOT=/path/to/bitbot
bash hosts/ios/stub_attach.sh
# Device / Simulator: build BitBotHost in Xcode with BITBOT_REPO_ROOT set
```

## Archive / Export (macOS only)

```bash
export BITBOT_IOS_TEAM_ID=XXXXXXXXXX
bash scripts/ios_archive_export.sh
```

Linux CI 会诚实 SKIP。App Store Connect 上传仍需 Apple 账号凭证（residual until present）。
