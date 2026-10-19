# BitBotHost (iOS)

Native iOS Host shell for Bit Bot. **MoonBit** (`cmd/desktop_turn`) remains the product brain; this app only:

1. Collects user text
2. Invokes `hosts/mobile_host/run.js` with `--machine-kind ios` (ADR 0002 Host FFI)
3. Renders the `v:1` JSON turn transcript

## Layout

- `Sources/BitBotHost/` — SwiftUI app + `TurnBridge`
- `project.yml` — XcodeGen project (open in Xcode after `xcodegen generate`)

## Local attach (no App Store yet)

```bash
export BITBOT_REPO_ROOT=/path/to/bitbot
bash hosts/ios/stub_attach.sh
# Device / Simulator: build BitBotHost in Xcode with BITBOT_REPO_ROOT set
```

App Store / TestFlight packaging still requires Apple signing; the HostAbi + turn path is the same as Desktop.
