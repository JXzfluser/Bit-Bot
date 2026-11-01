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

> **2026-11-01 更正（本节原来写的是已被上游移位的旧界面）**：配对那一屏不在
> 「设置 → 凭证 → 手机配对」了，改在**「账户 → 移动端远程控制」弹窗**
> （`index.html:3168-3225`，入口 `#account-avatar-btn → #ap-remote → #mobile-control-modal`，
> 上游 `29e1725`）；钉这条的门禁也从 `e2e_android_roster.mjs` 换成
> `e2e_android_roster.v2.mjs`（G-47 现在跑后者，旧那份留在仓里作历史尺子）。
> **另外一条要如实说**：界面上现在**没有任何地方能读出那把 bearer** ——
> 旧的「掩码 + 点「显示配对令牌」+ 复制」整组控件被有意删掉了（正路是 6 位配对码，
> 令牌由 `POST /v1/pair/redeem` 直接发到手机，用户不需要抄）。于是本节下面那条
> 「高级兜底：手填地址 + 令牌」在桌面上**缺凭据出口**，已登记为
> `docs/grok-desktop-parity/parity-gaps-next.md` **GP-203**（W3 正题），别照着旧文字找按钮。

手机要连的是这台桌面大脑，缺两样东西就白搭：一个它敲得到的地址，和那台的配对令牌。
ADR 0008 默认只绑 `127.0.0.1`（`BITBOT_BIND_LAN=1` 才放开局域网），以前这两样只在
README 和磁盘上 —— 用户在界面上拿不到，手机就连不上。

现在「账户 → 移动端远程控制」给得出地址（`e2e_android_roster.v2.mjs` AR-09..14 在真实
Electron 里验）：

- 配对地址按运行时端口显示，不写死 18765；只在桌面自己开着时明说「手机要连，点允许」。
- `#mc-status` 那一行给的是手机「凭证」要填的东西：`http://<ip>:<port>`，不带 `/v1/turn`
  （路径由手机端自己补，`TurnBridge.turnEndpoint` 有 JVM 单测钉住，
  `TurnBridge.kt:67-70`「已经带 /v1/turn 就不重复拼」）。AR-12 钉住这一点：
  用户多抄一段路径就是给自己制造填错的机会。
  ~~完整端点降到开发态单独一行~~ —— 那一行（`#sec-pairing-turn`）随旧界面一起被删了，
  现在界面上只有 base；AR-12 因此不再断「必须有两行」，改断「抄的那行必须能填」。
- 配对地址挑哪块网卡由 `hosts/shared/lan_candidates.js` 决定：局域网段优先
  （192.168 > 10/8 > 172.16/12），docker0 / br-* / veth / 容器网段压到最后，
  169.254（没 DHCP）垫底；只做排序与标注，读不到就如实说没有，不编地址。
  只有公网 / 覆盖网 / 链路本地地址时，界面必须说明「手机大概率连不通」（AR-13，
  LR-01..10 门禁）。以前直接把枚举顺序的第一个显示 + 复制出去，在装过 Docker 的机器上
  那就是 172.17.0.1 —— 一个长得像配对地址、但一定连不通的东西。
- 「允许手机连接」是真开关：放开后给出本机局域网地址，门禁会真的从那个地址打一发
  `/v1/turn` 拿到 200；收回后同一个地址再也连不上，而桌面自己照常能用。
  偏好落在 `data/desktop/pairing.json`（新增本地文件，不动既有 store 契约）。
- 「复制地址」只在真有地址时可点（AR-14）。
- 桌面回传的失败码由 `TurnBridge.explainHttpReason` 翻成一句人话（AB-08）：401
  `invalid_token` 说「重抄配对令牌」，404 说「这个端口上没有 /v1/turn」，
  `Connection refused` 说「那个端口没人监听（默认 18765）」；认不得的状态码只写
  「未识别」并保留截断原文，不猜原因。机器码任何分支都留着（报障要靠它对桌面日志）。
  地址填了、令牌空着不发包就先说缺令牌 —— 那是必失败，不该伪装成网络故障。
- 配对令牌：界面上**不再显示**（旧文案「默认只显示掩码，点「显示配对令牌」才给原文，另有复制按钮」
  对应的控件已随旧界面删除）。正路是 6 位配对码 + `POST /v1/pair/redeem`，令牌由服务端直接发给手机。
  AR-09 因此改成钉安全底线：**令牌原文不许出现在渲染进程的任何地方**（整页 `innerText` 搜不到真令牌），
  而不是钉「必须有一行掩码」。「手动兜底要令牌却拿不到」这条缺口在 GP-203。
- 手机端「从哪来」这件事现在写在同一屏（`#mc-app-block`，`index.html:3207`）：
  安卓版仍是自构建安装包、没上应用商店，所以这里不给点了没反应的下载按钮。
  账户弹层里那颗独立的「获取移动版」**已被删除**（上游 `29e1725`：点了先往对话里打一段说明、
  再跳一个早已不存在的「设置 → 手机」页签，等于点了没反应）。

## Product shell (chat-first)

`BitBotHost` MainActivity 是 Grok 风格对话：气泡 + 输入框；「能力」sheet 走
钉钉/飞书/企微与设备工具，「凭证」sheet 配 `BITBOT_HOST_URL` 与 `BITBOT_TURN_TOKEN`
（ADR 0008：不带 bearer 的 `/v1/turn` 一律 401，所以手机端必须能配令牌，否则没有自救入口）。
回合经 `TurnBridge` → Desktop `/v1/turn`（同一颗 MoonBit 大脑），失败时显示 Host/内核
报出的真实原因，不写「大概是要配密钥」这类甩锅兜底。

### 配对 v1：零抄写自动发现 + 6 位配对码

未配对时首屏不再摆三段说明要求用户手抄 IP 和 64 位令牌，而是中间一个「连接 Desktop」按钮。
点下去进配对流程：

1. **扫描**：手机取自己的 Wi-Fi IPv4，枚举同 /24 的 1..254（排除 .0/.255，不猜别的网段），
   并发 32、单点超时 350ms 打 `GET /v1/pair/discover`，列出应答的桌面（名字 + IP）。
2. **选择**：点一台桌面。
3. **输码**：输入桌面生成的 6 位数字配对码（`crypto.randomInt` 生成，默认 TTL 5 分钟，
   一次性，最多 5 次尝试）。
4. **换令牌**：`POST /v1/pair/redeem` 成功后把 `base_url` 与 `turn_token` 落到现有 prefs
   （复用 `TurnBridge.setHostUrl` / `setTurnToken`，不新存一份凭证），直接回到对话可以说话。

失败按四种原因分别说人话（彼此能区分）：
- `invalid_code`：「配对码不对，还剩 N 次机会」
- `attempts_exceeded`：「配对码已失效，回桌面重新生成一个」
- `bad_request`：「请求格式不对，请重试」
- `pairing_not_open`：「桌面那边还没点「允许手机连接」」

线协议规格：`docs/design/desktop-target/pairing-v1.md`。纯逻辑（/24 枚举、应答解析、码校验、
错误映射）由 `PairingDiscoveryTest`（23 条）在 JVM 层钉住，AB-09 门禁确认这些测试真在跑。

「凭证」里手填地址 + 令牌那条路**保留**作为高级兜底（不删功能、不改现有 prefs key 语义），
但不再是唯一入口。

诚实边界：
- 网络扫描（`scanForDesktops` / `probeDesktop`）需要真机 Wi-Fi，JVM 单测不覆盖；
- `redeemCode` / `completePairing` 需要真桌面服务在跑，JVM 单测不覆盖；
- 桌面侧 `/v1/pair/*` 端点可能还没上（另一个 agent 正在改桌面侧），集成部分留残留。

## 打包 APK（GitHub Actions）

`.github/workflows/android-apk.yml` 是这条移动端产包的路：真跑 gradle 出 universal（或选 `all`
打六个国内渠道包）的 debug + release APK，再让 `scripts/prove_android_build.mjs` 用 aapt 从包里读回
包名 / 应用名 / 权限 / minSdk-targetSdk / flavor，最后把 APK 传成可下载产物（30 天保留）。
触发：push 到 `cursor/android-mobile-target-v1` 且改动落在 `hosts/android/**`，或手动 dispatch。

它声称的东西到此为止：包能编译、元数据如实。**没声称**装到真机 / emulator（runner 无设备、无 KVM），
也**没有**商店签名 —— workflow 不带 keystore，未配 `BITBOT_ANDROID_STORE_*` 时 release 回落 debug 证书
（本地实测：`app-universal-release.apk` 包名 `com.bitbot.host`，签名者 `CN=Android Debug`），
所以产物可以侧载自测，不等于能上架。

## 国内渠道 flavors（P4）

`app/build.gradle.kts`：`universal` / `huawei` / `xiaomi` / `honor` / `oppo` / `vivo`（`applicationIdSuffix`）。  
例：`./gradlew :app:assembleHuaweiRelease`（无 keystore 时 release 回落 debug，不假装已签）。

## Still open

- 真机 / emulator：本环境无 KVM，OS 权限弹窗、安装、UI 实机表现未验证（诚实残留）
- Play Store / 国内渠道包 signing（`BITBOT_ANDROID_STORE_*` 未配置，release 仍用 debug 签名）
- iOS 侧沿用同一套线路（`hosts/ios_host` + `machine_kind=ios`），未在 macOS 上归档验证
- Python LocalBrain（已降级 — 不使用）

