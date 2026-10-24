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
# Desktop 已启动。默认只听 127.0.0.1:18765（ADR 0008）。
# 物理机要先在 Desktop 上显式打开局域网：BITBOT_BIND_LAN=1
export BITBOT_HOST_URL=http://127.0.0.1:18765
export BITBOT_TURN_TOKEN=...   # 与 Desktop data/host/turn-token 或环境变量相同
# Simulator 默认 127.0.0.1:18765；物理机填局域网 IP，并在「凭证」写入同一个 token。
```

`TurnBridge` → `POST /v1/turn`，带 `Authorization: Bearer <BITBOT_TURN_TOKEN>`。没有这个头 Desktop 返回 401，不会跑回合。DeepSeek key 只配在 Desktop Settings。

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
