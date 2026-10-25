# BitBotHost (Android)

Native Android Host shell for Bit Bot. **MoonBit** (`cmd/desktop_turn`) remains the product brain; this app only:

1. Collects user text
2. Invokes `hosts/mobile_host/run.js` with `--machine-kind android` (ADR 0002 Host FFI)
3. Renders the `v:1` JSON turn transcript

## Layout

- `app/src/main/java/com/bitbot/host/` — Compose UI + `TurnBridge`
- Gradle Kotlin DSL (`settings.gradle.kts`, `app/build.gradle.kts`)

## Shared Desktop brain (ADR 0008)

`TurnBridge` posts to Desktop `POST /v1/turn` with `Authorization: Bearer <BITBOT_TURN_TOKEN>` (prefs key or env). Desktop listens on `127.0.0.1` by default (ADR 0008); the port is whatever the running inbound actually bound, so don't hardcode 18765. Both values now come from the Desktop UI: Settings → 凭证 → 手机配对 shows the pairing URL (runtime port, not written into copy) and the token (masked by default; tap 显示配对令牌 / 复制令牌). Tapping 允许手机连接 opens the LAN bind (the old `BITBOT_BIND_LAN=1` env switch) and the preference persists in `data/desktop/pairing.json`; the roster gate proves the LAN address actually answers `/v1/turn` while open and refuses while closed. The emulator uses `http://10.0.2.2:<port>/v1/turn` and still needs the same token. A missing bearer is HTTP 401 and does not start a turn, and 401 traffic records no presence evidence. The DeepSeek key stays on Desktop.

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
