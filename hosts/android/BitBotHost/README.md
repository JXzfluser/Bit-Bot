# BitBotHost (Android)

Native Android Host shell for Bit Bot. **MoonBit** (`cmd/desktop_turn`) remains the product brain; this app only:

1. Collects user text
2. Invokes `hosts/mobile_host/run.js` with `--machine-kind android` (ADR 0002 Host FFI)
3. Renders the `v:1` JSON turn transcript

## Layout

- `app/src/main/java/com/bitbot/host/` — Compose UI + `TurnBridge`
- Gradle Kotlin DSL (`settings.gradle.kts`, `app/build.gradle.kts`)

## Shared Desktop brain (ADR 0008)

`TurnBridge` posts to Desktop `POST /v1/turn` with `Authorization: Bearer <BITBOT_TURN_TOKEN>` (prefs key or env). Desktop listens on `127.0.0.1` by default (ADR 0008); the port is whatever the running inbound actually bound, so don't hardcode 18765. Both values now come from the Desktop UI: Settings → 凭证 → 手机配对 shows the pairing address (`http://<ip>:<port>` — no path, because the phone appends `/v1/turn` itself) plus the token (masked by default; tap 显示配对令牌 / 复制令牌). Tapping 允许手机连接 opens the LAN bind (the old `BITBOT_BIND_LAN=1` env switch) and the preference persists in `data/desktop/pairing.json`; the roster gate proves the LAN address actually answers `/v1/turn` while open and refuses while closed.

Address resolution inside the app is `凭证` > `BITBOT_HOST_URL` / `BITBOT_TURN_URL` > `-Dbitbot.host.url` > **not paired**. There is deliberately no built-in `http://10.0.2.2:18765` fallback any more: on a real phone that only turns "not paired" into a doomed HTTP request (the user sees a spinner plus a network error instead of "go fill 凭证"), and a hardcoded port contradicts 开放配置，不写死. Emulator users type `http://10.0.2.2:<port>` once in 凭证 (or pass `-Dbitbot.host.url`), same token as everyone else. `normalizeHostUrl` adds the missing `http://` when somebody types `192.168.1.10:18765` by hand — without it `java.net.URL` throws `MalformedURLException: no protocol` — and `turnEndpoint` appends `/v1/turn` exactly once. Both are pinned by JVM unit tests (`TurnBridgeAddressTest`, AB-06/07), no emulator needed. A missing bearer is HTTP 401 and does not start a turn, and 401 traffic records no presence evidence. The DeepSeek key stays on Desktop.

### What a failed turn says back (and why it is translated)

Desktop answers failures with stable machine codes (`invalid_token`,
`unauthorized`, `turn_token_unconfigured`, …, plus raw 404/405 HTML pages). Pasting
those verbatim into the chat bubble does two bad things: an auth problem reads like a
network problem, and a whole HTML page lands in the conversation. `explainHttpReason`
maps the known shapes to one sentence of Chinese that names the next action (re-copy
the token from 显示配对令牌; check the inbound port; the Desktop side has not generated
a token yet), always keeping the machine code itself — it is the only thing that lines
up with Desktop logs when somebody reports a bug. Unknown status codes are labelled
未识别 and never guessed at; bodies are stripped of tags and cut to 160 chars.
`tokenPrecheck` goes one step earlier: address filled but token empty cannot possibly
pass ADR 0008, so the app says so instead of making a request that is rejected for sure
(the 凭证 sheet shows 缺配对令牌 / 缺配对地址 live, so the two mistakes look different).
Pinned by `TurnBridgeHttpErrorTest` (AB-08). What is *not* covered: the wiring inside
`runTurn` (needs SharedPreferences, so no JVM-only unit test), and real device screens.

### Pairing v1: zero-typing auto-discovery + 6-digit code

The unpaired first screen no longer shows three paragraphs of instructions asking the user
to hand-copy the desktop IP and 64-character token. Instead, there's a single "连接 Desktop"
button in the middle. Tapping it enters the pairing flow:

1. **Scan**: the phone takes its own Wi-Fi IPv4, enumerates the same /24 subnet (1..254,
   excluding .0/.255, no guessing other subnets), probes with concurrency 32 and per-host
   timeout 350ms via `GET /v1/pair/discover`, and lists responding desktops (name + IP).
2. **Select**: tap one desktop.
3. **Enter code**: input the 6-digit pairing code generated on the desktop
   (`crypto.randomInt`, default TTL 5 minutes, one-time use, max 5 attempts).
4. **Redeem**: `POST /v1/pair/redeem` success writes `base_url` and `turn_token` to existing
   prefs (reusing `TurnBridge.setHostUrl` / `setTurnToken`, no separate credential store),
   then returns to the chat ready to talk.

Failures map to distinct human-readable messages per `docs/design/desktop-target/pairing-v1.md`:
- `invalid_code`: "配对码不对，还剩 N 次机会"
- `attempts_exceeded`: "配对码已失效，回桌面重新生成一个"
- `bad_request`: "请求格式不对，请重试"
- `pairing_not_open`: "桌面那边还没点「允许手机连接」"

Pure logic (/24 enumeration, discover response parsing, code validation, error mapping) is
pinned by `PairingDiscoveryTest` (23 cases) at the JVM layer; AB-09 gate confirms these tests
actually run. The manual "凭证" path (hand-typing address + token) is **preserved** as an
advanced fallback — no feature deletion, no existing prefs key semantics changed.

Honest boundaries:
- Network scanning (`scanForDesktops` / `probeDesktop`) requires real device Wi-Fi, not covered by JVM tests;
- `redeemCode` / `completePairing` require a real desktop service running, not covered by JVM tests;
- Desktop-side `/v1/pair/*` endpoints may not be up yet (another agent is working on the desktop side); integration is left as residual.

### Why 6-digit code instead of QR / hand-copy

User feedback on the old flow: "装完 APK 第一屏就是三段说明文字，要求他手抄桌面 IP 和 64 位配对令牌，
抄错一个字符就 401" — the user had to hand-copy two long strings, and one wrong character meant failure.

Trade-offs considered:
- **QR code**: zero typing, but requires camera permission + scanning UI; adds complexity and a permission
  prompt that confuses users who just want to pair. Not implemented in v1.
- **6-digit code**: minimal typing (6 digits vs 64 hex chars + IP), discoverable via LAN scan, code is
  short-lived (5 min TTL) and one-time use. Security: 1e6 space × 5 attempts ≈ 5e-6 guess probability,
  constant-time comparison prevents timing attacks. Chosen for v1.
- **Hand-copy IP + 64-char token**: preserved as advanced fallback in "凭证" sheet for edge cases
  (different subnet, firewall blocking discovery, etc.), but no longer the primary path.

The goal: pairing should feel like AirDrop / screen casting — tap to discover, enter a short code, done.

## Build & test (verified in CI here)

```bash
# 需要 Android SDK（ANDROID_HOME，或 local.properties 里的 sdk.dir）与 JDK 17+
gradle :app:assembleUniversalDebug :app:testUniversalDebugUnitTest --console=plain
node ../../../scripts/prove_android_build.mjs   # 同一个构建 + aapt 读回包里的事实
```

- `app/src/test/java/com/bitbot/host/` 是纯 JVM 单测：只测线路解析（`TurnBridge.assistantText` /
  `failureText`、`SendToUserSurface.extract`），不需要 emulator。`org.json` 在 android.jar 里
  是未 mock 即抛的空壳，所以测试类路径显式依赖真实现。
- 六个渠道 flavor（universal/huawei/xiaomi/honor/oppo/vivo）都在；release 在没有
  `BITBOT_ANDROID_STORE_*` 时回落 debug 签名 —— 这是「没上架」，不是「已签名」。

## 未验证（诚实残留）

- 真机 / emulator 安装、OS 权限弹窗的实际表现（本环境无 KVM）
- 厂商商店上架签名

## Local attach (no Play Store yet)

```bash
export BITBOT_REPO_ROOT=/path/to/bitbot
bash hosts/android/stub_attach.sh
# Android Studio: open hosts/android/BitBotHost with BITBOT_REPO_ROOT set
```

Play Store packaging still requires signing; the HostAbi + turn path is the same as Desktop.
