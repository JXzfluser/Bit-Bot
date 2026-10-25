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
# 移动端三块门禁（G-47，已并入 scripts/smoke_grok_desktop_parity.sh）：
node scripts/e2e_android_turn.mjs        # 真 HTTP + 真内核：/v1/turn 鉴权、机器身份、设备工具、在线证据
node scripts/prove_android_build.mjs     # 真编译 universalDebug APK + aapt 读回包名/权限/SDK
ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_android_roster.mjs  # 真实 Electron：桌面花名册看得见手机在线
cd hosts/android/BitBotHost && gradle :app:testUniversalDebugUnitTest        # 线路解析的 JVM 单测
```

`e2e_android_turn.mjs` 带 `NEG_CONTROL=1` 会退回旧机器 id 并假装所有设备在线，断言必须翻红 —— 用来证明这组门禁不是恒真装饰。

## 远端回合挂在哪台机器上

手机打 `/v1/turn` 时 `machine_kind` 是 `android` / `ios`，Host 必须把它落到内核注册表里
真实存在的那台机器（`box_host/machines.mbt` 的 `seed()`：`desk-1` / `phone-ios` /
`phone-android`）。落到 `android-inbound` 这种自造 id 上，内核就把回合挂到一台不存在的
设备上：`device tools` 返回 0 个工具，`run_on_machine` 报 unknown machine。
映射在 `hosts/shared/cn_inbound_product_on_turn.js` 的 `seedMachineId()`。

「在不在线」不由内核猜：过了 ADR 0008 鉴权的回合由 Host 记进 `data/machines/presence.json`
（`hosts/shared/machine_presence.js`），花名册只点亮 TTL 内有证据的设备，过期设备显示
离线并带上最后一次证据时间；没有任何证据的设备明说「未配对」。401 不记账。

同一条映射也被桌面 app 自己用：`hosts/desktop/main.js` 里 `ensureCnInbound()` 的内联
`onTurn` 以前自己拼 `${machineKind}-1`（`android-1` / `ios-1`，内核注册表里根本没有），
于是「共享模块修好了、产品还是断的」。现在它调同一个 `seedMachineId()`，由
`e2e_android_roster.mjs` 的 AR-06 / AR-07 在真实 Electron 里盯着。

## 桌面侧怎么拿到配对地址与令牌

手机要连的是这台桌面大脑，缺两样东西就白搭：一个它敲得到的地址，和那台的配对令牌。
ADR 0008 默认只绑 `127.0.0.1`（`BITBOT_BIND_LAN=1` 才放开局域网），以前这两样只在
README 和磁盘上 —— 用户在界面上拿不到，手机就连不上。

现在「设置 → 凭证 → 手机配对」给得出来（`e2e_android_roster.mjs` AR-09..11 在真实
Electron 里验）：

- 配对地址按运行时端口显示，不写死 18765；只在桌面自己开着时明说「手机要连，点允许」。
- 「允许手机连接」是真开关：放开后给出本机局域网地址，门禁会真的从那个地址打一发
  `/v1/turn` 拿到 200；收回后同一个地址再也连不上，而桌面自己照常能用。
  偏好落在 `data/desktop/pairing.json`（新增本地文件，不动既有 store 契约）。
- 令牌默认只显示掩码，点「显示配对令牌」才给原文，另有复制按钮（手机上敲 64 位不算走通）。
- 账户弹层的「获取移动版」不再是占位：说清安卓版可用，并直接落到这一屏。
  应用商店安装包链接仍是后续波次，这句话也照样如实说。

## Product shell (chat-first)

`BitBotHost` MainActivity 是 Grok 风格对话：气泡 + 输入框；「能力」sheet 走
钉钉/飞书/企微与设备工具，「凭证」sheet 配 `BITBOT_HOST_URL` 与 `BITBOT_TURN_TOKEN`
（ADR 0008：不带 bearer 的 `/v1/turn` 一律 401，所以手机端必须能配令牌，否则没有自救入口）。
回合经 `TurnBridge` → Desktop `/v1/turn`（同一颗 MoonBit 大脑），失败时显示 Host/内核
报出的真实原因，不写「大概是要配密钥」这类甩锅兜底。

## 国内渠道 flavors（P4）

`app/build.gradle.kts`：`universal` / `huawei` / `xiaomi` / `honor` / `oppo` / `vivo`（`applicationIdSuffix`）。  
例：`./gradlew :app:assembleHuaweiRelease`（无 keystore 时 release 回落 debug，不假装已签）。

## Still open

- 真机 / emulator：本环境无 KVM，OS 权限弹窗、安装、UI 实机表现未验证（诚实残留）
- Play Store / 国内渠道包 signing（`BITBOT_ANDROID_STORE_*` 未配置，release 仍用 debug 签名）
- iOS 侧沿用同一套线路（`hosts/ios_host` + `machine_kind=ios`），未在 macOS 上归档验证
- Python LocalBrain（已降级 — 不使用）

