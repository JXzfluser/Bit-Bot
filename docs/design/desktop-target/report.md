# Bit Bot Desktop — 布局目标 + 中英文混排 + 调试面治理 · 验收报告 (Grok-inspired, Bit Bot-owned)

分支：`cursor/desktop-layout-target-v1`（基线 `cursor/desktop-chrome-tokens-a7d0`）。
所有提交仅本地，**未推送**。合同细节见同目录 `target-v1.md` / `layout-contract.md` /
`copy-contract.md`；控件清单见 `audit.md`；逐项豁免见 `i18n-allowlist.json`。

诚实性约定：真实渲染门全部走真 Electron + xvfb + Playwright；缺失内核/依赖时按
honest SKIP 处理，绝不伪造 PASS。`prove_*.js` 为源码级正则 lint（LINT ONLY），
渲染门 `e2e_desktop_layout_target.mjs` / `e2e_grok_desktop_boot.mjs` 才是真渲染证据。

---

## 0. 范围与非目标

- 目标：单一 grid 外壳 + 单一面板状态源、中英文混排单源治理、默认零调试面。
- **NG-001**：不安装/登录/抓取/反编译 Grok Bot，不做像素级复刻；全部为 Bit Bot 自有资产，
  仅“受 Grok 启发”。

---

## 1. 外壳重构（Layout Contract v1）

单一 grid，单一面板状态源 `body[data-panel] ∈ none|bot|conv|computer|tools`，
外加 `body[data-sidebar] expanded|collapsed`、`body[data-devmode] on|off`。

- 列：`var(--sidebar-w) minmax(0,1fr) var(--panel-w)`；`--panel-w` 由 `data-panel`
  在 `0px / 340px` 间切换（无第 4 列、无 `0fr` 占位列、无类矩阵）。
- 区域：`"header header header" / "agents main rail" / "agents composer rail"`；
  四个 rail 面（bot/conv/computer/tools）共用 `grid-area: rail`，互斥由单一状态源天然保证。
- 保留全部 ID / 事件 / IPC / store 路径；旧 `*-open` / `sidebar-collapsed` 类仅作为
  既有 e2e 的 JS 镜像（CSS 不再读取）。

### 几何对照（±2px band，合同 §3）

| 区域 | Before（audit 记录） | After（合同 + 真渲染实测） |
|---|---|---|
| header 高 | 68px | **56px** |
| sidebar 宽 | 280 | 280（保持） |
| 中央消息流上限 | 820 | **760**（`--content-max`，实测 msgMax ≤ 728） |
| rail 宽 | 混合 280/340 | **340**（panel=none 时 0，不留空栏） |
| grid 列 | 4 列（含 0fr 占位） | 3 列 + `--panel-w` 开关 |
| 硬编码 `#ffffff` | 45 处 | 0（`--surface` 令牌） |
| 硬编码 body 底色 | `#f5f5f7` 字面 | `--page-bg` 令牌（force-dark 覆盖） |

### 原型几何（`reference/proto-geometry-*.json`，真 Electron 渲染 prototype.html）

| state | @1440 main / rail / msgMax / hscroll | @1280 main / rail / msgMax / hscroll |
|---|---|---|
| none | 1160 / 0 / 728 / 0 | 1000 / 0 / 728 / 0 |
| bot·conv·computer·tools | 820 / 340 / 728 / 0 | 660 / 340 / 628 / 0 |
| collapsed | 1440 / 0 / 728 / 0 | 1280 / 0 / 728 / 0 |
| collapsed-tools | 1100 / 340 / 728 / 0 | 940 / 340 / 728 / 0 |

每个开启态恰好 1 个可见 rail（`railVisKids` 单元素），`hscroll=0`，区域矩形无重叠。
`validate_proto_geometry.js`：PASS=3 / FAIL=0（含负向对照：345px rail 触发超 band 断言翻假）。

---

## 2. 中英文混排（Copy Contract v1）

单源 `t(key, params)`（`{{x}}` / `{x}` 模板插值，包 `wavegT`）；`wavegLangApply` 增加
`data-i18n-title` / `data-i18n-aria` 清扫。禁止的修法（CSS 藏英文 / 清空文案 / 全局 DOM
替换 / 只修静态 HTML）均未采用。

- 三语字典键集一致：**zh-CN / zh-TW / en 各 399 键**（D-C-03 源码级 + 渲染级双确）。
- 账户弹层 `ap-*` 文案入字典（并修掉一个隐性 bug：`data-i18n` 原打在 `<button>` 上会
  抹掉内联图标 `<span>`，已下沉到 `.ap-tx`）。
- `Search / Account / Send` 等裸英文 aria-label 经 `data-i18n-aria` 走字典。
- `product_surface.js` 内置 seed job 本地化（`General assistant` → `通用助手`）。
- 逐项豁免 `i18n-allowlist.json`：**186 条**（品牌 / 协议名 / IPC id / 路径 / 模型 id /
  错误码 / env / URL / 语言自名 / 内核数据值），每条带 `text + where + reason`，无模式性放行。

### 渲染门可见文案扫描（D-C-01，仅可见节点，符合 copy-contract §4）

- zh-CN 默认可见文案：**41 个可见节点，0 处未豁免英文**（清绿）。
- D-C-04 建议指标（混排可见节点，Section-4 迁移目标，非硬门）：**10 个**，样例：
  `Kimi / Moonshot · 无 key`、`大脑就绪 · 输入消息开始 · DeepSeek / e2e-stub`、
  `国产多模型 · 经 MoonBit llm_set_model`、`连接应用 · 插件（Cmd/Ctrl+Shift+M）` 等
  （多为品牌/协议/环境名混排，属数据级或已豁免范畴）。

### 错误码治理（合同 §6.4，进行中）

- 已知码（`bot_not_found` / `invalid_value` / `avatar_too_large` 等）→ 码→三语文案映射，
  主句只显示本地文案，原始 code 仅落诊断区与 `data-code`。
- 未处理错误：主句「出现未处理的错误（{区域}）」+ 可展开「诊断详情」保留原文。
- CM-xxxx 内部验收码出现在机器面板标题（属 dev 面，默认隐藏，不计产品混排）。

### 残留（诚实）

Section-4「JS 动态串全量迁移」尚未收口：`docs/design/desktop-target/dynamic-copy-m46.md`
登记了字典区之后仍直写 DOM 的中文串（toast/gpStatus/meta/banner 等）与建议 key，作为后续
波次输入。本轮完成的是：单源管线（`t()` + 属性清扫）、静态 HTML/属性全量、可见文案扫描门、
逐项豁免、错误码映射骨架。

---

## 3. 调试面治理（Layout Contract §6）

默认产品 UI **0 个调试面**（D-D-01 实测：`[data-lab] / #probe-connectors /
#tool-webfetch / #tool-device / #cu-open` 可见命中均为 0）。

处置表：

| 面 | 分类 | 处置 | 机制 |
|---|---|---|---|
| machines rail（工具/渠道能力） | dev-tool | 归 rail(tools)，**dev-only** | `setPanel("tools")` 非 dev 拒绝；`data-lab` |
| `#tools-toggle-btn` | dev-tool | 隐藏 | `data-lab` |
| agents-lab 调试按钮 | dev-tool | 隐藏 | `data-lab` |
| machines `details.lab` ×2 | dev-tool | 隐藏 | `data-lab` + CSS `body:not([data-devmode=on]) [data-lab]{display:none}` |
| `#agent-info-panel`（raw 代理 dump） | dev-tool | JS 拒绝渲染 | inline style 无法被样式表压制，走逻辑门 |
| Alt+D debug-json overlay | dev-tool | dev-only | JS 门 + `devModeOn()` |
| `#hidden-bots-lab` | **product** | 保留（GP-118） | 维持 disclosure 形态，不入 dev-mode |
| `#gp-panel`（群建/审批/旧 Computer 行） | **product** | 保留 | Computer tab 与 rail(computer) 重复部分待后续波次收敛 |
| account / Connect apps / Marketplace / Settings | product | 侧栏底部常驻 | `#sidebar-footer` / 账户弹层 |
| approvals / 自动复核规则 | product | 产品面 | 审批卡 / 设置→通用 |

dev-mode 开关：设置→通用 `#gp-devmode-row`（持久化 `settings.dev_mode`，
`product_surface` 白名单放行）或启动 `--bitbot-devmode` / `BITBOT_DEVMODE=1`；
开启时显示 `#devmode-badge` 可见标记。渲染门实证：
- D-D-02 `setPanel(tools)` dev-off 被拒（回落 none）；
- D-D-03 dev-on 揭示 `[data-lab]` + badge；
- D-D-04 dev-on 下 rail(tools) 可用。

---

## 4. 回归结果

### 真渲染合同门 `e2e_desktop_layout_target.mjs`

**PASS=12 / FAIL=0 / SKIP=0**（1440×900 dev-off + 1280×800 dev-on，两轮真 Electron）：

- D-C-03 三语键一致（399×3）
- D-DEFAULT：boot `data-panel=none` / sidebar expanded / 无 modal / rail 0 宽（不留空栏）
- D-L-01..06 @1440、D-L-07..12 @1280：6 面板态几何对合同表 ±2px、区域不重叠、无横向滚动、
  ≤1 可见 rail、panel=none 贡献 0 宽
- D-D-01/02/03/04：调试面默认 0 可见、dev 揭示、tools 拒/放
- D-C-01：zh-CN 可见文案 0 未豁免英文

### 原始冷启动 e2e `e2e_grok_desktop_boot.mjs`

**PASS=124 / FAIL=0**（真 Electron 独立全量跑）。此前因缺内核一直 SKIP，本轮首次真实执行，
暴露并修复了三个“测试编写期”缺陷（非产品回归）：窗口标题取自 document `<title>`、
GP-121/123 假定英文名（产品对 `defaultBotName`/会话标题有本地化）、`.composer-menu`
非严格选择器命中隐藏占位（改为 `.composer-menu:not([hidden])` 精确命中活动菜单）。
GP-124..129（Bot/Computer/Conv rail 互斥、notify、detail、pin、rename、delete）在
data-panel 新模型下全绿，验证了外壳迁移未破坏既有产品流。

### lint 门与 smoke

`prove_m24/26/27/42/43/44` 重定向到 contract-v1 选择器，并保持 smoke 依赖的中文断言标签
令牌（覆盖不降反升：新增“旧 4 列 0fr 已退役”等负向护栏）。`ui_chrome.css` 令牌化后
`prove_m43` 的背景正则同时接受 `#ffffff | var(--surface)`。

全量 `smoke_grok_desktop_parity.sh`（单独运行，真 Electron + xvfb，无并发争用）：
**PASS=313 / FAIL=0**。本波起点为基线 309，新增的 G-43/G-44/合同相关断言均纳入，且
G-16 / G-24 / G-25 / G-26 / G-27 / G-28 这些“grep e2e 成功串”的段在 e2e 全绿后一并转绿。

---

## 5. 本地提交清单（`cursor/desktop-chrome-tokens-a7d0..HEAD`，未推送）

1. `38f4b3e` Phase 0：desktop-target 合同、audit、allowlist、prototype
2. `2d2edd3` 布局目标：单 grid + data-panel 状态源 + 主题安全表面
3. `2fde032` dev-mode 治理 + 真渲染布局门
4. `9fc4051` 文案波：账户菜单 i18n + aria 清扫 + 可见文案门清绿
5. `2fb4347` Docs：M46 动态中文串渲染点清单
6. `7b22916` E2E 门修复（标题 / 本地化 / composer-menu）
7. `22fa1e7` lint + e2e harness 对齐布局合同
8. `df169f3` E2E GP-123 由创建期 bot 名派生 DM 标题
9. `5086ed6` E2E GP-123 采用创建期 createdRow.name（GP-120 之后才改名）

---

## 6. 诚实残留 / 后续波次

- Section-4 动态串全量迁移未收口（`dynamic-copy-m46.md` 登记）。
- `gp-panel` 的 Computer tab 与 rail(computer) 的重复入口待收敛（合同 §6 已注明边界）。
- 内联样式 ~347、溢出/`fixed` 逃逸、残余 `!important`（`[hidden]` 全局豁免外）按合同 §3
  尚未逐条清理。
- 内核缺失（MoonBit）时相关 gate 走 honest SKIP；截图 mask/负向红（D-L-DIF）在具备
  稳定基线后再补。
- 不做像素级 Grok 对比；所有资产 Bit Bot 自有（NG-001）。

### 8.15.7 产包这条路：`.github/workflows/android-apk.yml`

「安卓版完成了」如果只能由开发机上的 gradle 证明，用户对拿到可安装包的预期就落空了。
本轮补一条 CI 产包路径：真跑 gradle 出 universal 的 debug + release APK（可选手动 dispatch 的
`channels=all` 打六个国内渠道包）→ `prove_android_build.mjs` 用 aapt 读回包里的事实 →
APK 作为可下载产物上传（30 天）。门禁在 CI 里强制走 wrapper，避免「runner 预装的 gradle」
和「工程用的 gradle」不是同一把尺子。

本地已按 workflow 的同一条任务链验过：`:app:assembleUniversalDebug`（7.7 MB，包名
`com.bitbot.host.debug`）、`:app:assembleUniversalRelease`（5.7 MB，包名 `com.bitbot.host`，
`sdkVersion 26 / targetSdk 34`），`:app:assembleDebug` / `:app:assembleRelease` 的任务图
`--dry-run` 通过（六个 flavor 都在）。

诚实边界写进了 Summary：**没有**装到真机 / emulator（runner 无设备、无 KVM）；**没有**商店签名 ——
workflow 不带 keystore，未配 `BITBOT_ANDROID_STORE_*` 时 release 回落 debug 证书
（实测签名者 DN `CN=Android Debug`），所以这些包可以侧载自测，不等于能上架。

真实 run 记录（这条路的红与绿都不靠本地嘴说）：

- 第一次 `70fbc81` → run 40356434710：**打包七步全绿、两个 APK 已上传**（`collected=2`，
  universalDebug 7.98 MB + universalRelease 5.90 MB，产物 zip 13.1 MB），但整个 job 判红 ——
  红在最后那条「写 Summary」的步骤：我把一条 `echo` 断成多行，续行被 bash 当成命令
  （`command not found` / exit 127）。包是好的，坏在尺子的文案步。
- 修复 `e6f27bd`：本地把同一段脚本原样跑一遍（exit 0，Summary 里如实列出两个包与字节数），
  再推 → run 40357426323：**12/12 步全绿**，产物 `bitbot-android-universal-e6f27bd…`（12.52 MB zip）。
- runner 上门禁读回的事实：`AB-01 APK 8 MB`、`AB-02 包名 com.bitbot.host.debug · 应用名 Bit Bot`、
  `AB-03 网络+相机+麦克风+定位`、`AB-04 minSdk/targetSdk 一致`、`AB-05 六个渠道 flavor 都在`、
  `AB-06 JVM 单测 13 用例 0 失败`；gradle `BUILD SUCCESSFUL in 3m`。

## 8.16 打磨第二轮：配对地址、错误话术、在线证据落盘

用户这轮的要求是「继续评审，找出能优化的任务打磨更多细节」。这一轮不加新功能，专挑
**已经能用、但在真实机器上会翻车**的地方，每条都先拿红再拿绿，红绿都来自真跑。

### 8.16.1 手机端配对地址归一（`hosts/android/.../TurnBridge.kt`）

评审时发现两个真机必踩的缺陷（原来怀疑的「用户粘完整 URL 会拼成双 `/v1/turn`」经代码
核对不成立，`runTurnHttp` 早就只补一次 —— 记在这里是为了别把它当成果）：

1. 什么都没配时 `hostUrl()` 回一个写死的 `http://10.0.2.2:18765`。真机上的表现不是
   「提示去配对」，而是「发出去必失败」：用户看到转圈 + 一句网络错误；写死端口本身
   也违反「开放配置，不写死」。
2. 手敲 `192.168.1.10:18765`（人最常这么填）时 `java.net.URL` 抛
   `MalformedURLException: no protocol`，旧实现把这次失败咽掉、退到本机 node runner
   （真机上根本没有），最后一句都说不清是地址写错了。

修复前红（都是真跑，不是推演）：

- `jshell` 直接复现第 2 条：`PRE-FIX RED: java.net.MalformedURLException: no protocol: 192.168.1.10:18765/v1/turn`
- gradle JVM 单测（先只提交用现有 API 的两条断言）：
  `未配对时不许回一个写死的地址 FAILED … expected null, but was:<http://10.0.2.2:18765>`
  `手填地址少了协议要补全 FAILED … expected:<[http://]192.168.1.10:18765> but was:<[]192.168.1.10:18765>`

修后：`normalizeHostUrl`（少协议补 `http://`、https 不降级）+ `turnEndpoint`（`/v1/turn`
只拼一次）两个纯函数；优先级 凭证 > env > `-Dbitbot.host.url` > **未配对(null)**，写死的
emulator 地址删掉；`unpairedText` / `pairingHint` 把「去凭证填什么」说在人话前面、原始
HTTP 与 runner 原因保留；凭证页当场显示「实际调用：…/v1/turn」或「未配对：发送一定会失败」，
placeholder 也不再写死 `10.0.2.2:18765`。绿：`:app:testUniversalDebugUnitTest` 19 用例
0 失败（原 13 + 新 6）。

### 8.16.2 桌面那一行给的是「手机要填的东西」

原来「手机配对」那一行（以及复制按钮）给的是完整端点 `http://ip:port/v1/turn`，而手机
「凭证」要填的是配对地址 base，路径由手机端补（8.16.1）。让用户多抄一段路径不是细节，
是制造填错的机会。改法：普通用户那一行 = `http://<ip>:<port>`；完整端点降到开发态单独一行
`#sec-pairing-turn`；复制也复制 base。

修复前红 —— 新断言先写进 `e2e_android_roster.mjs`，再把产品改动 `git stash` 起来跑旧代码：

- `✗ AR-12 状态里没有可填的配对地址（pair_base） — {"port":18765}`
- `✗ AR-13 放开后配对地址该是不带路径的 base — {}`

修后绿：`e2e_android_roster: PASS=17 FAIL=0`（原 14 项 + AR-12/13/14）。

### 8.16.3 配对地址该挑哪块网卡（新增 `hosts/shared/lan_candidates.js`）

旧实现把 `os.networkInterfaces()` 里非 internal 的 IPv4 按枚举顺序原样拿出来，第一个
既显示在界面上也是复制出去的内容 —— 而这个顺序不由我们决定：装过 Docker 的机器第一个是
`172.17.0.1`（docker0），云机上是公网地址，没 DHCP 时是 `169.254.*`。用同一份 fixture 跑
旧枚举逻辑复现出来的红（已固化成 LR-02 负向对照，防止这条门禁变成没牙）：

```
旧顺序 = 172.17.0.1, 172.18.0.1, 172.19.0.1, 192.168.1.23, 169.254.5.6
→ 界面显示并复制的是 docker0；真能用的 192.168.1.23 排第 4
```

新模块只做排序与标注（网段 192.168 > 10/8 > 172.16/12 容器段，虚拟接口 docker/br-/veth/
virbr/kube/cni/flannel/tunl/tap 罚分，en/eth/wlan/wi/ath/ap 加分），读不到就返回空、
不编地址、不把 127.0.0.1 糊上去。界面据此如实标注来源：只有公网 / 覆盖网 / 链路本地地址时
必须说明「手机大概率连不通」，是局域网地址就不啰嗦。

LR-07 第一次跑仍是红的（`x1:172.17.0.1` 与 `x2:192.168.1.9` 接口名认不出来时并列），
补出 `privateTier` 才绿 —— 说明只看接口名不够，网段必须兜底。
绿：`prove_pairing_lan_rank: PASS=9 FAIL=0`（LR-01..10）。
真环境佐证：这台沙箱只有公网 `eth0`，AR-13 走的就是「必须说明连不通」那条分支
（`scope=public`），不是只在 fixture 里成立。

### 8.16.4 在线证据的落盘健壮性（`hosts/shared/machine_presence.js`）

`data/machines/presence.json` 是「谁真的在线」的唯一证据来源，而每次记账都是
「读文件 → 改 → 写文件」：读-改-写不原子会互相覆盖；`fs.writeFileSync` 先截断再写，
中间有一段「空文件 / 半截 JSON」的窗口，崩溃正好落在里面就让 `readPresence` 走 catch
返回 `{}`，所有设备一起变离线。

修复前红（真并发，不是推演）：

- `✗ PD-01 并发回合把证据覆盖掉了 … 剩 10/12 条，丢：phone-test-08,phone-test-10`
- `✗ PD-02 并发写期间读到过空文件 … empty=334766/362098 · storm 最多到 7783 回合`

修后：`mkdir` 跨进程锁 + 5 秒卡死锁夺回 + tmp/fsync/rename 原子落盘（Windows rename
撞 EPERM/EEXIST 时退回「删了再换」）。绿：`prove_presence_durability: PASS=5 FAIL=0`，
修后 storm 期间 117,969 次读 0 空窗 0 半截；PD-04 仍确认合并只标注有证据的行、不新增
机器不动 id/kind（既有契约没动）。

顺带纠一个自己写的假绿：PD-01 最初用 `spawnSync` 循环 = 串行执行，12/12 全在也测不出
覆盖，改成一次性 `spawn` 全部子进程才是真并发。

### 8.16.5 其他如实化

- 开发态入站文案不再把默认端口写成事实（`Desktop 启动会拉起默认 :18765（BITBOT_CN_INBOUND_PORT 可改）`），
  并且端口读不到时不再拼 `st.port || 18765` 造一个出来。
- 「复制地址」按钮改为跟随真实可复制内容（AR-14）。**如实交代**：「没有地址 → 按钮禁用」
  这一分支在本机不可达（入站总会随 app 起来），门禁只钉住了「有地址时可点」，另一半是
  代码层修 + 残留，没假装验过。

### 8.16.6 门禁接入与回归

- `scripts/prove_pairing_lan_rank.mjs`（LR）、`scripts/prove_presence_durability.mjs`（PD）
  进 `smoke_grok_desktop_parity.sh` 新增的 **G-48** 段（纯 Node，不需要显示环境），
  锚点里写清了各自「修复前红」是哪条。
- `prove_android_build.mjs`：AB-06 用例数下限 13 → 19，新增 **AB-07** 从结果 XML 的
  `testcase name` 里确认「未配对 / 少协议」两条真在跑（写第一版时踩了个自己的坑：
  `classname="…"` 里含子串 `name="`，`[^>]*` 会捕错，改成 `<testcase\s+name="`）。
  本地 `AB-01..07 PASS=7 FAIL=0`。
- workflow 的 Summary 文案同步改成 AB-01..05 + AB-06/07，并按上次的教训把整段脚本
  抽出来在本地跑一遍（exit 0，Summary 如实列出两个 APK 的字节数）。
- 回归：`e2e_android_roster` 18/0、`e2e_android_turn` 11/0、`moon test ./cmd/desktop_turn`
  33/33、`moon test runtime` 54/54、APK 门禁 7/0。全量矩阵见 8.16.7。

### 8.16.7 全量矩阵抓出来的两处：本轮自己新欠的视觉债

跑 `bash scripts/smoke_grok_desktop_parity.sh`（moon 在 PATH 上）结果是
**PASS=355 FAIL=1**，唯一的红是 G-46 里的 `e2e_desktop_token_parity`。两条断言的原文：

```
✗ TP-03 运行时出现 1 处字面色直接上色（基线 0） — 颜色必须走 var(--token)
    → ["sec-pairing-note color=var(--warn,#b45309)"]
✗ TP-04 运行时出现 36 处字面字号（基线 34）
    → ["gp-computer-status=11px","DIV=11px","gp-group-status=11px",
       "permission-detail=12px","settings-meta=12px"]
```

两条都是我这几轮加的 `sec-pairing-note` / `sec-pairing-turn` 造成的，而且第二条
一开始把我骗了：

- TP-03 的 `var(--warn,#b45309)` 里 `--warn` **本来就存在**（`.ri-err`、`#approval .title`
  都在用），那个兜底色是我自己加的防御，加完反而成了运行时字面色。删掉兜底。
- TP-04 我先按「行内改成 `font:var(--text-sm)/1.5 var(--font-mono)` 就该归零」改了，
  再跑**还是 36**。这时候没有去动基线，而是把 HEAD 版本的 `index.html`/`main.js`
  临时换回去单独量了一次：HEAD 是 `hardFont=34`，我的版本是 `36` —— 确认是我加的，
  不是我之前怀疑的「别的轮次欠的账」。根因在尺子本身：TP-04 遍历 `el.style` 的
  属性名，行内 `font:` 简写会展开成 `font-size` 这个**长写名**，命中就计数，
  完全不看它的值是不是 `var()`。也就是说「行内用令牌」在这个尺子下仍然算债。
  门禁的提示语写的就是「字号走类型阶 class / 令牌」，正解是走 class。
- 于是把两行的字体/颜色搬进 `hosts/desktop/ui_chrome.css`（`.pairing-note` /
  `.pairing-endpoint`，`font: var(--text-sm)/1.5 var(--font-mono)`）。搬进 CSS 之后
  多了一个尺子看不见的风险：class 没定义或者被 `!important` 盖掉，浏览器退回继承值，
  肉眼只是「小了一档」，谁也不会当 bug 报。所以补了 **AR-15**（真渲染量 computed
  字号，并与 `--text-sm` 的实测值对齐），先写断言后写 CSS，修复前红是
  `AR-15 开发态端点行没走类型阶 — {"got":"14px","want":"12px"}`（继承来的 14px），
  补 CSS 后 `AR-15` 绿，`e2e_android_roster` 17/0 → **18/0**，
  `e2e_desktop_token_parity` 5/0 且 `hardFont` 回到基线 34（只降不升，没有改基线数字）。
- 顺手删掉 `pairingState()` 里没有任何消费方的 `turn_urls_base`：加可选字段是为了
  有人读，不是为了让状态对象看着更全（grep 确认只有 main.js 自己写、没人读）。

教训记一条：**尺子的计数口径要当成契约读**。TP-04 报「36 处字面字号」时我默认它数的是
「字面值」，实际它数的是「行内声明过 font-size 这个属性名」；差一个字，改法就完全不同
（前者换 `var()` 就行，后者必须换 class）。遇到「我明明按提示改了却没变」时，先证明
是不是自己造成的（换回 HEAD 量一次），再决定改代码还是改尺子。

### 8.16.8 残留（诚实）

- 真机 / emulator 仍不可用：以上手机端改动全部由 JVM 单测与代码路径证明，**没有**声称
  在真机上点过；release 包仍是 debug 签名。
- `lan_candidates` 的接口名白名单不可能穷举所有自定义命名，靠网段分层兜底（LR-07 钉住）；
  只有公网地址的机器（云机/容器）仍给不出手机能敲到的地址，界面如实说明原因，
  但「配内网穿透」这条路产品侧还没做。
- presence 锁是 best-effort 文件锁：跨机器时钟漂移、NFS/只读文件系统、Windows 语义未覆盖。
- iOS 端仍是「未实现」，本轮只把安卓路径的细节收紧。

## 8.17 手机端把桌面的失败码翻成人话（同一轮评审里的第二段）

场景是用户最容易犯、也最容易卡死的一个：配对地址抄对了，配对令牌少粘一个字符。
桌面按 ADR 0008 回 `401 {"ok":false,"error":"invalid_token"}`，手机以前把这句话
原样塞进「连不上 Desktop 大脑。桌面那边报：…」的模板里 —— 结果用户看到一段
既像网络故障、又是英文机器码的话，正确动作（去桌面点「显示配对令牌」重抄）反而没出现。

### 8.17.1 先写复现测试，结果第一版测试自己是假的

第一版 `TurnBridgeHttpErrorTest` 断言的是「消息里有没有『配对令牌』」，
`gradle :app:testUniversalDebugUnitTest` 跑出来 **23 条只红 1 条**：
`pairingHint` 的固定尾巴本来就有「在「凭证」核对配对地址与配对令牌」，
所以「提到令牌」这种断言在未修的软件上直接绿 —— 那是假门禁，不是我的实现对了。
改成断言**只有翻译层才会产出的那几处措辞**（重抄 / 显示配对令牌 / 还没生成 /
未识别 / 没人监听）之后，把 `TurnBridge.kt` 临时换回 HEAD 版本再跑，
五条全红（`24 tests completed, 5 failed`）：

```
TurnBridgeHttpErrorTest > 令牌不对时要说要重抄整串而不是只给机器码 FAILED
TurnBridgeHttpErrorTest > 页面四零四不许把HTML贴进聊天框 FAILED
TurnBridgeHttpErrorTest > 桌面没生成令牌要说问题在桌面侧不在手机 FAILED
TurnBridgeHttpErrorTest > 没见过的状态码要如实说未识别不许瞎猜 FAILED
TurnBridgeHttpErrorTest > 端口没人监听要说端口而不是贴Java异常 FAILED
```

### 8.17.2 翻译层的取舍

- 认得的码（`invalid_token` / `unauthorized` / `turn_token_unconfigured` / 签名那四个 /
  404 / 405）翻成一句点名下一步的中文，**不再附原文**：原文要么是刚解析过的 JSON，
  要么是一整页 HTML，贴在聊天框里没有信息量 —— 404 那条测试就是专门钉这一点的。
- 认不得的状态码如实写「未识别的状态码，不猜原因」并保留截断原文（去掉 `<tag>`、
  最多 160 字）；这是唯一允许出现原文的分支。
- 机器码本身在任何分支都保留（`invalid_token` 这种串仍在句子里），报障时它是
  唯一能和桌面日志对上的东西。
- 没走到 HTTP 层的三种情况分开说：地址解析不到（要说填局域网 IP 而不是机器名）、
  端口没人监听（要说默认 18765）、超时（要说同一 Wi-Fi / 防火墙）。以前这三条
  都是 `java.net.ConnectException: …` 原文。

### 8.17.3 地址填了、令牌空着：不发包就先说

`tokenPrecheck` 在打网络之前判掉「有地址、无令牌」（ADR 0008 无 bearer 必 401），
`runTurn` 仍会照旧试一次本机 dev runner，两边都不行时报的是「缺令牌」，
不再报「连不上」。凭证页那一行也分开了：只缺一栏 → `缺配对令牌` / `缺配对地址`；
两栏都有 → 显示实际端点；两栏都空 → 归「未配对」管。

这两条的红是**编译期**的（`unresolved reference: tokenPrecheck`，函数当时不存在），
没有对应的旧运行时路径可对照，不假装成运行时红。

### 8.17.4 门禁与回归

- JVM 单测 19 → **26 用例 0 失败**（新增 `TurnBridgeHttpErrorTest` 7 条）。
- `prove_android_build.mjs`：AB-06 下限 19 → 26，新增 **AB-08** 从结果 XML 里确认
  「HTML」「端口没人监听」「重抄/显示配对令牌」三条真在跑 → 本地 `PASS=8 FAIL=0`。
  （第一次写 AB-08 时顺手把 AB-07 的 `filter` 回调变量名改坏了 —— `re2.test(n)`，
  跑之前读代码发现，改回来了；这也说明门禁自己也需要被读一遍。）
- workflow Summary 文案与 `smoke_grok_desktop_parity.sh` 的 G-47 锚点同步到 AB-06/07/08。

### 8.17.5 残留（诚实）

- `runTurn` 里那条接线（先 precheck、再 runner、再决定报哪句话）没有 JVM 单测：
  它要 SharedPreferences，本工程没有 Robolectric。钉住的是 `tokenPrecheck` 本身
  与纯函数输出，接线只由代码路径证明。
- 凭证页那两行新文案只做了编译与代码路径确认，没有真机 / emulator 截图。
- 签名鉴权（`missing_signature` 等）桌面侧代码里有、手机侧不会发出去，那句提示
  属于「万一走到」的兜底，本轮没有构造出它的真实触发路径。

## 8.18 用户真机反馈推翻了一屏：配对改成「自动发现 + 6 位码」

用户装了 APK 后发来截图与原话：「安装之后就这样啊，完全不知道如何使用哦，而且各种连接
不应该最好走授权的方式，各种都要输入。用户要疯吧」。截图里第一屏就是三段说明书式文案 +
一个「配置 Desktop 配对凭证」按钮，要点开填两个字段（IP:端口、64 位令牌）。

这条反馈把前面几轮的优先级暴露成一个方向性错误：我一直在打磨「抄错之后报错写得好不好看」，
而正确的问题是**根本不该让人抄**。所以本轮直接换流程，规格落在
`docs/design/desktop-target/pairing-v1.md`：桌面点「生成配对码」出 6 位数字（TTL 5 分钟、
一次性、每码最多 5 次尝试、`crypto.randomInt` 生成、`timingSafeEqual` 比较），手机自己
扫局域网 `/v1/pair/discover` 找到桌面、输这 6 位码换回令牌，首屏改成「能直接说话 + 一个
连接按钮」。手填地址与令牌保留为高级兜底，不删。

安全口径写进规格并且自洽：LAN 内 `/v1/turn` 的 bearer 本来就是明文 HTTP，能嗅探的人今天
就能看到令牌，所以短码引导不是新增泄露面；但短码必须一次性 + 过期 + 限次 + 常量时间比较，
且 `discover` 绝不返回令牌或可推导物。401 不记在线证据这条不变。

### 8.18.1 复核时抓到的三个「看起来修了」

三个都不是实现者报告的错误结论，而是我读代码读出来的，全部要求先补红再修：

1. **redeem 把手机指向 docker0**：`cn_inbound_server.js` 用「枚举顺序第一个非 internal
   IPv4」拼 `base_url` —— 装过 Docker 的机器上就是 `172.17.0.1`，等于把「用户抄错地址」
   升级成「产品自动给错地址」，一键配对在最常见开发机上直接失效。仓库里本轮刚做的
   `hosts/shared/lan_candidates.js` 就是为杀这个坑存在的。修复：接 `rankLanIPv4()`，
   并新增可选字段 `base_url_scope` 让手机有机会说人话。红：`PC-18: FAIL — base_url must
   NOT be docker0 (172.17.0.1) — got http://172.17.0.1:PORT`；绿：`PC-18 base_url uses
   lan_candidates ranking: 192.168.1.23 (not 172.17.0.1), scope=private`。
2. **手机本机地址是占位符**：`MainActivity.kt:440` 写着 `val localIp = "192.168.1.1" //
   Placeholder`。真机连 10.x 网段时扫的是无关网段，用户永远看到「没找到 Desktop」。
   修复：`ConnectivityManager` 取 site-local IPv4，取不到返回 null 并如实说「确认手机连着
   Wi-Fi」，不猜地址。
3. **手机端把端口写死成 18765**：`probeDesktop` 里 `URL("http://$ip:18765/...")`，导致集成
   测试只能绑 18765、端口被占用就 `return`（skip）。用户改过 `BITBOT_CN_INBOUND_PORT`
   就永远配不上对，而一条会 skip 的测试不算证据。修复：扫描接受候选端口，UI 可改端口存
   prefs，以 discover 应答里的 `port` 为权威；测试改绑 ephemeral 端口并删掉 skip 路径。

另外把新加的 AB-10（禁止写死局域网默认地址）打回补了**负向对照**：原实现只抓
`val x = "192.168.1.1"`，漏类型注解与默认参数值，而且代码干净时恒绿 —— 门禁没有牙。
现在门禁自己往临时副本塞三种写死形态，断言至少抓到 3 条违规，跑完 `finally` 清干净
（已确认无残留文件）。

### 8.18.2 顺手的两处产品态度修正

- 桌面「手机配对」面板把「让手机自己找 / 生成配对码」提到「显示配对令牌 / 复制地址 /
  复制令牌」之前，手填降级为「同一 Wi-Fi 连不上时才用」。先给用户看的就是希望他用的。
  改完真渲染复跑：`e2e_android_roster` 20/0、`e2e_desktop_token_parity` 5/0，
  行内字面字号基线仍是 34（新文案一律走 class + token）。
- 规格补一条纪律：端口/地址不许写死，任何「默认值」都要能追溯到运行时真值。

### 8.18.3 证据

`prove_pairing_code` PC-01..19 **PASS=19 FAIL=0**（其中 PC-13 是端到端那一条：用 redeem
换到的令牌真打 `/v1/turn` 并跑通回合，证明「配对完真的能说话」而不是只测函数）；
`prove_android_build` **PASS=10 FAIL=0**（AB-06 下限提到 62，实际 66 用例 0 失败）；
`e2e_android_roster` **20/0**；token 门禁 **5/0**；`moon test ./cmd/desktop_turn` **33/33**、
`moon test runtime` **54/54**。

### 8.18.4 残留（诚实）

- 手机端扫描与换令牌只到 JVM 进程内真 HTTP 集成，**没有真机 Wi-Fi 验证**（无 KVM，
  emulator 起不来），`ConnectivityManager` 路径未在真机跑过 —— 用户手上那个 APK 需要
  重新下载才能试新流程，这一步我没法替他验。
- 多 Desktop / 多网卡局域网里可能列出别人的机器，v1 没有指纹确认。
- 桌面改端口后手机要手动同步一次（未做端口广播）。
- 公网 / 跨网段仍配不上（内网穿透没有产品路径）。
- 二维码方案（桌面渲染 QR + 手机 CameraX 解码）未做，v1 先做到零抄写。

## 8.19 提交之后才发现：我把报告的旧段落吃掉了（同一轮的自查事故）

这一段写的是我自己造成的破坏，比前面几个「看起来修了」更严重，因为它毁的是证据本身。

- 现象：`227e4ed` 提交后复核 diff，`docs/design/desktop-target/report.md` 显示
  **67 增 / 255 删**，单个 hunk 覆盖第 181 行到文件尾 —— §8.15.7、§8.16.1–8.16.8、
  §8.17.1–8.17.5 共 188 行已提交的记录没了，只剩新写的 §8.18。也就是说
  「前两轮怎么发现红、怎么修绿」的过程证据被这一轮的追加动作静默抹掉。
- 归因：往长文档尾部写多行中文时，「追加」实际被实现成「替换到文件尾」。
  上一轮同类事故（`parity-gaps-next.md` −78 行）我靠 `git stash push` 救回来了，
  但**只救文件，没有把「不许删已提交段落」变成门禁**，所以同一类事故这次直接进了提交。
- 恢复：`git show 82b6f96:…report.md` 与抽出的 §8.18 重新拼接，复核
  `git diff 82b6f96 -- …report.md` = **68 增 / 0 删**（纯增量）。没有改写历史：
  `227e4ed` 仍留在分支上，修复走新提交，保留「我犯过这个错」的痕迹。
- 门禁（新增 `scripts/prove_report_history_intact.mjs`，RH-01..06）：已交付波次的标题
  清单必须全在；标题不得重复；小节编号单调递增；代码围栏成对；行数下限 480；
  以及真正防下一次的一条 —— **HEAD 版本里任一标题在当前文件消失即 FAIL**。
  - 修复前红（跑在 `227e4ed` 那份文件上）：`RH-01` 缺 16 个标题、`RH-05` 实际 251 行，
    `PASS=4 FAIL=2`，exit=1。
  - 修复后绿：`PASS=6 FAIL=0`。
- 工作方法随之改掉两条：追加长文档一律用「取基线全文 + 拼接」而不是原地替换；
  提交前跑一次「diff 必须 0 删」的检查，而不是提交后靠肉眼发现。

## 8.20 矩阵自己抓到的偶发：在线证据在高负载下会静默丢行

G-50 那轮全量矩阵跑出来 `PASS=360 FAIL=1`，红的是上一轮我自己写的
`prove_presence_durability`（PD-01）：12 个并发子进程各记一台机器，只落下 10 行，
而**子进程零报错** —— 也就是说每个写的人都被自己的锁挡住了，却还是丢了数据。

- 复现路径不是靠猜：单独跑 3 次全绿，`yes` 打满 4 核再跑也全绿。改成读代码：
  `withPresenceLock` 判「死锁」只看目录年龄（`age > 5000ms` 就 rmdir 抢过来），
  而高负载下一个正在读-改-写的进程持锁超过 5 秒是常态。抢锁的一方读到的是
  旧内容，两边各自整行写回，后写的把先写的盖掉 —— 两个进程都以为成功，正好对上
  「丢 2 行 + 零报错」。
- 把偶发变成必现（新增 PD-06，修复前红）：夹具让一个**活着**的进程持锁 6 秒，
  第二个进程去等。实测
  `PD-06 活着的持锁者被抢走了锁 … 等待方 … 就进来了，持有方 … 才出来（早了 1002ms）`。
  同一轮还补了 PD-07（修复前红）：`锁里没有持有者身份文件，释放时无法分辨是不是自己的锁` ——
  被误判为死的进程醒来时会把**新主人**的锁 rmdir 掉，等于放第三个进程进同一个临界区。
- 修法（`hosts/shared/machine_presence.js`）：锁目录里写 `owner.json`（pid / host / token /
  started_at）；只有**证明持有者已经没了**（同机 + `process.kill(pid,0)` 失败）才抢，
  活着就不抢，哪怕它慢；跨机持有者验不了 pid，给 6 倍窗口兜底，宁可这次不记账
  也不能两个人同时写。释放时只认自己的 token，别人的锁不碰。
  修复后绿：`prove_presence_durability: PASS=7 FAIL=0`，PD-06 变成
  「等待方 2ms 之后才进临界区（互斥成立）」—— 等待方不再靠抢，而是真的排到了队尾。
- 顺手把矩阵锚点补上（G-48 新增两条红线说明），免得下一轮这条路径又静默退回去。
- 残留（诚实）：只验到同机多进程与崩溃窗口；跨机时钟漂移、只读文件系统、Windows
  文件锁语义仍未覆盖；`EPERM`（进程存在但不归我）按活着处理，代价是那台机器上
  别人的同名 pid 会让本轮记账超时不记 —— 这是有意的保守，不是漏。

## 8.21 桌面这屏也在「各种都要输入」：国内渠道凭证不裸奔

手机端配对改完之后，同样态度的下一处是桌面的钉钉/飞书/企微凭证卡
（「连接应用」里的 `#ca-cn-channels`）。这屏原来有四件事是「看起来能用、实际等着坑」：
含 `access_token` 的完整 Webhook 明文摊在屏幕上（`type="text"`）；勾了「开启推送」
但地址留空照样提示已保存；粘进一段没有 scheme 的地址照样写盘；卡里填凭证、
凭证页保存、旁边一排试连 —— 三段路要用户自己连起来。

- 门禁（新增 `scripts/e2e_desktop_cn_channel_guard.mjs`，CN-01..08，真 Electron 渲染）
  先在 HEAD 产品代码上跑红：**PASS=0 FAIL=8**，八条全红。其中最两条能说明这不是文案问题：
  CN-05 红在「有校验错误时『保存并热加载』照样能点」；CN-08 红在卡里根本没有状态行。
- 改法（只加节点与校验，不动 store/IPC 契约）：
  - `#sec-ding-hook` 改 `type="password"`，卡内 `#cn-ding-reveal` 就地显隐（按钮文案跟着变
    「显示/隐藏」）—— 掩码不是为了藏，是为了路过的人看不见、要核对时一点就有。
  - 每栏下面一个 `.st-field-error`：勾了开启却没填 → 「勾选了开启推送，Webhook 地址还是空的」；
    缺 scheme → 「要以 http:// 或 https:// 开头」；有 `access_token=` 之外的形态 →
    说明可能是机器人主页而不是 Webhook。规则只按本 app 自己的语义判，不替厂商断言格式。
  - 有红字时 `#sec-save` 直接不可点，`saveSecretsFromForm()` 里再兜一层「挡在写盘之前」，
    并如实写「没有写入」—— 先落盘再让用户回头猜为什么发不出去，是把成本挪到最贵的地方。
  - `#cn-card-state` 把三路开关状态写明（未开启也写），`#cn-goto-credentials`
    把用户一步送到凭证页的「保存并热加载 / 试连国内渠道」那一排（复用 `openProductCredentials`）。
- 视觉债没有挪地方：新文案全部走 class + 令牌，`CN-07` 当场量 computed 字号
  必须等于 `--text-sm`（12px）且无行内字面值；`e2e_desktop_token_parity` 复跑
  **PASS=5 FAIL=0**，行内字面字号仍是基线 34。
- 证据：`e2e_desktop_cn_channel_guard` **8/0**；`prove_presence_durability` **7/0**；
  `prove_report_history_intact` **6/0**（修复前红：缺 16 个标题、251 行 → PASS=4 FAIL=2）。
- 残留（诚实，以及明确没做的）：
  - 校验只到「缺字段 / 明显不是地址」这一层，厂商格式细则没验，也不打算替厂商断言。
  - 「试连国内渠道」会真的往群里发消息，门禁不敢自动点，需要在真群里人工验一次。
  - 钉钉加签密钥、飞书 `encrypt_key` / `verification_token`、企微 `callback_token`
    仍然没有输入框（只能手改 `.env.local`）—— 这是审计清单里的 P1/P3，本轮没做。
  - 「渠道配置」那张表里 6 个按钮有 5 个还是 disabled 占位（审计 P0-2），本轮没动。

## 8.22 用户说「完全没法看」之后：先让 UI 能被真渲染，再谈重构

用户这一轮的原话是「ui布局跟样式完全没法看，重构一版。必须跟主流ai相关的app对齐哦」。
上一轮手机装完 APK 的第一句反馈是「完全不知道如何使用」，那次的结论是不该让人手抄凭证；
这次的「没法看」是另一件事：版面和样式本身没有设计系统。

按老规矩，先把「能不能验证」解决掉，再动手改。

**① 先让 UI 在 JVM 上真的渲染出来。** 本环境没有 KVM，emulator 起不来。这条路上如果
只能靠肉眼读代码，「重构完了」这句话和「看起来修了」没有区别。所以补了
Robolectric 4.12.2 + `androidx.compose.ui:ui-test-junit4` + `ui-test-manifest`，
`unitTests.isIncludeAndroidResources = true`，`robolectric.properties` 钉 sdk=34，
先写一条工具链自证 `RobolectricComposeSmokeTest`：它把 `MaterialTheme.colorScheme.primary`
真读出来 —— 实测 `Color(0.40392157, 0.3137255, 0.6431373)`，也就是 **#6750A4，
Material 3 的框架默认紫**。这个数字本身就是这轮问题的体检报告：我们一直在发框架默认主题。

**② 复现测试先跑红。** `UiDesignSystemTest` 六条直接渲染真 MainActivity，在旧屏上全红，
红的原因是它真的找到了那些节点（不是我猜的）：

```
T1 [红] Expected exactly '1' node but could not find any node that satisfies:
        (Text + EditableText contains '未配对' as substring)
T2 [红] could not find any node that satisfies: (ContentDescription = '发送')
T3 [红] found '1' node: Node #216 at (l=200.0, t=6.0, r=258.0, b=58.0)px
        Role='Button' Text='[凭证]'
T4 [红] found '1' node: Node #187 Text='[对标 Grok 的国产助手 · Android Host]'
T5 [红] found '1' node: Node #53 Text='[BITBOT_HOST_URL]'
T6 [红] found '1' node: Node #122 at (l=294.0, t=82.0, r=296.0, b=118.0)px Text='[你]'
```

把旧屏的「没法看」拆成可指认的六件事：顶栏是「凭证」「能力」两个裸文字按钮；每句话上面
挂「你」/「Bit Bot」角色标签；输入框是 OutlinedTextField 配一个写着「发送」的方形文字键；
连接状态在界面上完全不存在；凭证面板把 `BITBOT_HOST_URL` / `BITBOT_TURN_TOKEN` 这种环境
变量名直接当标签；首屏 tagline 是一句对标别家产品的自我定位。

**③ 重构做了什么。** 新增 `app/src/main/java/com/bitbot/host/ui/` 五个文件：
`Theme.kt`（中性画布 + 唯一强调色 #1D6FE0 / 深色 #7FB2FF、排版/圆角/间距 token、
`BitBotExtras` 把气泡色从 `primaryContainer` 上解绑 —— 旧屏整股紫调就是从那里来的）、
`Components.kt`（品牌标、字标、连接状态胶囊、空屏 hero、无角色标签的消息行、投递条、
胶囊输入区 + 圆形发送键、面板头部/行）、`HomeScreen.kt`（状态从外面灌进来的首屏）、
`Sheets.kt`（更多 / 凭证 / 能力 / 配对四个面板共用一套头部与输入框）、
`PairingState.kt`（`PairingScanState` / `PairingRedeemState` / `PairingDesktop` 纯数据）。
`MainActivity` 从 753 行降到 ~370 行，只剩状态与真流程：发 turn、跑配对、申请权限。

一条都没改的东西也要说清楚：`TurnBridge` / `DesktopPairing` / `SendToUserSurface` 的函数
与契约、pairing-v1 的协议与文案语义、`productActions` 那十条、`getLocalWifiIp` 的取址逻辑、
store / IPC / kernel JSON —— 全部原样。这轮只动「怎么画」，不许顺手改「怎么算」。

另外记一条决策：首屏那句「对标 Grok 的国产助手 · Android Host」删了，源码注释里
「Grok-style Android product shell」也一并清掉。理由两层：这句文案本来就难看，
而我们对任何外部产品都没有做像素对齐，不该留这种声称。AB-11 从此盯着整个 main 目录。

**④ 修复后绿。** `:app:testUniversalDebugUnitTest` 现在 89 个用例 0 失败：
6 条行为红转绿，`UiTokensAndSheetsTest` 新增 16 条（浅色/深色主题不许顶着框架默认紫、
单强调色、WCAG 对比度、无角色标签、各状态空屏、配对面板五步、凭证/更多/能力面板）。
`prove_android_build.mjs` 加 AB-11（ui 五个文件在 + MainActivity 走 BitBotTheme +
全 main 无对标文案 + 8 条 UI 用例真在结果里 + 负向对照），AB-06 的用例数地板从 62 提到 84。

**⑤ 这轮自己踩的坑，都记下来。**

- **顺序差点反了。** 如果把新 UI 写完再补测试，就没有「修复前红」。所以先把新 `ui/` 包写进去
  （旧 MainActivity 还没引用它，能编译），拿旧屏跑出真红，再换 `MainActivity.kt`。
- **Compose 测试规则里 `setContent` 每个用例只能调一次**（`IllegalStateException: Cannot
  call setContent twice per test!`）。第一版把「浅色 + 深色」「配对五种状态」写在一个用例里
  连着 setContent，直接红给我看。拆成独立用例，不是想办法绕过。
- **断言要改程序不是改断言。** 「配对令牌」被判成 2 个节点 —— 因为 FieldLabel 和输入框
  placeholder 用了同一串字。改 placeholder 为「从桌面复制的那一串」，而不是把断言放宽成 count==2。
- **自己的规则第一轮判红了自己。** 我写「中性色 = 三通道最大差 ≤6」，然后深色
  `surfaceVariant=#1A1D23`（差 9）、`outline=#39404B`（差 18）被抓出来；浅色 `outline=#D5DAE2`
  （差 13）同样不过。改 token（`#1D1F22` / `#46484A` / `#D9DADC`），不放宽规则。
- **对比度不是感觉出来的。** 白字压在 `#2F7DF6` 上实测只有 3.90，不到 4.5 —— 强调色加深到
  `#1D6FE0`（4.77）。这条现在是断言，以后谁改色都会被拦。
- **JVM 拿不到真像素。** `captureToImage()` 在 Robolectric NATIVE 图形模式下 2000ms 超时
  （`ComposeTimeoutException`），探针用例 `UiPixelProbeTest` 因此删掉，没有留着当「恒红的已知问题」。
  结果就是：颜色的**数值**这层能真验（真读 `MaterialTheme.colorScheme` + 算对比度），
  颜色的**观感**这层验不了。

**⑥ 残留（诚实）。**

- 圆角实际效果、字距、阴影、滚动阻尼、深浅色在厂商 ROM 上的表现 —— 全部没验，必须真机看。
  本环境无 KVM，`assembleUniversalDebug` 出的 APK 我能打包、不能替用户点开。
- Compose 语义测试不覆盖 `ModalBottomSheet` 的拖拽与手势关闭，只覆盖里面画了什么。
- 能力面板那十条里仍有 5 条是占位动作（本轮只是把「点了会发什么」写进行下方），
  功能本身还没接上，不能因为排版变好就算它完成了。
- 凭证面板现在把令牌打码 + 可显示，但 `BITBOT_HOST_URL` 这类环境变量名从界面上彻底消失了：
  对开发者是少了一条自助线索，我在报告里记这笔交换，不当成纯收益吹。

**⑦ 追加这段之前，工作区里又冒出了同一类事故。** 准备往报告里拼 §8.22 时发现：
`docs/design/desktop-target/report.md` 在工作区里只剩 182 行（HEAD 是 589 行），
`docs/grok-desktop-parity/parity-gaps-next.md` 只剩 95 行（HEAD 是 168 行，
「〇、核心叙事：多 Bot 协作编排回路」整段带八步映射表没了）。这不是本轮编辑造成的 ——
是一份陈旧快照把已提交内容盖掉了，形状和 §8.19 记录的 227e4ed 事故一模一样。
处理方式：两份文件都 `git checkout` 回 HEAD，再用「读全文 + 追加」拼 §8.22，
最终 diff = **87 增 / 0 删**（`git diff --numstat` 当场核对）。

区别在于这次不再靠自觉：RH-06 只盯 report.md，抓不到第二份文档，所以新加 **RH-07**
把「HEAD 已提交标题不许消失」这条规则推广到一份清单（验收报告 + parity 清单）。
负向对照真实跑过：临时删掉「〇、核心叙事」整段 2445 字符 →
`✗ RH-07 … 消失的标题：## 〇、核心叙事：多 Bot 协作编排回路（本次梳理的正主） /
### 主线八步 × 内核原语映射 / …`，`PASS=6 FAIL=1`，随后还原 → `PASS=7 FAIL=0`。
教训补一句：凡是往长文档里写东西，**先看工作区和 HEAD 是不是一致**，不一致就先把
被盖掉的补回来再追加；`git status` 要用完整输出，别 `| head -30` 把自己要看的那行截掉
（这次就是这么漏过去的）。

**⑧ 追加：画布之外的半屏 —— 窗口层主题。** Compose 的 token 换完之后，manifest 还挂着
`@android:style/Theme.Material.Light.NoActionBar`。这一层不归 Compose 管：深色模式下
Compose 画 `#0C0D10`、状态栏却还是系统的 `#FF757575`，半屏深半屏浅正是「完全没法看」里
最直观的一条。于是新增 `res/values/themes.xml` + `res/values-night/themes.xml`
（`windowBackground` / `statusBarColor` / `navigationBarColor` 都定成画布色，浅色
`windowLightStatusBar=true`、深色 false），manifest 改挂 `@style/Theme.BitBot`。
键盘避让同时收到一处：manifest `windowSoftInputMode="adjustResize"`，HomeScreen 撤掉
`.imePadding()` —— 两边都做是双重补偿，键盘弹起时输入框会被顶出一段空白。

修复前红（`UiWindowThemeTest` 四条，跑在**还没换 manifest theme 的同一棵树**上，真实输出）：

- `窗口底色…` `expected:<-1> but was:<-328966>` ← 框架自带的 `#FFFAFAFA` 灰白
- `状态栏底色…` `expected:<-1> but was:<-9079435>` ← `#FF757575`
- `导航栏底色…` `expected:<-1> but was:<8421504>` ← `#FF808080`
- `状态栏图标…` `主题里解析不到 attr=16844000` ← framework 浅色主题根本没这个 attr

修复后绿：四条全过，从 activity 的 theme 真解析出 `#FFFFFFFF`，`windowLightStatusBar`
为 `type=18 data=-1`（TYPE_INT_BOOLEAN 的 true）。JVM 单测 **93 用例 0 失败（10 个类）**，
`prove_android_build` AB-01…AB-12 全绿（APK 8 MB）。AB-12 不只读源码：用
`aapt dump resources` 确认 `style/Theme.BitBot` 真被链进了 APK，并把 values/ 与
values-night/ 的三个窗口色与 `Theme.kt` 里 `CanvasLight` / `CanvasDark` 的字面量对齐 ——
Compose 层和窗口层不许各写各的颜色然后慢慢漂移。负向对照（只在内存里造坏样本，不落 `res/`
免得脏了正在跑的构建）：framework 主题、夜色写成浅色画布、`.imePadding()` 回潮三种形态
都被这把尺子抓到。

自我纠正一条：AB-12 **第一次跑是红的，红的不是树，是尺子** —— 我按大写 `0X` 去正则匹配
`Theme.kt` 里的字面量，而源码写的是小写 `0x`，`canvasOf()` 返回空串于是每条比对都判不等。
改成 `0[xX]` 才拿到真判定。门禁变红先分清是树红还是尺子红，这次记下来。

残留（诚实）：Robolectric 跑的是默认浅色配置，`values-night` 在 JVM 上换不了 config，
只能对齐字面量，深色观感没在这里验过；状态栏/导航栏图标在厂商 ROM（刘海屏、三键与手势
混布）上的实际表现仍必须真机看。

## 8.23 手机上「看不懂」的最后一块：内核回执被原样贴进聊天

**① 先纠正 §8.22 的一条误判。** 我在 ⑥ 残留里写「能力面板那十条里仍有 5 条是占位动作，
功能本身还没接上」。这句不成立。本轮把九个动作逐条真打进内核（`node hosts/cli_host/run_turn.js`）：

```
ListMachines → machines_list:ok      list models → llm_list_models:ok
device tools → device_tools_list:ok   take photo → device_permission:ok
list routines→ routine_list:ok        tick routines → routine_tick:ok
check updates→ check_updates:ok       钉钉/飞书/企微 → approval_card:ok
```

九个全部有真 host kind、真回执。所以问题不在「功能没接」，在**呈现**：`/v1/turn` 最后一条
assistant 消息是给机器看的 —— `Host FFI results applied (MoonBit kernel / ADR 0002):` 加一行
`- ok kind=… cmd=…`，再加一坨围栏 JSON，里面是 `/data/Bit-Bot/data/routines/list-xxxx.json`
这种绝对路径、`BITBOT_LLM_QWEN_API_KEY` 这种变量名、`pretend_granted` 这种内核字段。
旧 `MainActivity` 走 `TurnBridge.assistantText(body)`，取的就是最后一条 —— 于是手机上那一条
「助手回复」就是这坨转储。主流 AI app 不会把数据库转储读给用户。

**② 修复前红（真跑，不是补叙）。** 先写规格 `HostReplySummaryTest`（12 条），把实现临时换成
**当天 App 的真实行为**（原样返回最后一条 assistant），结果 `12 tests completed, 11 failed`：

- `[machines_list] 还在往聊天里贴代码围栏：Host FFI results applied … - ok kind=machines_list …`
- `unavailable 就是不可用：… - ok kind=device_permission cmd=` + 反引号 `desk-1|camera|unavailable` + 反引号
- `feed 还没接上、备案还是空的 —— 这两条残留必须看得见：… - ok kind=check_updates …`
- `展开必须还能看到内核原文：null`
- `认不得的 kind 必须原样给出来，不猜 expected:<[unknown]> but was:<[normal]>`

八个 fixture 是真抓的：`app/src/test/resources/hostfix/*.json`，由上面的命令在本机跑出来，
不是手写样例。门禁 AB-13 会逐个校验 fixture 里确实含 `Host FFI results applied` 且 kind 对得上
—— 防止以后有人把 fixture 改成配合实现的漂亮样本。

**③ 加了什么。** 只有呈现层：`ui/HostReply.kt` 把认得的内核 kind 翻成人，并保留原文。

| 内核回包字段 | 手机上现在这一行 |
| --- | --- |
| `machines_list.count` + `machines[].status` | 「已注册 3 台设备：· 桌面 desk-1 在线 · iPhone phone-ios 不在线 …」 |
| `llm_list_models` 文本块 `LLM providers (3)` / `key=missing` ×3 / `active=` | 「模型服务商 3 家，已配密钥 0 家。还有 3 家没配密钥…当前指向 deepseek/deepseek-chat」 |
| `device_tools_list.count=0` | 「· desk-1 上没有可用工具（0 个）：内核没有把工具权限记成已授予。」 |
| `routine_list.count=0` | 「定时任务 0 条：现在还没有到点会自动发的东西。」 |
| `routine_tick.due_count/fired_count` | 「这一轮到点的任务 0 条，实际触发 0 条…」 |
| `check_updates.feed_url=null` + `filing.icp/algorithm=null` | 「更新通道 stable…更新源还没接上（feed 未配置）…ICP / 算法备案信息还没填，上线前是硬门槛」 |
| `device_permission.permission=unavailable` + `true_device_os_dialog_residual` | 「相机：标记为不可用（desk-1）。桌面已经生成授权卡片；真机系统弹窗这一层还没验过」 |
| `approval_card` 的 `external:dingtalk:cid-android` + `status=pending` | 「这一步要人工确认…没有自动执行。目标通道：钉钉 · cid-android」 |

三条边界写死在测试里：**内核、store、IPC、`/v1/turn` 的 JSON 形状一个字没改**；摘要里不许出现
围栏、绝对路径、`BITBOT_*` 变量名；**认不得的 kind 一律原样给出去，不许编**（`kind=some_new_kernel_thing`
这条测试就是钉这个的）。另外「好看」不能靠藏事实换：`ChatLine` 新增可选 `raw` 字段，助手行下面
一个「看原始回执」，点开是真原文 —— `UiHostReplyRowTest` 用真 fixture 一路渲染到 Compose 语义树，
断「默认看不见原文、点一下看得见」。

**④ 修的过程中自己踩的两个坑。** 一、`approval_card` 那条 dump 里有**两行** `- ok kind=…`
（`approval_card` 和 `delivery`），第一版实现遇到认不得的 kind 就整坨退回原样贴，于是审批这条
在屏幕上还是转储。改成「认得的逐条翻译，认不得的单独点名说没接进摘要」，既不给 `delivery` 编意思，
也不让用户继续看围栏。二、抽取逻辑一开始在 `HostReply` 里重写了一份 `lastAssistant`，与
`TurnBridge.assistantText` 重复 —— 两处解析同一个协议迟早漂移，改回只留一份。

**⑤ 门禁与数字。** JVM 单测 **109 用例 0 失败（12 个类）**；`prove_android_build` **AB-01…AB-13 全绿**
（APK 8 MB）。新 AB-13 带负向对照：把 MainActivity 里 `HostReply.display(` 换成老写法，门必须判红。
AB-06 下限 91 → 106。矩阵里 G-47 加了 AB-13 anchor 与这段修复前红。`smoke_grok_desktop_parity.sh`
的边界说明同步：JVM 仍然验不到像素，也验不到 `values-night` 配置。

**⑥ 残留（诚实）。** 摘要用的是**内核已经说出来的事实**，不是模型写的自然语言 —— 所以它读起来像
表格而不像聊天；要更像主流 app，得让桌面大脑自己在 `/v1/turn` 里回人话（那要改契约，不在本轮范围）。
`delivery` 这类还没接进摘要的 kind 现在只在屏幕上点名说「没接进摘要」，没有真解释。
真机上一屏能显示多少行、展开原文的手势好不好用，仍然没验（无 KVM）。

## 8.24 国内渠道最后那道「还得去终端改文件」：加签 / 事件回调密钥进界面

**① 为什么这条算旅程阻断，而不是「少个输入框」。** 博主场景里「定时推到群里」这一步走的是
钉钉 / 飞书 / 企微机器人。钉钉自定义机器人的安全设置要么开**加签**，要么开关键词 / IP 白名单；
飞书事件订阅要 **Encrypt Key + Verification Token**；企微接收事件服务器要 **Callback Token**。
这四件事在代码里**早就支持了一半**：`main.js:319` 的 `ALLOWED_SECRET_KEYS` 里有
`BITBOT_DINGTALK_APP_SECRET` / `BITBOT_FEISHU_ENCRYPT_KEY` / `BITBOT_FEISHU_VERIFICATION_TOKEN` /
`BITBOT_WECOM_CALLBACK_TOKEN`，`secrets:set` 能把它们写进 `.env.local`，`cn_inbound_server.js`
真的在拿它们验签。缺的是另一半：渲染层**一个输入框都没有**，`secrets:status` 的键表里也**没有**
这四把 —— 于是界面既填不进去，也说不出「配过没有」。用户唯一的出路是开终端改
`hosts/desktop/.env.local`。「装完 app 还得去改文件」不等于能走通，这正是 §8.20 那条判断标准
（用户能不能真的走通）还没关掉的一个口子。

**② 修复前红（同一轮真实输出，`e2e_desktop_cn_secret_inputs.mjs`）。**

```
✗ CN-SEC-01 密钥输入框不存在（用户只能去手改 .env.local） — ["sec-ding-secret","sec-feishu-encrypt","sec-feishu-verify","sec-wecom-callback"]
✗ CN-SEC-02 secrets:status 不回读这四个键（界面上连「配过没有」都说不了） — ["BITBOT_DINGTALK_APP_SECRET","BITBOT_FEISHU_ENCRYPT_KEY","BITBOT_FEISHU_VERIFICATION_TOKEN","BITBOT_WECOM_CALLBACK_TOKEN"]
✗ CN-SEC-03 密钥已经在了，卡里却不说「已配置 ****xxxx」
✓ CN-SEC-04 四个密钥栏留空不报红、不禁保存            ← 这条当时是白的
✗ CN-SEC-05 有的密钥栏没有就地显隐按钮 — hasBtn:false,hasField:false ×4
✗ CN-SEC-06 门禁本身跑挂 — Cannot redefine property: set
e2e_desktop_cn_secret_inputs: PASS=1 FAIL=5 SKIP=0
```

那一轮唯一绿的 CN-SEC-04 是**空断言**：栏不存在 → 遍历没执行 →「没报红」白送。门禁写到这里
如果就收工，等于给自己发了个 PASS。现在 CN-SEC-04 先要求四个栏**存在**，不存在直接判不过。

CN-SEC-06 第一版想在页面里桩截 `window.bitbot.secrets.set` 再点保存，实测被
`contextBridge.exposeInMainWorld` 挂上来的属性挡住（不可重定义）。退回去**既不打穿 IPC、也不点真
保存**，理由不是懒：`upsertDesktopEnvLocal` 写的是 `hosts/desktop/.env.local` 这个**固定路径**，
不在 `BITBOT_REPO_ROOT` 隔离范围内，门禁一点就把假密钥落进用户的真文件（`BITBOT_NO_SECRET_SYNC=1`
只挡启动同步，不挡显式保存）。改断「栏带 `data-secret-key`（真键名）+ 页内写盘收集器真的遍历
`[data-secret-key]`」，把最后一跳明写在残留里。

**③ 改了什么。** 两头都要接上，只补 UI 是不够的。

| 位置 | 改动 |
| --- | --- |
| `main.js` `secrets:status` 键表 | 追加四把密钥，让渲染层读得到 `present` + `masked`；`value` 仍由原正则挡在门外（`_TOKEN$` / `_KEY$` 一律不发明文） |
| `index.html` 国内通信渠道卡 | 新增「加签 / 事件回调密钥」四栏：`type=password` + `data-secret-key` + 就地显隐按钮 + 状态位（`已配置 ****尾4` / `未配置`） |
| 同上 `openConnectApps()` | 打开这张卡时自己刷一次 `secrets:status`；以前状态只靠别的页面顺手刷过，从侧栏直接进来会停在旧文案上 |
| 同上 `refreshSecretsForm()` | 已配密钥**不回填进 DOM**（那是多一处明文），只写掩码尾号；输入框保持空，用户想换就粘新的 |
| 同上 `saveSecretsFromForm()` | 写盘收集器改成遍历 `[data-secret-key]`、**非空才提交**（留空不提交，否则一次保存把已配的密钥覆盖成空） |
| 同上 `CN_CHANNEL_ROWS` | 这四栏**不进必填校验** —— 关键词 / IP 白名单型机器人不该被自己的界面挡住 |

契约没动：`secrets:set` / `secrets:status` 的形状仍是 `{present, masked, value?}`，只是键表多四项；
`.env.local` 的写路径、`ALLOWED_SECRET_KEYS` 白名单、IPC 通道一律没碰；渲染层从没读过任何密钥明文。

**④ 顺带抓到的真问题（这条比四栏本身更疼）。** 补完输入框再跑，第二轮还剩两条红。
CN-SEC-04 仍然红：`errs:["勾选了开启推送，Webhook 地址还是空的"]`、`saveDisabled:true` ——
可钉钉 Webhook 磁盘上明明配着（`present:true`、`****gate`）。原因是掩码栏按安全规则**不回填明文**，
而必填校验只看 `input.value`，于是把「看不见」读成「没配」：卡里当着用户写一句谎话，
顺手把「保存并热加载」按死。这不是新功能的毛病，是 G-51 那套校验一直带着的缺陷，本轮被新的
env 注入条件照出来了。修法是把 `status` 的 `present` 引进校验：空栏 + 已配置 = 满足，并在状态行
写明「`****尾号 已配置，无需重填」——只在**该渠道所有掩码栏都在盘上**时这么说，说一半比不说更糟。

另一条 CN-SEC-05 红的是尺子自己：成功分支返回的对象里没带 `hasBtn` / `hasField`，而判定用
`!x.hasBtn`，对成功项同样成立。产品的四个按钮一开始就是好的 —— 这条红的不是树，是尺子。

**⑤ 门禁与数字。** `e2e_desktop_cn_secret_inputs` **PASS=6 FAIL=0**；既有
`e2e_desktop_cn_channel_guard` 仍然 **PASS=8 FAIL=0**（CN-03 的「地址空着当场点名」没被④的修复
削掉：那条门不注入 webhook，`present` 为空 → 照旧报红）。新 G-52 进 `smoke_grok_desktop_parity.sh`：
两个 anchor 组（四栏 + status 回读；掩码状态 + 可选 + 写盘接法）、上面这段修复前红、④ 那条真问题，
以及残留说明。G-51 里「四把密钥仍无输入框（要手改 .env.local）」的旧残留句已就地更正 ——
写在下面的段落里而不是删掉，免得下次复核以为我在移动球门。

**⑥ 残留（诚实）。**
最后一跳没验：门禁不点真保存，所以「填进去的值真的落到 `.env.local` 并被 `cn_inbound_server`
读去验签」仍未自动化，要在真机 / 真群里人工验一次。
四栏能不能真的过厂商验签，取决于厂商侧配置（回调地址、事件版本），门不假设。
`secrets:status` 的键表是手维护的清单，本轮把四把补进去了；「白名单里有、清单里没有」这类
读写不对称以后仍可能出现 —— 更彻底的做法是让 status 直接遍历 `ALLOWED_SECRET_KEYS`，但那会
把 `_TURN_TOKEN` 之类没打算在界面露出的键也带出来，需要单独判一次可见性，不在本轮顺手改。

**⑦ 负向对照（这条门不是恒真的）。** 把写盘收集器那行的选择器从 `[data-secret-key]` 改成一个
不存在的属性名，其余一个字没动，同一道门立刻翻红：

```
✗ CN-SEC-06 写盘收集器没有遍历 [data-secret-key]：新栏只是摆设
e2e_desktop_cn_secret_inputs: PASS=5 FAIL=1 SKIP=0
```

前五条仍然绿 —— 说明 CN-SEC-06 断的确实是「值能不能接到写盘」这一件事，不是被别处顺带撞红的。
改回原样后 `PASS=6 FAIL=0`，`grep -c '\[data-secret-key\]'` 在页面里回到 1 处（就是那个收集器）。

## 8.25 两道「验收标准本身」的门，此前没有任何聚合门跑过它们

**① 这一条不是产品缺陷，是门禁的缺陷——但它直接决定产品结论可不可信。** 本项目立的验收标准
只有一句话：「用户在真实 Electron / 真机里能否走通」。把它写成断言的有两道门：

- `scripts/e2e_desktop_user_journeys.mjs`（J1–J4：两个 Bot 私聊各按各的职责、自然语言一句话
  真建群、群里 @ 两个 Bot 各说各的且答得出全成员名单、两个都成功才 2/2 一个失败就如实 1/2、
  繁简语言与 provider 切换真的打对应密钥）——**63 项断言**；
- `scripts/e2e_desktop_creator_pipeline.mjs`（P1–P12：博主那条日更真链——搜集 / 编辑 / 审核三个岗
  真跑完出成稿、群里一句「每天早上9点发到 news@example.com」落成 `0 9 * * *` 且墙钟 09:00、
  过密排程如实拒绝、到期只备草稿不自动发、进待批准队列、未批准 `no_grant`、批准之后才真的出信、
  面板暂停/继续/两下删除都管得住、群里说出来的排程归属本群）——**30 项断言**。

登记之前，全仓库对这两道门的引用是 0 处：

```
$ grep -rn "e2e_desktop_user_journeys\|e2e_desktop_creator_pipeline" --include=*.sh .
（无输出）
$ grep -rln "e2e_desktop_user_journeys" . | grep -v node_modules
./scripts/e2e_desktop_user_journeys.mjs        ← 只有它自己
```

它们既不在 `smoke_grok_desktop_parity.sh` 里，也不在任何 workflow 里。也就是说：J1–J4、P1–P12
任何一条被后续改动打坏，矩阵与 CI 都会**照样全绿**——「有门禁」和「门禁被跑」是两件事，
这正是 G-46 那条已经写过的道理（不在矩阵里的门禁等于没有门禁），只是这次漏掉的恰好是最要命的两条。
换句话说，本轮之前我拿来说「日更场景跑通了」的证据，靠的是手动跑一次；这个结论没有守护。

**② 修了什么。** 把它们接进矩阵，成为 **G-53**：串行跑两道门（各自 `pkill` 清场、
`timeout 900 / 1200`），并且给两侧各钉一组 anchor——不是钉「exit 0」，而是钉**红线确实在输出里**：

| 侧 | anchor（必须出现在门自己的输出里） |
| --- | --- |
| J | 「J1 私聊可见区无调试行」「同群也不共享人设」「如实 partial 1/2」「重启后仍是繁体」 |
| P | 「P2 一次布置、三个 Bot 分工跑完」「cron=0 9 \* \* \*」「P6 到期只备好草稿」「P7 批准后真的发出」 |

`g53_run` 的判定顺序特意先查 `PASS=0 FAIL=0 SKIP=1` 再谈绿：门自报环境不足（缺 moon / 缺显示）时
只打印 skip，**不计入 ok**。这条如果写反了，一台没装 moon 的机器就能给出「旅程全绿」的假结论。

**③ 尺子自证（新逻辑自己也得能被证伪）。** 用两个假门跑同一段判定代码：一个 `exit 1`
（`PASS=1 FAIL=1`），一个打印 `PASS=0 FAIL=0 SKIP=1` 后 `exit 0`。结果
`BAD | G-53 fake_red（… PASS=1 FAIL=1 …）`、`skip| fake_green_skip 自报环境不足（…）— SKIP ≠ PASS`，
且 `PASS=0` —— 红真的判红、skip 真的没算成绿。这属于矩阵接线的新负向对照：它验的是 G-53 会不会说谎，
不是产品会不会错。

**④ 数字（本轮真实跑出来的）。** `e2e_desktop_user_journeys` **PASS=63 FAIL=0**、
`e2e_desktop_creator_pipeline` **PASS=30 FAIL=0**，两道门各跑约 2 分钟 / 5 分钟。
加进矩阵后，`smoke_grok_desktop_parity` **PASS=371 → 375、FAIL=0**（G-53 贡献 4 项：两道门各一条
全绿 + 两侧 anchor 各一条），全程 **0 条 skip**；G-52（加签 / 回调密钥进界面）与 G-53 一起进来；
`prove_report_history_intact` 7/7。
跑完 `git status` 里 `data/` 只剩那条早已存在的 `bitbot-routine-daemon.service` 本机路径改动——
两道门的快照-还原没把别的行留在盘上（这条脏状态本身见 ⑥）。

**⑤ 这两道门各自仍然验不到的（诚实）。** 「定时推邮箱」验到的是 app 真的生成一封带收件人与稿件正文的
信（`host_mail_send` 落 `data/mail/sends/send-*.json`），**不是**投进真实邮箱——真 SMTP / 真实
钉钉群 / 真实飞书机器人的投递仍未验；这也是 G-51/G-52 同一层残留。J 侧的「串味」判定靠本地 stub
provider 回显，不等于真实模型不会串。G-53 自己没有再套一层负向对照（门内部 P5 拒绝过密排程、
P7 未批准 `no_grant` 这类「产品变宽松就会红」的断言承担了这个角色）。

**⑥ 顺带修掉一条一直在脏工作区的仓库卫生问题。** `data/routines/bitbot-routine-daemon.service`
在工作区里一直带着一条「本机路径改动」：它是 `scripts/host_routine_daemon.sh:52-58` 用
`sed "s|/workspace|$ROOT|g"` 从**已跟踪的模板** `scripts/bitbot-routine-daemon.service.example`
生成的产物（`WorkingDirectory=` / `ExecStart=` 里是绝对路径），却被当作源文件跟踪着——
仓库里那份写着另一台机器的 `/Users/zfl/Downloads/bitbot`，任何跑过守护的机器都会让它变脏，
而顺手 `git add -A` 就等于把一台机器的绝对路径提交进仓库。本轮按生成物处理：
`.gitignore` 加 `/data/routines/*.service`（与既有的 `/data/**/*.json` 同一类），
`git rm --cached` 取消跟踪，**文件仍在盘上**（`os.path.isfile` 与 `daemon-status.json` 的
`systemd_unit_path` 两条既有断言照旧成立，已实测）。模板与生成逻辑一个字没动，
新克隆的人跑一次守护脚本就会拿到自己机器上的那一份。

## 8.26 填模型 key 这一步：粘错了要当场说，而不是三周后表现为「模型连不上」

**① 这是整条旅程里最容易把人劝退的一格。** 装完 app 的第一件事就是往凭证页粘一把模型 key。
用户是从厂商控制台、聊天窗口、文档里**粘**进来的，粘出来的经常不是纯 key：

- `Authorization: Bearer sk-…` —— 文档里教 curl 时就是这么写的，整行复制下来就带着它；
- `****3k7q` —— 这是**我们自己的界面**显示给用户的掩码（状态行就挂在同一栏标题上），手快选中的就是它；
- `sk-gate-0123456 789…` —— 从微信 / 飞书里复制，中间常带换行；
- `sk-在此粘贴你的密钥` —— 把旁边的中文说明一起框进去了；
- `sk-` —— 只粘了一半。

修之前这些**一个都不拦**：一路写进 `.env.local`、热加载进 `process.env`，然后表现为
「大脑仍缺 key」或者 401。用户看到的是「模型连不上」，真实原因是几周前粘错的一行——
按 §8.20 的标准，这一格属于「能填，但走不通」。

**② 修复前红（`e2e_desktop_llm_key_paste_guard.mjs`，真实 Electron 渲染 DOM）。**

```
✗ LK-01 粘进「Authorization: Bearer sk-…」没有被就地清成纯 key — got "Authorization: Bearer sk-gate-0123456789"
✗ LK-02 把掩码 ****3k7q 当密钥收下啦（要等到模型 401 才发现） — errShown:false, saveDisabled:false
✗ LK-03 这几类粘法本该当场点名 — [["中间空格",false,""],["中文",false,""],["只粘了一半",false,""]]
✓ LK-04 正常的 sk-… 密钥 0 条红字、保存可点            ← 空断言：那时根本没有校验
✗ LK-05 界面上没说清「留空＝不改动」 — mask 只有「（已配置 ****3k7q）」
✗ LK-06 这些栏把掩码当密钥收下了 — 通义 / Kimi / 搜索三栏全放过
✓ LK-07 改对之后红字当场收回（4 栏剩 0 条红字）        ← 同样是空断言
e2e_desktop_llm_key_paste_guard: PASS=2 FAIL=5 SKIP=0
```

和 §8.24 同一种陷阱：那两条绿的不是产品对，是**没有校验所以当然不报红**。它们在这里的作用是
「校验不许变成新门槛」，只有在校验真的存在之后才算数——所以下面 ④ 专门用两个方向把它们证伪。

**③ 改了什么（`hosts/desktop/index.html`，产品侧）。** 只写这一条链上说得清的事：

| 分类 | 处理 |
| --- | --- |
| 能安全归一的：`Authorization:` / `Bearer ` 前缀、首尾空白与换行 | 就地收成纯 key，**并把「替他清掉了什么」写在栏下面**（悄悄改用户粘的东西最招骂） |
| 归一不了又必然错的：连续 `*`（界面自己的掩码）、中间空白、含中文、长度 < 8 | 该栏红字点名原因；`#sec-save` 直接 disabled，写盘进不去 |
| 留空 | 不算错误；状态行改写为「（已配置 ****3k7q；留空＝不改动，要换就粘新的）」——输入框是空的而盘上有 key，是用户最容易误判的一种状态 |
| 四把密钥（主 / 通义 / Kimi / 搜索） | 走同一张 `SECRET_KEY_ROWS` 表，同一套规则，不各写一遍 |
| 厂商格式 | 一律不判。我们不掌握 key 的形状，「像不像真 key」不该由这个界面说了算 |

写盘那一侧一个字没动：`secrets:set` 白名单、`.env.local` 路径、热加载语义全部原样；
`cnValidateAndPaint()` 成为这页**唯一**管 `#sec-save` 可用性的地方（国内渠道缺字段 + 密钥粘错
一起算），不出现两处各设一次 disabled 的漂移。

**④ 两轮红 + 两个方向的负向对照。** 补完第二轮 `PASS=5 FAIL=2`，两条都值：
LK-01 的说明是空的——一次粘贴连着触发 `paste / input / change`，第二个事件里归一化已经无事可做，
于是把刚写明的说明擦掉了；产品归一化一直是对的，红的是「说明活不过第二个事件」
（记下上一轮留在框里的值，同一个值被重复刷新时保留说明）。
LK-07 是**尺子的错**：门禁自己只清了通义与搜索两栏，Kimi 那栏还留着 LK-06 故意粘进去的掩码，
于是「改对了仍拦着保存」红在门禁自己身上。

两个方向的对照（都是临时改一行、跑完立刻还原）：

```
对照 1  secretKeyProblem 一进来 return ""（校验整条摘掉）
        → LK-02 / LK-03 / LK-06 翻红，PASS=4 FAIL=3；LK-04/05/07 仍绿
对照 2  反过来让任何值都报错
        → LK-04 / LK-05 / LK-07 翻红，PASS=2 FAIL=5；LK-02/03 也红（它们要的是说对原因，不是有红字就行）
还原后  PASS=7 FAIL=0
```

这道门因此同时拦「不拦错的」和「拦太过的」。

**⑤ 门禁与数字。** 新门 `e2e_desktop_llm_key_paste_guard` **PASS=7 FAIL=0**，登记为矩阵 **G-54**。
被这次改动碰到逻辑的相邻门全部复跑：`e2e_desktop_cn_channel_guard` **8/8**（`#sec-save` 的可用性
改成两处合算，CN-05「改对后恢复可点」没被误伤）、`e2e_desktop_cn_secret_inputs` **6/6**、
`e2e_desktop_shell_v2` **89/89**、`e2e_desktop_token_parity` **5/5**（TP-03b 自定义属性里的字面色
12≤12、TP-04 运行时字面字号 34≤34，新增文案一律走 class 不走行内）。
密钥输入框的高度与不溢出那两条合同在 J4 里（`e2e_desktop_user_journeys`，矩阵 G-53），
本轮新增的说明行会不会把它挤出 32–48px，由整条矩阵复跑给答案，不在这里口头担保。

**⑥ 残留（诚实）。**
本门不点真保存（理由同 §8.24：`.env.local` 是固定路径，门禁一点就把假 key 写进用户真文件），
所以「归一化之后的 key 真的落盘」这一跳不在这里断。
校验只覆盖本 app 说得清的形状；这把 key 到底能不能用，仍要靠「试连」那一步。
其它包裹写法——尖括号 `<sk-…>`、成对引号——**没有**顺手归一：一类新写法就该先有一条测它的断言，
否则加的是没跑过的代码。真机上键盘遮挡、密码管理器自动填充会不会绕过 `input` 事件，也未验。

**⑦ 整条矩阵复跑的答案（补 ⑤ 留的那个口，不靠口头担保）。** G-54 登记后全量复跑：

```
smoke_grok_desktop_parity: PASS=378 FAIL=0
```

其中 ⑤ 问的那两条在 G-53 里，本轮单独复跑 `e2e_desktop_user_journeys` 把数字取回来：

```
✓ 1280×800 密钥输入框高度 39px（32–48 合同内）
✓ 1280×800 无横向溢出
✓ 1440×900 密钥输入框高度 39px（32–48 合同内）
✓ 1440×900 无横向溢出
e2e_desktop_user_journeys: PASS=63 FAIL=0 SKIP=0
```

结论：新增的说明行（`sec-*-key-note`，`class="st-note"`，字号走 class 不走行内）没有把输入框挤出
合同——它加在输入框**下方**，不参与输入框自身的高度。矩阵比上一轮多出的正是 G-54 的 3 条 ✓
（375→378，§8.25④ 记录的上一轮总数是 375），没有新增 SKIP，也没有任何一条被这次改动碰红。

## 8.27 手机上「转个身就没了」：聊天记录落到本机，并且清得掉

**① 这一条是「完全不知道如何使用」里最难看的形态。** 用户在手机上打了一句话、屏幕一旋，
或者系统把后台的 app 杀掉再点开——刚才那轮对话全没了，首屏回到空态（三个建议键重新摆出来）。
根因不在逻辑，在那一行状态：`MainActivity.kt` 的 `HomeShell` 用
`remember { mutableStateListOf<ChatLine>() }` 存对话。`remember` 只活过一次组合，
组合一散就没；进程没了更没。主流 AI app 没有把这个行为留给用户的。

**② 修复前红（`ChatThreadPersistenceTest` 在 HEAD 产品代码上真渲染，Robolectric 无 KVM）。**

```
CP01 转屏后那句话还在屏幕上       FAILED
  Failed: assertExists. Reason: Expected exactly '1' node but could not find any node
  that satisfies: (Text + EditableText contains '转个身就该还在的一句话')
CP02 转屏后两条都还在且首屏不是空态  FAILED（红在同一条消息节点的 assertExists 上，
  即「转屏后第一句就回不来」；后面那两条断言当时还没走到）
CP03 对话落在filesDir下的一个文件里  FAILED
  filesDir 下找不到含那句话的文件——历史只活在内存里，重开必丢（发现 0 个条目）
CP04 存下来的对话不含凭证           FAILED
  还没有对话文件可查（CP-03 已红），这条不得当绿用
4 tests completed, 4 failed
```

CP-04 那条红值得单独记：它**不许**把「盘上没有凭证」判成绿，因为此时盘上根本没有文件。
一条断言在「东西不存在」和「东西是干净的」之间必须能分辨，否则修好之后它会永远绿着。
CP-05（清空对话）是随修复一起写的，所以它的红不假装是修复前测出来的，用 ④ 的负向对照给牙齿。

**③ 改了什么（三层，一次只做一条链上的事）。**

| 层 | 改动 | 为什么这样切 |
| --- | --- | --- |
| `ChatHistoryStore.kt`（新） | `filesDir` 下一个有界 JSON（`DEFAULT_MAX_LINES = 300`）；`load()` 读不出就当没历史，`save()` 写不进只回 `false` | 失败语义定死在「落盘是附赠的」：磁盘满、半个文件、路径被占，都不许反过来把发送拦住或让首屏黑掉 |
| `MainActivity.kt` | `onCreate` 一次性读回历史作为初始值；两条消息都改走 `addLine`（上屏 + 落盘），落盘走 IO 线程并用 `Mutex` 串行 | 不在 Composable 里现读文件；上屏与落盘不分叉 |
| `ui/Sheets.kt` + 接线 | 「更多」里加一行「清空对话」，接到 `clearChat()`：先把盘清掉再清屏幕，顺带清掉证据条 | 只加持久化不给出口，等于把这台机器上的聊天变成删不掉的东西 |

位置选 `filesDir` 而不是外部存储：外部目录里的文件别的 app（以及不拔 USB 线的人）读得到，
聊天记录不该在那儿。这一点由 CP-03 同时断两头（filesDir 里必须有、外部目录里必须没有）。

**没有**用 `android:configChanges="orientation|…"` 把 recreate 遮掉——那是 `display:none` 式的
掩盖：转屏确实不重建了，进程被杀重开照样全没。AB-14 里专门有一条断 manifest 不许出现这个写法，
防止以后有人为了「让门变绿」再把它加回来。

**④ 五组负向对照（本轮新写的那一层自己也得能被证伪，一次只动一行）。**

```
摘掉上盘侧的 takeLast（有界不生效）        → HS02 红（4 tests completed, 1 failed）
坏 JSON 直接往外抛（去掉 runCatching）      → HS03 红（4 tests completed, 1 failed）
save 恒回 true（写不进也说成功）            → HS04 红（4 tests completed, 1 failed）
落盘时顺手带上配对令牌                       → CP04 红（5 tests completed, 1 failed）
把菜单里「清空对话」那一行删掉               → CP05 红（5 tests completed, 1 failed）
全部还原                                   → ChatHistoryStoreTest 4/4 + ChatThreadPersistenceTest 5/5 全绿
```

每组都只翻对应那一条、其余仍绿——这五条不是恒真断言，也不是「实现存在所以当然过」。

**⑤ 门禁与数字。** 安卓门禁 `prove_android_build` 新增 **AB-14**（对话落盘落地），并给 AB-06
的用例数下限从 106 提到 **118**（本轮 +9：真渲染 5 条 + 落盘层 4 条），整条：

```
prove_android_build: PASS=14 FAIL=0 SKIP=0
  ✓ AB-06 JVM 单测真跑：118 用例 0 失败（14 个类）
  ✓ AB-14 对话落盘落地：filesDir 有界 JSON + onCreate 读回 + 两条消息都过 addLine
        + 「清空对话」接上 clearChat + manifest 没用 configChanges 遮 + 9 条用例真跑（负向对照通过）
```

矩阵侧在 G-47 的 APK 段加了两条锚点（AB-14 在结果里、用例数确实涨到 118）与一段修复前红/负向对照
的如实记录，另加一条本轮残留说明。全量矩阵复跑的数字见 ⑦（不口头担保）。

**⑥ 残留（诚实）。**
- 「转屏」在 JVM 上走 `Activity.recreate()`：同一实例重走 `onCreate`、Compose 组合是新的，这符合
  旋转时实际发生的事；但真机旋转、以及各家 ROM 的杀后台策略仍未在设备上验过（无 KVM，起不了 emulator）。
- 「进程被杀后重开」是全新实例，Robolectric 的语义树够不到第二个实例，所以那一半由 CP-03
  （那句话确实在 filesDir 的文件里）承担，不是由屏幕上的节点承担。
- 历史很长时 `LazyColumn` 只组合可见项，屏幕上的条数断言只覆盖首屏那一窗；有界那条（HS-02）在落盘层验。
- 每轮 turn 之后是整段覆盖写（先写临时文件再改名）。300 条上限内这个代价可以忽略，但**没有**按条
  追加日志；如果以后要做多会话，这一层要重写成 per-thread 文件，不在本轮里预先做。
- 单条 `raw`（展开看的内核原文）随条数一起限界，不按字节限界：一条超大的原文仍可能把文件撑大。
  这是已知边界，本轮不加没测过的字节裁剪。

**⑦ 全量复跑与打包（本轮改完之后真跑出来的）。**

```
smoke_grok_desktop_parity: PASS=380 FAIL=0     （上一轮 378，本轮 +2：G-47 的 AB-14 锚点与用例数锚点）
prove_android_build:        PASS=14 FAIL=0 SKIP=0
JVM 单测：                  118 用例 0 失败（14 个类，0 skip）
```

380 条里没有一条 skip；跑完 `git status` 里 `data/` 没有多出内容（G-53 那两道门自己回收本轮行，
历史行不动）。

GitHub Actions 那边这次改动**确实触发**了 APK 工作流（`hosts/android/**` 在路径过滤里）：

```
Android APK  run 40572075691  head_sha=87dd35d66a817e01fe432d61dd6b64dcd661c394  completed / success
artifact: bitbot-android-universal-87dd35d66a817e01fe432d61dd6b64dcd661c394  13,302,810 bytes
```

也就是说「带对话落盘的这版手机 app」在 CI 上真打出了一个装得上的包（13 MB 的产物，不是
本地 gradle 自说自话）。但**这个包没有真机装过**：无 KVM，起不了 emulator，落盘文件在真机上
的实际位置、旋转与厂商杀后台的真实行为仍是残留。

## 8.28 打了半篇的稿子，转个身也不能没（手机输入框落盘）

**① §8.27 只接住了一半。** 对话历史回到屏幕上了，输入框没有：`var input by remember {
mutableStateOf("") }`。而这个 app 的场景就是用户在手机上写东西 —— 一稿标题、一段待发的正文。
「我打了三分钟的一段话，转了一下屏，全没了」和「刚才那轮对话没了」是同一个病的两个症状，
用户不会把后者叫 bug、把前者叫「预期行为」。

**② 修复前红（`ChatDraftPersistenceTest`，HEAD 产品代码真渲染，最终这版断言跑出来的原文）。**

```
DF01 AssertionError: 转个身，打了半篇的稿子从输入框里消失了（读到「」）
DF02 AssertionError: filesDir 下找不到含这半稿的文件 —— 转屏靠的是实例复用，
     真机旋转（新建实例）照样丢（filesDir 条目数 0）
3 tests completed, 2 failed
```

DF-03（发送后不许把已发出去的那句当草稿摆回输入框）断的是本轮新加的这条链，修复前没有草稿
落盘，谈不上「摆回来」，所以它不参与修复前红；牙齿在 ④ 的对照 3。

**第一轮这条差点记错**：DF-01/DF-03 一开始用 `assertTextEquals` 写，输入框空的时候它会把
placeholder 的 `Text` 一起比，于是 DF-03 在**还没实现**的代码上也「红」了 —— 红的原因不对，
那种绿/红都不算证据。改成直接读 `EditableText` 语义属性后重测（② 那两条就是重测的原文），
DF-03 在未实现代码上如实是绿的，这才写进上面那段说明里。

**③ 改了什么。**

| 位置 | 改动 |
| --- | --- |
| `ChatHistoryStore` | 多一个 `chat-draft.txt`：`saveDraft(text)` / `loadDraft()`，空草稿直接删文件不留零长度文件 |
| `MainActivity.onCreate` | 从盘上读回草稿作为输入框初值；注册 `ON_PAUSE` 存盘 |
| `HomeShell` | `onInputChange` 同步 `draftNow`；发送时 `saveDraft("")` 立刻清 |

草稿单独一个文件，不塞进历史 JSON：草稿是「还没交出去的东西」，历史是「已经发生的事实」，
生命周期相反 —— 发送要清草稿、清空对话要留草稿，混在一个文件里必然互相误伤。
存盘时机选 `ON_PAUSE` 而不是每次按键：在手机上按字符次数放大主线程 IO 不值得，
而旋转 / 切后台 / 被系统回收前都会走到 onPause。

**④ 这条链的取证边界（写明白，不含糊）。** Robolectric 的 `recreate()` **复用同一个 Activity
实例**，所以「屏幕上那半稿是从盘上读回来的，还是从实例字段里留下的」在语义树里分不出来：
只把草稿挂在字段上，DF-01 与 DF-02 也能一起绿（字段活着，DF-02 只要求写盘发生过）。
真机旋转是新建实例，那种写法照样丢。这一跳由门禁的**源码锚点**承担
（`onCreate` 必须真调 `chatStore.loadDraft()`），并用负向对照 1 证伪；真机旋转本身仍是残留。

**⑤ 门禁与数字。** `prove_android_build` 新增 **AB-15**，AB-06 下限 118 → **121**（本轮 +3）：

```
prove_android_build: PASS=15 FAIL=0 SKIP=0
  ✓ AB-06 JVM 单测真跑：121 用例 0 失败
  ✓ AB-15 草稿落地：chat-draft.txt 在 filesDir（空即删文件）+ onCreate 读回 + ON_PAUSE 存
        + 输入同步 + 发送即清，3 条用例真跑（四组负向对照全抓到）
```

AB-15 自带四组源码级负向对照（每次跑门都真执行一遍，不是写在注释里）：去掉 `onCreate` 的
`loadDraft` / 去掉 `ON_PAUSE` 存盘 / 去掉发送后的清草稿 / 草稿改放 `getExternalFilesDir` ——
四种走偏各被点名，任一抓不到即 AB-15 判红。矩阵侧 G-47 加两条锚点（AB-15 在结果里、
用例数确实 121）与本节的修复前红 / 对照 / 取证边界记录。全量矩阵复跑的数字见 ⑥。

**⑥ 复跑与残留（诚实）。** 全量矩阵：

```
smoke_grok_desktop_parity: PASS=382 FAIL=0     （上一轮 380，本轮 +2：G-47 的 AB-15 与用例数锚点）
```

- 真机旋转、切后台、被系统回收这三条路径上 `ON_PAUSE` 是否每次都走到，只能上设备验；
- 草稿与历史一样只在本机私有目录，不加密、不进备份逻辑；换机或清数据会没，本轮不做云同步；
- 「读文件还是读字段」那一跳靠源码锚点承担（④），JVM 语义树分不出来这条已经写进 G-47 的边界里；
- 输入框内容不落盘的那 300 毫秒以内的部分（最后一次 onPause 之后的按键）仍会丢 —— 这是选
  `ON_PAUSE` 而非每键存盘的代价，真机上「按下最后一个字立刻被杀进程」这种极端顺序没验。

**⑦ 订正：⑥ 的 382 是推出来的，复跑实测是 381。** 这一条必须先承认自己犯的就是简报禁止的那个错——
⑥ 里那句 `PASS=382` 是在矩阵还没跑之前按「上一轮 380 + 本轮新加两条锚点」算出来的，
写进报告时它只是预估。当天完整复跑（`bash scripts/smoke_grok_desktop_parity.sh`，含 G-47 里
真跑 gradle JVM 单测与 APK 打包）的真实输出是：

```
smoke_grok_desktop_parity: PASS=381 FAIL=0     （实测，非预估）
```

差的 1 条不在产品代码，也不在门禁漏跑，是**锚点计数算错了**：本轮 G-47 真正新增的只有
AB-15 那一条（「草稿落地」锚点），「用例数」那条锚点 §8.27 就已经存在（当时钉的是 118），
本轮只是把它里面的数字改成 121——改一条不增一条。380 + 1 = 381。两条锚点在实跑日志里的原话：

```
✓ G-47 没发出去的半稿也不许被转屏吃掉：chat-draft.txt 单独一个文件在 filesDir（空即删）、
      onCreate 读回、ON_PAUSE 存、输入同步、发送立刻清，3 条用例（DF-01..03）在结果里、AB-15 带四组负向对照
✓ G-47 用例数如实涨到 121（对话落盘 +9、草稿 +3），且 0 失败不是空跑
```

同一轮复跑里 `✗` 行数为 0，带自计数的 14 道门全部 `SKIP=0`（没有任何一条靠 skip 换绿），
跑完 `git status --porcelain data/` 为空（历史行与用户数据没被门禁污染）。`prove_android_build`
仍是 `PASS=15 FAIL=0 SKIP=0`（AB-06 真跑 121 用例 0 失败，AB-15 的四组源码级负向对照全抓到）。

结论：本节的交付数字以 **381** 为准，⑥ 保留原文不改，是为了把「预估当成结果」这个错留在
可查的位置——下一轮的锚点数只有复跑后才写。

## 8.29 已经发出去的那一句，回信不许跟着上一屏一起死（回合挪到进程级）

**① 前两轮接住的都是「屏幕上已有的东西」，最难看的一条在「路上」。** 发送之后那段协程跑在
`rememberCoroutineScope()` 上 —— 那是 **composition 的 scope**，转屏（recreate）取消组合就取消它。
于是用户看到的是：请求明明已经发给桌面大脑了，回信永远回不来；连「正在等」这个状态都跟着死了，
发送键重新亮起，用户再按一次 —— 对「定时发文 / 推群 / 推邮箱」这类**有副作用**的动作，
这就是同一件事办了两遍。一句大白话：「我让它排稿，转了个身它没回我也没在等，我又按了一次，
结果稿子发出去两遍。」这条比 §8.27/§8.28 更靠用户旅程的命门，因为它丢的不是字，是**动作**。

**② 修复前红（`TurnInFlightRecreationTest` 在 HEAD 产品代码上真渲染 + 真 socket 假桌面，
与终版同一份断言。下面五条是这一轮为了记这一节「重新真跑一遍」从 JUnit XML 里读出来的原文，
只把 `屏幕=` 后面那串语义树转储按位置截掉，其余一字未改）。**

```
等回信的时候转个身再按发送不许把同一件事发两遍
java.lang.AssertionError: 还在等回信时再按了一次发送，同一件事被办了两遍：假桌面收到 2 封
  （按下那一刻已观察到多收 1 封），只该收到 1 封；收到=2 已放信=是 自身故障=无

转个身正在等回信这件事还得看得见
java.lang.AssertionError: 转个身之后屏幕上没有「正在想」（回合还在路上，忙状态却跟着上一屏死了）；
  假桌面=收到=1 已放信=否 自身故障=无

转个身之后那封回信仍然要上屏
java.lang.AssertionError: 转个身之后这封回信永远没上屏；假桌面=收到=1 已放信=是 自身故障=无
  屏幕=帮我把今天这三条热点排成=在 Bit Bot 正在想…=没 …（语义树转储按位置截掉）

转个身之后那封回信还要留在盘上
java.lang.AssertionError: 回信要落进 filesDir（进程被杀重开也还在）；假桌面=收到=1 已放信=是
  自身故障=无 盘上=[{"role":"user","text":"帮我把今天这三条热点排成一篇稿"}]

消息留住了证据条也得不跟着丢
java.lang.AssertionError: 转个身之后回信要上屏；假桌面=收到=1 已放信=是 自身故障=无

tests="5" skipped="0" failures="5" errors="0"      （JUnit XML 汇总）
5 tests completed, 5 failed                          （gradle 控制台同一轮原文）
```

复测时怎么把代码退回 HEAD 是有讲究的：**只把 `MainActivity.kt` 换成 HEAD 那一版**，
`TurnCoordinator.kt` 留在原地不动（文件在、没人调用）。整个删掉它，测试类自己就编译不过，
量出来的「红」是编译错误而不是产品行为 —— 那种红不算证据。红抓完立刻换回终版（换前换后各算一次
md5，`47187cec8ae1a15ae5ce6fa0bd880058`，两处一致），再跑同一批用例确认 5 条全绿。

第三条那串 `屏幕=` 是测试自己打的取证（`screenDump()` 只看四样东西在不在：用户那句、`正在想`、
回信、投递证据）。HEAD 上它是「用户那句=在，其余三个=没」—— 这一屏既没有结果，也没有任何
「还在等」的迹象，看起来就像那句请求根本没发出去过；而假桌面那边 `收到=1 已放信=是`，
信其实早写好了。取证信息把「回合死了」和「界面无辜」这两件事摆在同一行里，才不至于把
红记成「回信还没到」这种时间问题。

**③ 改了什么 —— 只挪归属，不动协议。**

| 位置 | 改动 |
| --- | --- |
| `TurnCoordinator.kt`（新） | 进程级那一个 `object`：`CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)`；`inFlight++` / `finally { inFlight-- }` 管「还在等回信」；`delivery` 存投递证据、`revision` 是盘的版本号；`appendLine` 落盘之后 `revision++`；`submitTurn` 接管整段回合（含用户那句的落盘）；`askPermissions` / `takePendingPermissions` 把要问的权限攒到屏幕外面 |
| `MainActivity.kt`（HomeShell） | `busy` / `delivery` 不再 `remember`，改读进程级那一份；屏幕上的对话变成**文件的一个视图**（`LaunchedEffect(revision)` 重读 filesDir，不在组合里现读）；转屏回来的新组合按 `permissionGeneration` 补问权限；发送走 `TurnCoordinator.submitTurn`，`clearChat` 走 `clearAll`；删掉 `chatSaveLock`（锁挪进那一层）与 `rememberCoroutineScope` |
| `TurnInFlightRecreationTest.kt`（新） | 5 条真渲染 + 真 socket 用例：看得见「正在想」、回信上屏、回信落盘、转屏后再按不重复发、消息留住了证据条也不跟丢 |

`/v1/turn` 的 JSON、`ChatHistoryStore` 的形状、`TurnBridge` 的签名一个字没动；改的是这些事实
**归谁持有**。也没用 `android:configChanges="orientation|…"` 把 recreate 遮掉 —— 那是
`display:none` 式的掩盖：转屏确实不重建了，进程被杀重开照样全没。

**④ 这一轮差点把自己骗过去的三个地方（都写进 AB-16 的注释里了）。**

1. **假桌面按字符读 `Content-Length`。** 句子是中文时字节数 ≠ 字符数，读不满就不放信，
   假桌面自己卡死 —— 四条全红，看起来像「产品没修好」。改成按**字节**读满，并且每条断言都带
   `server.describe()`（收到几封 / 放没放信 / 自身故障），把「假桌面没放信」和「产品没接住」分开。
2. **`compose.waitUntil` 走的是虚拟时钟。** 跨真 socket + 真文件这一跳它看不见：30s 不绿，
   当场 dump 却两行都在。换成墙钟轮询 + `waitForIdle()`，这条断言才真的在等它等的东西。
3. **「再按发送不许把同一件事发两遍」那条第一版是恒真断言。** 原本断「还在等的时候再按发送，
   键是关着的」，在 HEAD 上**居然绿了** —— 按下那一刻请求还没落地，键当然还亮着（后来想用
   `config[SemanticsActions.OnClick] != null` 判可点，编译器直接提示恒真，又是一条假断言）。
   换成「数假桌面收到几封」才量到红。恒真断言宁可不写。

**⑤ 尺子自己也先被抓到两处松（都是这一轮第一次跑门跑出来的红）。**

- **AB-14 的负向对照 1 抓不到。** 断言写的是 `chatStore.load()`，而这一轮的 MainActivity 里
  它出现了**两次**（`onCreate` 读回 + `revision` 重读）—— 摘掉一处，另一处仍把它喂饱，
  等于没量。改成钉死 `startupLines = runCatching { chatStore.load() }`，并补一条
  「读回来还得喂进首屏」（`addAll(startupLines)`）。
- **AB-16 把正确代码判红了。** 「进程级那一层不许再去拿 composition 的 scope」用的是整文件正则，
  结果撞上 `TurnCoordinator` 的 KDoc —— 来由必须写在文件里，注释里引用旧写法是应该的。
  改成剥掉注释再查代码。

这两条都说明同一件事：**能被两处喂饱的尺子不算尺子**。所以 AB-14（六组）与 AB-16（七组）的
负向对照都在门里真执行一遍，任一抓不到即判红，不是写在注释里当承诺。

**⑥ 门禁与数字。** `prove_android_build` 新增 **AB-16**，AB-06 下限 121 → **126**（本轮 +5）：

```
prove_android_build: PASS=16 FAIL=0 SKIP=0
  ✓ AB-06 JVM 单测真跑：126 用例 0 失败（16 个类）
  ✓ AB-14 对话落盘落地：filesDir 有界 JSON + onCreate 读回 + 用户那句（TurnCoordinator）
        与助手那句（MainActivity）都过落盘 + 「清空对话」接上 clearChat + manifest 没用
        configChanges 遮 + 9 条用例真跑（六组负向对照全抓到）
  ✓ AB-16 回合不再归某一屏管：进程级 scope + inFlight/delivery 存在那一层 + 落盘后按 revision
        重读 + 转屏回来补问权限 + 5 条用例真跑（七组负向对照全抓到；真机旋转与进程被杀仍是残留）
```

矩阵侧 G-47 加一条锚点（AB-16 在结果里）并把 AB-06 那条锚点里的数字改成 126；同时把 AB-14
那条锚点的措辞改成与⑤一致（原文写「两条消息都过 addLine」，`addLine` 已经不在这个文件里了）。
全量矩阵复跑（实测，非预估）：

```
smoke_grok_desktop_parity: PASS=382 FAIL=0
```

381 + 1 = 382：多的那一条是 AB-16 锚点，AB-06 那条只改了里面的数字，改数字不增条数。
同一轮 `✗` 行数为 0，带自计数的 14 道门全部 `SKIP=0`（没有一条靠 skip 换绿），跑完
`git status --porcelain data/` 为空（历史行与用户数据没被门禁污染）。

**⑦ 残留（诚实）。**

- Robolectric 的 `recreate()` **复用同一个 Activity 实例**，所以这条门盯的不是「实例有没有换」，
  而是「协程归谁管」—— HEAD 在同一个 JVM 里也会被取消组合拖死，那五条红不是靠实例复用蒙出来的。
  但真机旋转是新建实例，「回合归进程管、屏幕只是文件的一个视图」这条归属仍要在设备上验一次。
- **进程被系统杀掉时，没回完的回合就是没回完**。本轮不假装能续上：要真续得上，得把 pending turn
  落盘 + 重启后重发或带幂等键，这一条没做（对「发文 / 推群」这类动作，幂等键才是根治，
  本轮只做到「同一屏幕上不会让用户手抖发两遍」）。
- 投递证据条（`SendToUser:*`）只活在进程里，重开就没了 —— 它和历史不是同一层，本轮没把它落盘。
- `resetForProcessRestart()` 是测试钩子；产品里没有真正的「进程重启」入口去调它。
- §8.28 那条边界继续沿用：`ON_PAUSE` 存草稿在真机切后台 / 被回收那一刻是否真走到，只有设备上能验。
- 无 KVM → 起不了 emulator：真机安装、厂商 ROM 杀后台、OS 权限弹窗、厂商商店签名
  （`BITBOT_ANDROID_STORE_*`）仍未验证；本门禁不声称装过或跑过。

## 8.30 屏幕写着「已转交」，收件箱里却什么都没有：转交不能只是一句话

切到 `cursor/next-target-v1`（桌面 + 安卓整合分支）后按用户旅程重读群聊那条线，抓到的不是样式
问题，而是一个会直接骗人的功能断点：**自媒体博主在群里说「这篇稿子交给审核 Bot」，屏幕上出现
「已转交」，但那个 Bot 的收件箱里根本没有这笔任务。**

**① 断点在哪（用户视角）。**

转交这条链上有两种「当场没结果」是完全不同的事：

- **被拒**：承接方不是群成员 / 群不存在 → 这笔转交压根不成立，什么都不该留下；
- **受理了但对方这轮没答上**（没配密钥、provider 挂了、超时、没有 runner）：所有权已经转移、
  任务已经挂在它名下，只是**还没跑完**。

`hosts/desktop/product_surface.js` 的 `executeHandoff` 把这两件事用同一个字段（`ok`）说，于是第二种
情况也回 `ok:false`。而 Host 侧（`hosts/shared/host_ffi.js`）正是拿 `res.ok` 决定要不要落凭据：
`if (res && res.ok)` 才写 `data/agents/inbox/<bot>.jsonl` 那一笔和
`data/agents/handoffs/handoff-<bot>-<ts>.json` 存根。结果就是——群转录已经写下了交接行
（`appendRoomTranscript` 在此之前就执行了），收件箱与存根却整笔跳过。用户看到的是一句已经完成的
话，实际什么都没有交出去。

**② 复现与修复前红（实测，非预估）。**

先把尺子改成能量出这件事的形状，再拿旧代码去撞（只换单个文件，不删依赖文件，否则红的是编译错误
而不是产品行为）。

`scripts/prove_room_orchestrator.js` 新判据 vs HEAD 的 `product_surface.js`：

```
prove_room_orchestrator pass=66 fail=10
  ✗ handoff：目标 Bot 跑成功 → 受理成立（ok）
  ✗ handoff：真答上了就不该挂着 pending
  ✗ handoff：目标没答上，转交这笔仍然成立（凭据不得整笔跳过）
  ✗ handoff：没答上就不能说已交接完成
  ✗ handoff：没答上必须标 pending（这件事还挂着，不是终态）
  ✗ handoff：没答上的原因可见（reply_error）
  ✗ handoff：受理成立时不得再带 error（那是拒绝位）
  ✗ handoff：受理成立的两种当场结果都满足「可落凭据」判据
  ✗ handoff：没有 runner 时 = 受理 + 排队，而不是整笔消失
  ✗ handoff 同步入口与异步入口同一套词汇（受理 / 答上）
```

前两条红的是「旧回包里根本没有 `accepted` / `replied` 这套词汇」——这不是苛刻，而是根因：一个 `ok`
同时被用来表达「拒绝」和「受理但未完成」，下游就只能猜，而 Host 猜错了。

切分支当时那轮全量矩阵（`/tmp/next-matrix-1.log`，HEAD 树）在产品路径上撞到的也是同一处：

```
smoke_grok_desktop_parity: PASS=377 FAIL=5
  ✗ GP-52 chain
  ✗ GP-52 inbox delivery
  ✗ GP-52 handoff artifact
```

三条分别红在：整条 handoff 命令的回包、`inbox/<承接方>.jsonl` 里那一笔、`handoffs/` 里的存根。
同一段里「群 transcript 落入 handoff 行」反而是绿的——正是这个组合说明了问题：**唯一被写下来的
地方是那句漂亮话。** §8.29 收口时矩阵是 382 绿，这条分支把它带到 377/5，少的就是这五条。

**③ 修的是什么。**

| 文件 | 改动 | 为什么改在这里 |
| --- | --- | --- |
| `hosts/desktop/product_surface.js` | `executeHandoff` 返回拆成两层：`ok:true` + `accepted:true` 表示受理成立（凭据该落），`replied` / `pending` / `transferred` / `reply_error` 表示这轮有没有答上；`error` 只在真拒绝时非空 | `ok` 是 Host 落凭据的唯一判据，必须只表达「这笔转交成立」；只加可选字段，既有字段语义不动（`pretend_transferred` / `transferred` 仍按原规则，`transcript_row` 照旧） |
| 同上 | 没有 runner 的分支从 `ok:false` 改为 `ok:true` + `pending:true` + `execution:"queued"` + `reply_error:"handoff_runner_required"` | 「这轮没人替它跑」是排队，不是消失 |
| 同上 | 同步入口 `handoffTask` 补 `accepted:true` + `replied:false` | 同步 / 异步两套入口必须说同一套词汇，否则 UI 只能靠字段猜 |
| `hosts/desktop/index.html` | 新增三语 `rHandoffPending` 与 pending 气泡：`host_results` 里 `handoff_task` 且 `ok` 且（`pending===true` 或 `replied===false`）时，如实补一句「{to} 这轮没答上（{reason}），任务仍挂在它名下，没有当成完成」 | 「已转交」这句本身没撒谎（所有权确实转了），但只说这一句不够——用户会把「转交了」读成「有人在做了」 |
| `scripts/prove_room_orchestrator.js` | handoff 块重写 + 因果判据 `queueable(r) = r.ok===true && (r.replied===false ? r.pending===true : true)` | 尺子从「有没有 error」改成「受理与答上是两件事」 |
| `scripts/smoke_grok_desktop_parity.sh` | GP-52 加因果锚点与负向对照；GP-53 改成量行为 + 三向自证；GP-143 锚点重钉；G-53 钉住屏幕上那句话 | 见④⑤⑥ |
| `scripts/e2e_desktop_user_journeys.mjs` | 新增 GP-52 三条渲染取证（真 Electron DOM） | 文案在源码里 ≠ 用户看得见 |

改完之后（同一棵树）：`prove_room_orchestrator pass=76 fail=0`（66+10 → 76/0，多的 10 条正是②里
那 10 条红转绿，没有靠删断言换绿）。

**④ 三条单独能绿、却挡不住半态：把尺子改成量因果。**

GP-52 原有三条锚点（chain / inbox / handoff artifact）各自 grep 一次，但这次翻车的形状恰好能让它们
其中两条**偶然**绿：只要用户那句换个 provider 恰好答上了，inbox 与存根就有了，锚点全绿，而半态
（写了交接行却没排队）仍然没人管。所以新增一条因果锚点 `ho_causal`：

```
交接行存在 ⇒ inbox 那一笔存在（且 is_room / forbids_private_assumptions 都对）⇒ 存根存在
```

它签名是 `ho_causal <root> <room> <to_bot>` 三个参数。第一版把 room 和 to 写死在函数体里，负向对照
喂 fixture 时因为 id 对不上而「偶然翻红」——看着像尺子有效，实际测的是参数不匹配。改成三参数后，
对照只在「缺排队」这一个维度上失败：

```
✓ GP-52 因果一致：写了交接行就必然有收件箱那一笔与存根（三者同生，不许只剩转录那句漂亮话）
✓ GP-52 因果尺子的负向对照：只有交接行、没有排队的半态被抓住（非恒真）
```

**⑤ 尺子跟着字段一起失效的那条：GP-53 改成量行为。**

原来这条是 `grep -q "dm-only"`，拿的是回包里 `escalations:"dm-only"` 这个字面量。群路径被重写进
`hosts/shared/room_*` 之后，这个字段整条链都不再产生（全仓只剩 `product_surface.js` 一处产出、零处
消费），于是锚点在 HEAD 上直接翻红——**红的是尺子，不是产品**。

改成量两件看得见的事：这条群回合的 `host_results[].kind` 里不许出现审批卡，这份群的持久转录里也不
许出现审批行（`room_approval_leak`）。解析失败一律算红（`process.exit(1)`），不 fail-open；再补三向
自证与注入对照：

```
✓ GP-53 审批不进群（按行为取证）：这条无点名群回合的 Host 结果与群转录里都没有审批卡
✓ GP-53 尺子自证：有审批卡被抓、纯 delivery 被放、坏 JSON 不 fail-open
✓ GP-53 尺子的负向对照：注入 approval_card 行后立刻翻红（非恒真）
```

过程里自己翻了一次车：谓词初版把 `c=>d+=c` 写成 `c=>d+=d`，stdin 永远读不到内容 → 解析失败 → 恒红，
在矩阵里表现为「产品破了」。这条门要是没有三向对照，就会以产品缺陷的名义长期挂着；「有 / 没有 /
坏输入」三个方向都试，才敢说这把尺子在量东西。

**⑥ 屏幕上那句话不能只有源码锚点。**

`GP-52 renderer` 原来靠 grep `index.html` 里有没有对应文案（本轮先把 `rHandoffPending` 加进这条静态
锚点）。但「文案在源码里」和「用户看得见这句话」是两件事，所以把它接进真 Electron 门
`scripts/e2e_desktop_user_journeys.mjs`：喂三笔 `host_results` 给页面里的 `postProcessWaveGResults`，
看屏幕上真出现什么。

修复前红（HEAD 的 `index.html`，只换这一个文件，`product_surface.js` 保持修复后）：

```
e2e_desktop_user_journeys: PASS=63 FAIL=3
  ✗ GP-52 受理未答的 pending 气泡没渲染
  ✗ GP-52 pending 气泡在答成功时也刷 — {"before":0,"after":0}
  ✗ GP-52 被拒与受理未答在屏幕上没分开
```

第二条那行的失败文案是错的：`before/after` 都是 0，根本不是「也刷」，而是「从没刷过」。本轮把这条
文案改成直说「期望渲染 1 条、答成功后仍是 1 条」并带上两个计数——留着这行原文，是因为失败信息写错
和断言写错一样会骗人，红测的尾巴必须自己也能被读对。

第三条的取证尾巴里能看到 HEAD 只渲染了「任务转交被拒：…（未写入群 transcript…）」这一种，受理未答
那笔整条气泡都没有：旧界面要么说「被拒」，要么什么都不补。

修复后绿（同一棵树）：

```
✓ GP-52 受理未答：屏幕上真写了「转交已受理并排队 + 没当成完成」（承接方与原因都点名）
✓ GP-52 答上了的那笔不再刷「排队」这句话（受理未答才说，不滥报）
✓ GP-52 被拒的那笔走「被拒」气泡，不混进「受理并排队」（三种当场结果各有其话）
```

三条一起才算数：只有第一条等于把 pending 当万能提示；第二条盯「不该说时别说」，第三条盯「拒绝和
受理未答不许混」。矩阵侧再把这三行输出钉成一条锚点（门内部绿、但屏幕上没这句话就整条翻红）：

```
✓ G-53 GP-52 那句话真在 Electron 屏幕上说得出来：受理未答才说排队、答上了不刷、被拒不混
```

截图：`artifacts/uj-gp52-handoff-pending.png`。

另外顺手重钉了一条**只是文案漂移**的锚点（不放松）：GP-143 原来 grep
`"Host IPC 真接线：roomTurn → appendRoomTranscript → orchestrateRoom"`，群路径重写后探针里那句变成
`dispatchRoomTurn(roomTurn → appendRoomTranscript → orchestrateRoom(runResponderTurn))`。改的是锚点里
被引用的那句话，要求它逐字等于探针现在真实打印的那行；配套仍然要求
`responder 回合用自己的 botId` 与 `preload 暴露 rooms.orchestrate` 两条同时成立。

**⑦ 门禁与实测数字。**

全量矩阵（修复后，`pkill -9 -f "dist/[e]lectron"` 后单跑，全程无并发门）：

```
smoke_grok_desktop_parity: PASS=387 FAIL=0
```

377（分支当时）→ 387：五条红全部转绿，新增五条锚点 = GP-52 因果一致、其负向对照、GP-53 尺子三向
自证、GP-53 注入对照、G-53 屏幕渲染锚点。相对 §8.29 的 382 基线，净增 5 条，没有靠删断言或放宽
判据换绿（`GP-52 renderer` 那条只把锚点文本改长，条数不变）。

同一轮核验：`✗` 行数为 0；带自计数的 14 道门全部 `SKIP=0`（没有一条靠 skip 换绿）；跑完
`git status --porcelain data/` 为 0 行（探针 Bot / 群行 / inbox 那一笔 / 存根都被级联清掉，用户历史
行不动）。取证的两次单文件替换都回到原位并核过 md5：`product_surface.js`
`9b62cb49657f79b74115ae2a78b10a59`、`index.html` `33a86b059a31684e4f1de2dea421182c`。
`prove_room_orchestrator pass=76 fail=0`、`e2e_desktop_user_journeys: PASS=66 FAIL=0 SKIP=0`。

**⑧ 残留（诚实）。**

- **`data/agents/inbox/*.jsonl` 全仓没有消费者**（`AGENT_INBOX_DIR` 只有三处写、零处读）。本轮把
  凭据诚实地落下来，但**没做「下一轮自动捡起」**：承接方这轮没答上，这笔任务就永远挂在 inbox 里，
  不重跑、不提醒。对「定时发文 / 定时推邮箱」这条主线这是真断点——记为 GP-166（见
  `docs/grok-desktop-parity/parity-gaps-next.md`），下一轮做捡起 + 幂等键。
- `escalations:"dm-only"` 这个字段在群路径重写后整条链都不再产生、也没有消费者。本轮只把尺子改成量
  「审批不进群」这个行为，**没有实现「群里触发的动作 → 审批走私聊」这条完整链路**：新路径
  （`hosts/shared/room_*`）目前压根不产生审批卡，所以这条行为取证是靠「没有东西可漏」成立的，一旦
  群路径接上需要审批的动作，它才第一次真正被压测。记为 GP-167。
- pending 气泡是渲染层取证（真 Electron、真 DOM），但它喂的是构造的 `host_results`；「真实 provider
  挂掉 → 屏幕上出现这句话」这一跳分别由 `prove_room_orchestrator`（回包形状）与因果锚点（凭据落盘）
  各自成立，串起来端到端跑一次（真 UI 上点一次转交、真把 stub 打挂）还没做。
- 本轮没改安卓侧：安卓 `TurnCoordinator` 走 `/v1/turn` 信封，`host_results` 的 `kind:"delivery"` 提取
  路径与桌面这段不同，inbox 凭据只在桌面 / Host 侧产生。
- 无 KVM、无真机：安卓侧仍只有构建与 Robolectric 级证据。

## 8.31 每次 push 都红、一个 job 都没有：AE 那条门从没真跑过

**① 现象（不是「产品红了」，是「门不存在」）。**

推 §8.30 那次提交后去 Actions 看状态，读到的是这样三条：

```
40733472246 | .github/workflows/agent-eval.yml | cursor/next-target-v1 | push | completed | failure | 32efb447
40714772671 | .github/workflows/agent-eval.yml | cursor/next-target-v1 | push | completed | failure | 6db5e608
40714764350 | .github/workflows/agent-eval.yml | cursor/next-target-v1 | push | completed | failure | 6db5e608
```

三条里只有第一条来自本轮（`32efb447` = §8.30 那次提交），另两条在切分支之前就挂在那儿了。
三个细节叠在一起才是结论：名字显示的是**文件路径而不是 `Agent Eval`**；
`GET /actions/runs/<id>/jobs` 回 `total_count=0`（一个 job 都没建过）；而且这个 workflow 的
触发条件写的是 `push: branches: [main]`，**它本该在这个分支上一次都不触发**。

**② 根因。**

最后一步写成 `if: ${{ secrets.BITBOT_LLM_API_KEY != '' }}`。官方 Contexts 参考里
`jobs.<job_id>.steps.if` 这一行给的可用上下文是
`github, needs, strategy, matrix, job, runner, env, vars, steps, inputs` —— **没有 `secrets`**；
`secrets` 在步骤级只能出现在 `steps.env` / `steps.with` / `steps.run` 这类位置。

这个引用让文件在 Actions 侧无效。为什么连 `on:` 的过滤都没生效是**推断**（文件解析不了，过滤器
自然无从判断）；本轮能直接证的只有前后对照：改之前每次 push 都会出现这种「名字叫文件路径、
0 job、立即 failure」的空运行，改之后（`50a4d9f`）同样的 push **不再产生任何运行** —— 说明这份
文件现在能被 Actions 接受，`on: branches: [main]` 也重新开始起作用。

这件事的代价不是「CI 难看」：**AE 是仓库里唯一一条断言「行为达标」（选对工具、失败收敛、
不越审批、群内不重复劳动）的门**，其余上百条 `prove_*` / `e2e_*` 断的是接线。它从建好那天起
没跑过一次，等于这段时间里所有「行为」层面的承诺都没有 CI 背书。

**③ 改法（意图一字不动）。**

密钥先进该步的 `env:`（那里允许 `secrets`），由这一步自己把结论写进 `GITHUB_OUTPUT`，真正跑
`--live` 的那一步只看 `steps.live.outputs.can == '1'`。没有真 provider key 时整步不跑，
**不拿 stub 冒充行为达标** —— 这条原则和原注释一致，只是现在它真的能被执行到了。

**④ 本地先把 AE 真跑一遍（moon 在 PATH 上，全离线场景）：**

```
AE eval: pass=26 fail=0 skip=3  (gate 26/26 pass, observed 0, live 3)
task_success_rate=1 tool_selection_accuracy=1 tool_call_success_rate=0.5205
steps/task avg=9.06 p50=2 max=1  tokens(est)=4280  latency avg=43.65ms max=98ms
skip AE-27/28/29 live：needs_live
```

其中 `AE-21 群协作：handoff 真执行（目标 bot 真的产出）` 在 §8.30 改完回包形状之后仍然绿，
`AE-22/23`（无审批的 shell 不执行、参数里 `approved:true` 不能伪造审批）也照旧绿。
`tool_call_success_rate=0.5205` 这个数本轮只记录、不当门用（分母含 provider 故意失败的场景），
拿它当 KPI 之前得先说清口径。

**⑤ 顺着这条线还抓到一处「整合分支打不出包」。**

`android-apk.yml` 的 push 触发只写了旧分支 `cursor/android-mobile-target-v1`（外加 PR 改
`hosts/android/**` 才跑）。桌面与安卓整合到 `cursor/next-target-v1` 之后，在这条最新分支上改安卓
**Actions 一次都不会跑**，「能在 Action 里打出可安装包」这句话只对旧分支成立。修复只加分支、
不动 paths 过滤（不碰安卓的提交不会白跑一次 45 分钟构建）。

推上去之后实测真的被触发了，并且跑绿（这就是「加分支」是否生效的唯一证据）：

```
40734948337 | Android APK | cursor/next-target-v1 | completed | success
job「编译 APK + 读回包里的事实」17 步全绿，其中三条是关键：
  ✓ 真编译 APK + JVM 单测（线路解析）
  ✓ 门禁：aapt 读回包名 / 权限 / SDK / flavor，并确认真的跑了单测
  ✓ 产物与签名事实（写进 Summary，不写「已可上架」）
产物：bitbot-android-universal-112271fa4d1211a6c944429af1081f1290121e60，13,310,179 B
zip 里两个 APK（本轮真下载并 sha256 算过）：
  universal-app-universal-debug.apk   8,034,166 B  d0ddf55b…41d3573
  universal-app-universal-release.apk 5,964,777 B  6fce5124…9db6db
```

产物名里那串 sha 就是 `github.sha`，和本轮推的 HEAD（`112271f`）逐字一致 —— 「装到手机上那个包
确实是这条分支现在的代码打出来的」这一点有凭据，不是拿旧包冒充。Actions REST 侧不返回 artifact
的 sha256（`sha256_digest` 在两个端点都是 undefined），所以上面那两个和是本轮自己下载后算的。

**⑥ 门禁与实测数字（本轮最后一次全量，跑在已推送的树 `112271f` 上）。**

```
smoke_grok_desktop_parity: PASS=387 FAIL=0
```

与 §8.30 收口时同一数字：本轮只动 `.github/workflows/*` 与文档，锚点条数不变（全仓 grep 确认
没有任何门读 CI 文件，`scripts/` 里唯一提到 `android-apk.yml` 的地方是 RH 门引用报告里的一节标题）。
同一轮核验：`✗` 行数 0；带自计数的 14 道门全部 `SKIP=0`；跑完 `git status --porcelain data/` 为 0 行；
这一轮里 `prove_report_history_intact: PASS=7 FAIL=0` 与它的负向对照（截断版被抓住，4/3）同时成立。

**⑦ 残留（诚实）。**

- AE 在 **GitHub 上仍然没有成功跑过一次**：修复后可证的是「不再有名字叫文件路径、0 job 的空运行」
  ——因为 `on:` 只允许 `main` 与 `pull_request`，这个分支的 push 现在正确地不触发它。要真正确认
  CI 侧绿，得开一条到 `main` 的 PR（这是会影响他人可见状态的动作，本轮没做，等用户点头）。
  本地 26/0/3 是行为门目前唯一的实测。
- `--live` 三个场景（真模型自己选工具 / 自己决定下一步 / 失败后不重试）依旧整步不跑：仓库里没有
  `BITBOT_LLM_API_KEY`，这个门的设计就是没 key 就不跑，不用假 PASS 凑数。
- `desktop-macos.yml` 与 `kernel-binary.yml` 本轮没逐条查是否有同类「解析失败」症状，只确认它们
  在这条分支的 push 上没有产生空运行（运行列表里只有 `Desktop macOS` 在 `desktop-v0.1.0` 上的成功记录）。
- 无 KVM、无真机：AE 与 APK 都只到「行为断言 + 包内事实读回」这一层，装上手机后能不能走完
  §8.30 那条转交流程，仍要设备验证。
- 那个 `universal-release` 包在没配 `BITBOT_ANDROID_STORE_*` keystore 时**仍然是 debug 签名**
  （工程未配置时回落 debug，workflow 头部就把这句话说在前面了）：它是一块能侧载的包，
  不是一块能上架的包，Summary 也不写「已可上架」。

## 8.32 群里说了「已转交」之后再没人接：把 pending 凭据的下游补上（GP-166）

**① 断点在哪（不是文案问题，是没人上班）。**

§8.30 把转交的状态诚实性修完之后，parity G-F 记下的是另一件事：
`data/agents/inbox/<bot>.jsonl` 全仓 3 处写、0 处读；`data/agents/handoffs/handoff-<bot>-<ts>.json`
存根只有落盘代码，没有任何消费者。所以用户在群里看到的「转交已受理并排队」确实是真的，
但**这个队没人接手**——承接方这轮没答上（没配 key / provider 挂 / 超时 / 没 runner），
这笔任务就永远挂着。对「热点搜集 → 内容编辑 → 稿件审核 → 定时发文」这条主线，
后果是：稿子停在审核 Bot 名下，博主以为有人在做了，实际上一次都没重跑。

**② 修复前红：Host 层合同（先写红测，再动产品代码）。**

`scripts/prove_room_orchestrator.js` 新增 1b 节（R-01…R-10，17 条判据），跑在既有 handoff
合同链后面，全部走产品入口而不是内部函数。插入后第一件事是跑红：

```
prove_room_orchestrator pass=82 fail=11
  ✗ R-01 新一条群消息真的把 pending 的转交捡起重跑（产品入口在 dispatchRoomTurn，不是只留一个内部函数） — 回包里根本没有 handoff_retry
  ✗ R-01b 捡起的答案真落进群转录（恰好多一条）
  ✗ R-01c 凭据写下终态与次数（answered / attempts=1） — {}
  ✗ R-03a 捡起策略给得出重试上限（不是一句「会重试」） — {"__missing":true,"attempted":0,"answered":0,"scanned":0}
  ✗ R-03b 到上限就如实标 stuck（attempts 等于上限，不是悄悄挂到永远） — {}
  ✗ R-05 承接方已不在群里 → 如实卡住（不产出任何「它答了」的行，原因点名 to_bot_not_member） — {"attempted":0}
  ✗ R-06 坏凭据被如实跳过并计数，同目录其它凭据照常处理（不因为一个坏文件整批放弃） — {}
  ✗ R-10 claim 过期（宿主中途没了）才允许接手，并把次数累加上去（不是从零开始） — {"state":"running","attempts":1}
```

红的都是「捡起没有发生」，不是崩溃、不是缺符号。11 条红之外，R 块另有 6 条在修复前就绿
（R-01d / R-02 / R-03d / R-06b / R-07 / R-08）——它们是「不该发生的事没发生」型负向护栏，
修复前它们恒绿是必然的（那时什么都不做），**它们单独不构成尺子**，靠的是与 R-01 / R-03b
这些正向判据成对：先证明真的会捡，再证明只捡一次。这条口径在下面第 ⑥ 项的变异对照里逐条验。

**③ 修复前红：真 Electron 渲染层（屏幕上那句话到底说不说得出）。**

`scripts/e2e_desktop_user_journeys.mjs` 加三条取证，走真 IPC（`rooms.json` →
`bitbot:rooms:list` → `renderRoomTranscript`），不是把拼好的 HTML 塞给探针。
把渲染层的 `handoff_stuck` 映射摘掉（＝修复前状态）复跑：

```
  ✓ [18:37:30] GP-166 捡起后的答案在屏幕上真能看见（点名承接方，且不会被误报成「已停下」）
  ✗ [18:37:30] GP-166 卡住提醒没落地，或把原始码摊给了用户 — {"n":0, … "UJ承接探针\n回复失败\n2026-10-28 18:37\n模型或服务返回失败，未取得该成员的产出。"}
  ✓ [18:37:30] GP-166 负向对照：单次超时仍走超时那句话，没被并成「已停下」（提醒不是万能兜底串）

e2e_desktop_user_journeys: PASS=68 FAIL=1 SKIP=0
```

`n:0` 是「这句话根本没出现过」，而屏幕上落的是通用兜底句「模型或服务返回失败」。
这句对卡住的转交是**不完整的真话**：用户看不出这件事已经不再自动重试了、需要有人来看。
补上三语 `roomFailStuck` 之后同一条门：`PASS=69 FAIL=0 SKIP=0`（截图 `artifacts/uj-gp166-handoff-retry.png`）。

**④ 改了什么。**

| 文件 | 改动 | 为什么是这里 |
|------|------|--------------|
| `hosts/desktop/product_surface.js:2582–2762` | 新增 `HANDOFF_DIR` / `readHandoffStub` / `patchHandoffStub` / `noteHandoffStuck` / `retryPendingHandoffs(opts)`，导出位 `:3336` | 凭据的读写与终态属于 store 层；与既有 `prepareHandoff` / `executeHandoff` 同一套成员校验与转录写入，不另造一套 |
| `hosts/shared/room_dispatch.js:161–195` | 群回合跑完之后调 `surface.retryPendingHandoffs({room, deps})`，结果作为**可选字段** `handoff_retry` 带在回包里 | 这是桌面 IPC（`main.js:2003`）与 CLI / 移动端（`host_ffi.js:24866`）唯一的共同入口；挂在入口上才不会出现「一个端会捡、另一个端永远挂着」 |
| `hosts/desktop/index.html:6100 / 13957 / 14656 / 15355` | `roomFailReason` 先认 `handoff_stuck`；三语 `roomFailStuck` | 卡住必须在群里说人话，且不许把 `provider down` 这类上游原文摊到产品面（沿用 GP-147 的 dev-mode 才露协议码纪律） |
| `scripts/prove_room_orchestrator.js:175–424` | 1b 节 R-01…R-10 | 先把合同钉死（红），再实现 |
| `scripts/e2e_desktop_user_journeys.mjs:1039–1091` | 三条真 Electron 渲染取证 | 「用户看得见」不能只靠 Host 层绿 |
| `scripts/smoke_grok_desktop_parity.sh:2185–2226` | 新增 G-55：把 `prove_room_orchestrator.js` 接进聚合门 + 9 条锚点 + 接线注入对照 | 见第 ⑦ 项：这条门此前根本没被任何聚合门跑过 |

**⑤ 契约口径（只加不改）。**

- 幂等键 = 存根文件名（`handoff-<to>-<ts>` 是 host_ffi 写入时天然唯一的凭据 id）。
  `state` 为 `answered` / `stuck` 的凭据一律不再调模型（`skipped_terminal`）。
- `attempts` 只在**真跑了一轮**时 +1；被移出群、群被删、任务文字丢了这类不烧模型的终态
  只写 `last_error` + `state:"stuck"`，不把次数虚增。
- 有界重试：上限 3（`HANDOFF_MAX_ATTEMPTS`），第 3 次仍答不上 → `stuck` 并落一条
  `bot_reply_error`（`error: "handoff_stuck:<原因>（第 3/3 次）"`）。**不新增转录 kind**，
  渲染层已有的 `bot_reply_error` 通路就是它的显示面。
- 每轮最多捡 5 笔（`HANDOFF_SCAN_LIMIT`）：用户发一句话不该换来五次模型调用，剩下的下一轮再来。
- claim：跑之前先写 `state:"running" + claimed_at`；新鲜 claim 跳过（`skipped_running`），
  超过 10 分钟才允许下一个回合接手，且次数累加不从零开始（R-10）。
- 捡起的一轮与被拒前那轮同一套上下文：`role:"handoff_target"`、取消通道在、
  `approved` 不带（R-04）——**审批不因为重跑而绕过**。
- 不删用户数据：读不懂的存根原样留在原地（R-06b 断言字节不变）；inbox JSONL 仍是只进不出的账本。
- `rooms.json` 读不动时**不把凭据演成「都卡住了」**：整轮返回 `ok:false,error:"rooms_store_unreadable"`，
  存根保持 pending 等下一轮 —— 那是 store 的故障，不是这笔任务的终态。
- 没有 runner（桌面没开机、`roomRuntimeDeps` 未注册）时返回 `handoff_retry_runner_required`，
  而不是假装捡起了。
- 既有回包字段一个都没动，`dispatchRoomTurn` 只多了 `handoff_retry` 这个可选字段。

**⑥ 尺子的牙：变异对照（实现之后逐条拆掉再跑），以及尺子自己两次翻车。**

实现写完、93/0 之后，把产品代码逐条改坏（每轮只改一处，改完立刻还原，
`md5sum -c` 核验两个文件都回到实现态），看红是不是真的红在对应那条判据上：

| 变异 | 拆掉的东西 | 立刻翻红的判据 | 计数 |
|------|------------|----------------|------|
| M1 | 终态不再跳过（`answered`/`stuck` 也重跑） | R-02 / R-03d / R-09 | 90 / 3 |
| M2 | 群隔离（`stub.room !== roomId` 也照跑） | R-08 | 92 / 1 |
| M3+M4 | 重试上限 + 新鲜 claim 一起摘 | R-03b / R-03c / R-03d / R-09 | 89 / 4 |
| M6 | `attempts` 每次归零 | R-03b / R-03c / R-03d / R-10 | 89 / 4 |
| M5 | `dispatchRoomTurn` 里不接捡起（产品入口摘掉） | R-01 / R-01b / R-01c | 90 / 3 |

没有一条是「改了坏代码还全绿」，这才是第 ② 项里那 6 条负向护栏的意义：它们在实现之后
分别被 M1 / M2 / M5 抓红过。

尺子自己翻过的两次车（都不算产品红，但必须记）：

1. 1b 节刚写出来时复用了上文 1 节的局部变量 `bad` 当夹具。但 1 节的 `const bad` 在那一节
   `})();` 时就出了作用域，1b 里能取到的 `bad` 是模块级的**失败登记函数**——
   `Object.assign({}, bad, …)` 会得到一份只有 `inbox_path` / `path` 的空凭据，
   红就红在「夹具坏了」，而不是「产品没捡起」。改法：1b 自己造一笔「受理但没答上」的凭据
   `pend`，并加一条 R-00 前置判据（凭据形状不对就直接判不过，不许让后面的判据拿空对象凑数）。
2. G-55 的注入对照用 `String.replace` 摘入口。`room_dispatch.js` 里
   `surface.retryPendingHandoffs` 有两处（`typeof` 判断 + 实际调用），`replace` 只换第一处，
   副本仍然「看起来接着的」→ 第一次跑矩阵判 `PASS=397 FAIL=1`。
   门是有牙的，坏的是尺子：改成 `split/join` 全量摘掉，同一条尺子的三向输出写进 stderr
   （`real=true mut=false store=true i18n=true`）。这条坑与 §8.30 的「参数写死的因果锚点」
   是同一类：**注入对照摘不干净，比没对照更危险**，因为它会一直绿。

**⑦ 顺手抓到的一条真缺口：群编排合同链此前根本没被聚合门跑过。**

`grep -rn "prove_room_orchestrator" scripts/*.sh` 在本轮登记前是 0 命中，
`e2e_desktop_room_orchestration.mjs` 同样不在矩阵里。也就是说 §8.30 之后那 76 条 handoff
合同、以及本轮 R-01…R-10 全都不在任何聚合门的覆盖范围内——改坏了矩阵照样全绿。
这与 §8.25（G-53「验收标准本身的门没人跑」）是同一个病。本轮先把
`prove_room_orchestrator.js` 接进 G-55（它跑在 mkdtemp 里，秒级、不碰 Electron），
`e2e_desktop_room_orchestration.mjs` 需要真 `moon` + 本地 provider（分钟级），
仍留在残留里（第 ⑩ 项）。

**⑧ 打开工作树时读到的异常（不属于本轮改动，但必须记账）。**

本轮开始时工作树里 `report.md` 相对 HEAD 是 `0 增 / 1482 删`、`parity-gaps-next.md` 是
`5 增 / 85 删`——两份只许追加的文档被截断了（不是改写，是纯丢）。处理方式：
先把残本备份到 `/tmp/truncated-*.bak`，再 `git checkout HEAD --` 还原，
还原后行数回到 1664 / 175，本轮结束时 numstat 删除数为 0。
`docs/design/desktop-target/reference/*` 那批截图与证据 json 也是脏的（历史门跑的输出），
同样还原到 HEAD，不提交。

**⑨ 全量矩阵与核验（只写实测数字）。**

| 门 | 修复前 | 修复后 |
|----|--------|--------|
| `prove_room_orchestrator.js` | 82 / 11（R 块插入后） | **pass=93 fail=0** |
| `e2e_desktop_user_journeys.mjs` | 68 / 1（渲染映射摘掉态） | **PASS=69 FAIL=0 SKIP=0** |
| `prove_room_dispatch.js` | 29 / 0（既有） | 29 / 0 |
| `prove_gp143_orchestration.js` | 40 / 0 | 40 / 0 |
| `prove_m29_roomchat.js` | 41 / 0 | 41 / 0 |
| `smoke_grok_desktop_parity.sh`（全量矩阵） | — | **PASS=398 FAIL=0**，`✗` 计数 0，14 道自计数门 `SKIP=0` 全在 |
| `prove_report_history_intact`（矩阵内） | — | PASS=7 FAIL=0（负向对照 4/3 仍如实红） |
| `git status --porcelain data/` | 空 | 空（门跑不污染用户数据） |

矩阵第一次跑是 **397/1**，红在 G-55 自己的注入对照上（第 ⑥.2 项）；改尺子之后复跑 398/0。
本轮没有为了让数字好看而跳过那一次 397/1。

**⑩ 残留（诚实，不伪造）。**

- **捡起仍然只搭「下一次群回合」这班车**：群里的消息停下来，挂着的那笔也就停着。
  定时唤醒 / routines 那条路（`data/routines/fires.jsonl`）不走 `dispatchRoomTurn`，
  所以还没接 `retryPendingHandoffs`；接上去是 GP-166 的下一跳，不是本轮已完成的事。
- **端到端那一跳用的是注入 runner**：R 块与渲染取证都靠注入 / 真 store 行，
  真 provider 挂掉 → 下一轮自动捡起 → 屏幕上出现答案，这条整链仍要在装了真 key 的机器上验一次。
- 上限 3、每轮 5 笔、claim 10 分钟写死在代码里，没有用户可配项，也没做设备侧验证；
  这三个数字是「说得清的默认值」，不是测出来的最优值。
- inbox JSONL 依然只是账本：捡起后的终态只回写在存根上，两边靠 `path` / 文件名关联，
  没有统一的「还挂着 N 笔」查询面（用户想知道总量只能在群里等它被捡）。
- dm-only 审批链路（GP-167）没动，那条的验收仍靠「新路径压根不产生审批卡」成立。
- `e2e_desktop_room_orchestration.mjs` 没接进聚合门（见第 ⑦ 项），
  安卓真机上「下一轮把转交捡起来」也没有设备证据。

## 8.33 挂账不能只等「下一次有人说话」；Box 的清单缺三块，手机那条链在真机上是断的（GP-168 / GP-169）

**① 断点（两条，都是本轮跑门时撞出来的，不是设计的延伸）。**

第一条直接承接 §8.32 自己写下的那条残留：GP-166 的捡起只搭「下一次群回合」这班车。自媒体的真实形状是
08:00 定时发文内部转交给审核 Bot、provider 挂了 → 凭据落盘、标 `pending`；之后一整天群里没人再发消息，
这笔任务就永远睡着。而定时 sweep（`routine_tick`）是唯一必然每天发生的唤醒 —— 它不捡，就没人捡。

第二条更硬：本轮为了复核既有门跑 `scripts/prove_box_routine_sweep.js`，在 HEAD 树上是 `pass=0 fail=2`：
Box 进程一起来就 `MODULE_NOT_FOUND`，后面 16 条（到点扫、手机拉待批、批准留痕、同一笔不能再批第二次）
全都没机会执行。也就是「手机连上我这台电脑」这条链在真机上根本走不通，而当时全量矩阵是 398/0 ——
因为聚合门里没有任何一行跑过它（登记前 `grep -rn "prove_box_routine_sweep" scripts/*.sh` 只命中它自己的
`.sh` 壳）。根因不在逻辑，在 `scripts/pack-box.sh` 那份手写文件名清单：`cn_inbound_server.js` /
`host_ffi.js` 后来新增的 `desktop_pairing` / `lan_candidates` / `machine_presence` 三个 require
没回头补清单。单测跑的是仓库里的 `hosts/shared/`，永远发现不了「打包少带一块」。

**② 修复前红（逐字，都在本轮留下日志）。**

- 唤醒班车：`scripts/prove_gp168_handoff_wake.js` 首跑 `pass=8 fail=10`（`/tmp/gp168-red.log`），
  红项 W-01「唤醒回包里没有 handoff_retry（班车没接）」、W-02b、W-03、W-03b、W-06、W-07、W-07b、
  W-07c、W-08c、W-09；判据改写后复跑仍 `8/10`（`/tmp/gp168-red2.log`），红在同一个位置。
- 真 Electron：把挂载摘掉后跑 `e2e_desktop_user_journeys.mjs` → `PASS=69 FAIL=2 SKIP=0`，红的正好是
  GP-168 那两条，屏幕上只有「↪ task handed off …」和一句「模型或服务返回失败」，`stuck:0` ——
  挂账躺着，谁也不来叫它（`/tmp/gp168-e2e-red.log`）。
- Box：`prove_box_routine_sweep.js` HEAD 树复跑 `pass=0 fail=2`（`/tmp/sw-head.log`），SW-1 的 stderr
  尾行 `code: 'MODULE_NOT_FOUND'`，requireStack 指到 `box/shared/cn_inbound_server.js`。
- 清单闭包：新建 `scripts/prove_box_pack_closure.js` 首跑 `pass=3 fail=2`，P-01 报
  「缺：shared/desktop_pairing.js, shared/lan_candidates.js, shared/machine_presence.js」。

**③ 这把尺子先量错过自己三次，都记下来。**

1. W-09 原写「`{room:"roomB"}` 时 `attempted === 0`」。判据本身是错的：那一刻 roomB 自己也挂着合法
   待办，捡起当然去捡。红测详情里的 `{"attempted":4}` 不是产品破了，是我在要求「B 间不许有事可做」。
   改成量真正不该发生的事：A 间那笔凭据 `attempts` 必须仍是 0、A 间转录不多一行、
   `skipped_other_room>=1`、`scope==="single_room"`。
2. W-03 带过一条 `max_attempts >= 1`：`max_attempts` 是回包里恒在的常量字段，这条子断言永真 = 没测。
   换成 `retr3.stuck >= 1 && retr3.notified >= 1`（这一轮真数得出卡住、真往群里点了名）。
3. G-57 的注入对照第一次是**假绿**：临时树里 `prove_box_pack_closure.js` 用 `ln -s` 挂进去，而 node 会把
   主模块的 symlink 解析成 realpath —— 门里的 `ROOT` 退回仓库本身，「摘掉三个名字」的副本读的还是仓库
   那份清单，照样 5/0 绿。改成 `cp -f`，并同时要求「原样副本仍绿」，红才归给清单而不是归给一把读错
   输入的尺子。

**④ 改动（四处，只加可选入参 / 可选字段，既有契约一字不动）。**

| 文件 | 改动 |
| --- | --- |
| `hosts/desktop/product_surface.js` | `retryPendingHandoffs` 新增可选入参 `all_rooms:true`；回包新增可选字段 `scope`（`single_room` / `all_rooms`）与 `skipped_no_room`；循环内落点由写死的 `roomId` 改为 `target = roomId \|\| stub.room`（凭据自己记的那间群）。给了 `room` 时单群语义一字未改。 |
| `hosts/shared/host_ffi.js` | async `executeHostEffects` 在 `routine_tick` / `routine_wake` 的效果行返回后 `await surface.retryPendingHandoffs({all_rooms:true})`，把 `handoff_retry` 同时挂到效果行与 stdout JSON；stdout 不可解析时只挂效果行（不伪造 stdout）。tick 原有 payload 一个字段没动。`executeRoutineEffect` 是同步的，捡起要 await 内核回合，所以只能挂在这个 async 收口处。 |
| `hosts/shared/host_ffi.js` | `runHandoffTurn` 的 `ok` 加上 `&& !out.nested_skipped`（见第 ⑤ 项）。 |
| `scripts/pack-box.sh` | shared 清单补 `desktop_pairing.js` / `lan_candidates.js` / `machine_presence.js`（20 → 23）。 |

**⑤ `runHandoffTurn` 那个造假洞（本轮最该记的一条）。**

`runWorkerMoonTurn` 在 nest depth≥1 时返回 `{ok:true, nested_skipped:true, assistant:"(worker nest skipped at depth N)"}`。
responder 闭包按 `!out.nested_skipped` 判失败，唯独 `runHandoffTurn` 只看 `out.ok !== false` —— 而它正是
捡起路径要用的 runner。后果：定时唤醒捡起挂账 → 内核被跳过 → 那句 `(worker nest skipped at depth 1)`
被当成目标 Bot 的答复写进群转录、凭据标成 `answered`，用户看到「它答上了」，实际上一个字都没跑。
变异对照 M2（把 `ok` 退回旧写法）实测把 W-02、W-03、W-03b、W-05、W-07b 五条一起演绿：一处宽松判定
会把「假交付」传播到跨群隔离与有界重试上。现在两处同一口径 —— skipped = 失败，`last_error=nested_skipped`，
群里渲染成兜底的人话，原始协议码只在 dev 模式露出。

**⑥ 变异对照（七条，每条都有归属；全量摘用 `split/join`，`String.replace` 只摘第一处的坑在 §8.32 记过）。**

| 变异 | 门结果 | 翻红的判据 |
| --- | --- | --- |
| M1 摘掉唤醒班车上的挂载 | 12/6 | W-01、W-02b、W-03、W-03b、W-06、W-08c |
| M2 放回 `runHandoffTurn` 的 nested_skipped 造假 | 13/5 | W-02、W-03、W-03b、W-05、W-07b |
| M3 `all_rooms` 把落点写死成第一间群 | 17/1 | W-07b |
| M4 摘掉单次捡取上限 | 17/1 | W-06 |
| M5 摘掉终态跳过（幂等键失效） | 17/1 | W-04 |
| M6 没给 room 就自作主张扫全部 | 17/1 | W-10 |
| M7 摘掉单群过滤 | 16/2 | W-09、W-09b |

七条全有归属、`mutations_bad=0`；跑完立刻还原，`git diff --stat` 与变异前逐字一致
（product_surface +23/-7、host_ffi +37/-1）。摘掉的行仍留在文件里（`typeof` 那行没删），
所以 M1 是「假装有入口但不接」的形态，不是删函数式的作弊。

**⑦ 修复后绿（实测数字，不口头担保）。**

| 门 | 修复前 | 修复后 |
| --- | --- | --- |
| `scripts/prove_gp168_handoff_wake.js` | 8/10 | **PASS=18 FAIL=0** |
| `scripts/prove_box_pack_closure.js` | 3/2 | **PASS=5 FAIL=0** |
| `scripts/prove_box_routine_sweep.js`（HEAD 也红） | 0/2 | **PASS=18 FAIL=0** |
| `scripts/prove_room_orchestrator.js`（GP-166 回归） | 93/0 | PASS=93 FAIL=0 |
| gp157 / gp158 / gp161 / m22 | PASS | 全 PASS（routine 与 read-first 链无回归） |
| 真生产入口 CLI `tick routines`（矩阵 G-56 内） | — | 唤醒回包带 `handoff_retry(scope=all_rooms)`，探针挂账 attempts 递增、`last_error=nested_skipped`、没被演成答上 |
| `e2e_desktop_user_journeys.mjs`（真 Electron） | 摘掉班车 69/2 | **PASS=71 FAIL=0 SKIP=0**（新两条都在屏幕上落地） |
| `smoke_grok_desktop_parity.sh` 全量矩阵 | 398/0 | **PASS=417 FAIL=0**，`✗` 计数 0，14 道自计数门 `SKIP=0` 全在，`git status --porcelain data/` 为 0 行 |
| `prove_report_history_intact.mjs` | 7/0 | PASS=7 FAIL=0 |

矩阵 +19 条逐笔对账：G-56 11 条（合同门 1 + W 锚点 8 + 真生产入口探针 1 + 接线/注入对照 1）、
G-57 7 条（闭包门 1 + P 锚点 4 + 清单副本注入对照 1 + 真 Box 取证 1）、G-53 新增 GP-168 渲染锚点 1 条。
探针只清自己造的那间群与那份凭据（跑完 `data/agents/handoffs/` 回到 0 个文件、rooms 数量回到原值）。

**⑧ 门禁接线（继续堵「门存在但没人跑」这一类根因）。**

G-56 = 唤醒合同门 + 8 条 W 锚点 + 真生产入口探针 + 三处各摘各的都翻红的注入对照；
G-57 = 清单闭包门 + 4 条 P 锚点 + 清单副本注入对照 + 真 Box 取证（打包 → 起进程 → 到点扫 →
手机拉待批 → 批准留痕 → 重复批准被拒）。G-53 另加一条 GP-168 渲染锚点：真 Electron 里这两行取证
不出现就整条翻红；只有当数据根里存在别人的挂账、或可见 Bot 不足两个时才打 `· skip`
（SKIP ≠ PASS —— 环境不足既不许记成产品缺陷，也不许记成绿）。

**⑨ 残留（诚实）。**

1. 唤醒班车只覆盖 `routine_tick` / `routine_wake` 这两个效果。Box 侧 `routine_scheduler.js` 经由同一条
   `executeHostEffects`，已顺带覆盖；但**桌面 App 自己没有定时器** —— 用户开着桌面端、群里没人说话、
   也没跑 daemon 时，挂账还是不动。要么在主进程里挂 sweep，要么把 daemon 装成服务，两条都还没做。
2. `all_rooms` 单轮最多捡 5 笔（`HANDOFF_SCAN_LIMIT`）。挂账多时要靠连续几轮排空；回包里有 `pending`，
   界面上还没有「今天还剩几笔」这个数。
3. 单轮 sweep 内 `attempts` 只 +1，卡住要等三轮唤醒（daemon 间隔内是三次，日历上是三天）。
   上限与间隔都没有产品化解释，也不可配。
4. 取证用 `BITBOT_NEST_DEPTH=1` 让内核侧确定性短路，因此**没有**验到「真 provider 挂掉 → 真模型答复」
   这一整段；那需要装了真 key 的机器。
5. GP-169 修的是「清单缺文件」。Box 在真机（用户自己的机器）上能不能被手机连上、配对码走不走得通，
   仍只有 SW 系列在同一台机器上的 loopback 取证；跨机器、真手机未验。
6. 闭包门只覆盖 `box_main.js` / `host_ffi.js` / `product_surface.js` 三个入口的相对 `require("./x")`，
   动态拼路径的 require 抓不到；以后再新增入口需要把 roots 一起加长。
7. 新增 19 条只进 `smoke_grok_desktop_parity.sh` 这一份本地聚合门；CI 仍只跑 `scripts/eval/run.js` 与
   `prove_android_build.mjs`（`android-apk.yml` 的 paths 只匹配安卓）—— 与 §8.32 记的同一条残留，未闭合。

## 8.34 装好的 App 不会自己醒：唤醒被外包给了一份装不进包的 bash 脚本（GP-170）

**① 断点：不是「没有定时器」这么简单，是「装机后唯一会醒的进程不在包里」。**

§8.33 的残留 1 写的是「桌面 App 自己没有定时器」。继续查下去发现比这更糟：
`hosts/desktop/main.js` 只在启动时 `spawn("/bin/bash", ["scripts/host_routine_daemon.sh", "--long-lived", ...])`
（`ensureRoutineDaemon`，默认 60s 一轮），而 `hosts/desktop/package.json` 的 `build.files` 里**没有
`scripts/`**。也就是说：

- 源码 checkout 里跑 `npm start`：daemon 能起，唤醒正常 —— 开发时看不出问题；
- 装好的 macOS / Linux App：`REPO_ROOT` 解析不到（或没有 `scripts/`），`ensureRoutineDaemon` 返回失败；
- Windows：根本没有 `/bin/bash`；
- 既有的 Electron 门禁**全部**设 `BITBOT_ROUTINE_DAEMON_AUTOSTART=0`（为了不污染用户仓库），
  所以这条「唤醒到底有没有发生」的路径，从来没有一篇门禁真的跑过。

用户的真实形状（自媒体博主）：08:00 定时发文、发完把稿子转交审核 Bot、晚上定时推邮箱。
装机后电脑一直开着、群里没人说话 —— 这些都不会发生；GP-166/168 的「挂账要等下一次群回合或下一轮
sweep」也就永远等不到。

**② 修复前红（逐字）。**

先写门 `scripts/e2e_desktop_sweep_timer.mjs`：故意在 `BITBOT_ROUTINE_DAEMON_AUTOSTART=0`
（= 装机后的真实布局）下启动真 Electron，设 `BITBOT_DESKTOP_SWEEP_MS=250`，只认
`data/routines/last-tick.json` 与 `desktop-sweep.jsonl`：

```
  ✗ S-01 daemon 关闭时，App 自己也会跑 routine_tick（last-tick.json 出现） — 8s 内没有 …/data/routines/last-tick.json
  ✗ S-02 tick payload 标 desktop_sweep:true — 没有 tick
  ✗ S-03 连续两轮 tick — t2=null
  ✗ S-04 desktop-sweep.jsonl 至少两行 — rows=0
  ✗ S-05 sweep 行有起止时间且不嵌套 — 行数不足
e2e_desktop_sweep_timer: PASS=0 FAIL=5 SKIP=0
```

**③ 尺子先翻车两次（都记下来，免得下一轮重复）。**

1. 首跑报 `Process failed to launch!`：`DISPLAY=:1` 指向一个不存在的 X socket。Electron 在 ozone 里
   SIGSEGV，看起来像产品崩。按矩阵里既有写法用 `xvfb-run -a` 包住才成立。
2. S-06 轮询写成每轮 `app.process()`：app 退出后 playwright 会把连接 dispose，再取 process 直接抛
   `Cannot read properties of undefined (reading '_object')`。判据本身没问题，是尺子自己的 bug ——
   改成在 quit 之前抓一次 child process，之后只读它的 `exitCode/signalCode`。

**④ 改动（只加可选字段，不动既有契约）。**

- `hosts/desktop/main.js`
  - `DESKTOP_SWEEP_MS`：默认 60000（与 daemon 同节奏），`BITBOT_DESKTOP_SWEEP_MS` 可调，`0` = 关；
  - `runDesktopSweep(reason)`：走 `ffi.executeHostEffects([{kind:"routine_tick",...}], {desktopSweep:true})`，
    正是 daemon 每轮跑的同一个 Host 效果；**single-flight**（`desktopSweepInFlight`），上一轮没结束时
    这一轮如实记 `skipped_in_flight`；失败不吞，行里带 `error`；
  - `desktop-sweep.jsonl`：每轮的 `started_at/ended_at/tick_ok/due_count/fired_count/handoff_retry`；
    这是 App 自己的运行日志（不是用户数据），超过 1MB 只留最近 500 行；
  - `syncWakeSource()`：**只留一个唤醒源** —— shell daemon 真在跑就让位，否则主进程自己扫；daemon
    `exit`/`error` 时自动接手（`error` 还顺手补了监听器：以前 spawn 失败会升级成主进程未捕获异常）；
  - `before-quit` / `will-quit` 停表；`ensureRoutineDaemon` 对 `REPO_ROOT` 为空与 Windows 如实返回
    `fallback:"desktop_sweep"`，不再在 `whenReady` 里 `path.join(null, …)` 抛错。
- `hosts/shared/host_ffi.js`：tick 分支读 `effectOpts.desktopSweep`，只在为真时加
  `wakeEntry.desktop_sweep = true` 并把 `note` 写成 `desktop in-process sweep (...)`；`daemon`/`long_lived`
  仍如实为 `false`（不冒充 daemon）。tick 的 stdout 只加一个可选 `at`，给 sweep 日志对时间。

**⑤ 一个容易「看起来修好了」的坑。**

第一次注入对照只摘了 `whenReady` 里的 `syncWakeSource()`，门照样 6/0 全绿 —— 因为
`ipcMain.handle("bitbot:daemon:ensure")` 里也调了一次（渲染进程启动时会问 daemon 状态），
两条启动点互相兜底。把两处都摘掉才变成 5 红。教训同 GP-169：**能被两处喂饱的尺子不算尺子**，
注入对照必须全量摘。

**⑥ 注入对照（四次，各自只红该红的那几条）。**

| 摘掉什么（全量 `split/join` / `str.replace`） | 结果 |
| --- | --- |
| 两处 `syncWakeSource()` 启动点 | `PASS=1 FAIL=5`，S-01…S-05 红；S-06 仍绿（见 ⑨.1） |
| `host_ffi` 的 `wakeEntry.desktop_sweep = true` | `PASS=5 FAIL=1`，只有 S-02 红 |
| sweep 行的 `ended_at` | `PASS=5 FAIL=1`，只有 S-05 红 |
| `row.handoff_retry` 转述改成 `null` | `PASS=5 FAIL=1`，只有 S-04 红 |

每次摘完都从 `/tmp/gp170-*.bak` 恢复并 `cmp` 核对，矩阵跑完工作树不留变异态。

**⑦ 修复后绿（实测）。**

| 门 | 修复前 | 修复后 |
| --- | --- | --- |
| `scripts/e2e_desktop_sweep_timer.mjs`（真 Electron） | 0/5 | **PASS=6 FAIL=0 SKIP=0** |
| `scripts/prove_gp168_handoff_wake.js`（回归） | — | PASS=18 FAIL=0（tick 可选字段未影响旧判据） |
| `scripts/prove_box_pack_closure.js`（回归） | — | PASS=5 FAIL=0 |
| `scripts/e2e_desktop_quit.mjs`（回归：退出仍是干净退出） | — | PASS=8 FAIL=0 SKIP=0 |
| `smoke_grok_desktop_parity.sh` 全量矩阵 | 417/0 | **PASS=441 FAIL=0**，`✗` 计数 0，15 道自计数门 `SKIP=0` |

矩阵 +9 条全部来自 G-59：断点自证 1 + 真 Electron 门 1 + S 锚点 6 + 四路注入对照 1。
（441 = 417 旧基线 + G-59 的 9 条 + G-60 的 6 条 + 远端提交带进来的 3 条 + 常驻内核 G-58 的
6 条（整合分支上两块都自称 G-57，事件日志底座已挪到 G-61，编号以脚本里的 `echo "== G-` 为准）。
最后这 6 条只在 `_build` 里有原生内核时才跑 —— 本轮 `pack-desktop.sh` 编了一次内核，
它们才第一次进入矩阵。）

**⑧ 门禁接线。**

G-59 = 断点自证（`package.json` 不带 `scripts/` 且 `main.js` 仍需要它）+ 真 Electron 门 + 6 条 S 锚点
+ 四路注入对照。断点自证会在「以后有人把 scripts/ 打进包」或「main.js 不再依赖 shell 脚本」时翻红，
提醒先复核断点是否还存在，而不是让门禁变成永远绿的装饰。

**⑨ 残留（诚实）。**

1. S-06「退出后不再产生新 tick」是**粗尺**：进程退出本身也会让定时器消失，所以即使 before-quit 里
   忘了 `stopDesktopSweep()`，它也照样绿。它证明的是「没有退出后仍在写的幽灵进程」，不证明
   `clearInterval` 那一行真的跑了；`stopDesktopSweep` 的接线靠代码审阅与 QUIT 门（进程真的退出）兜底。
2. 「daemon 在跑时让位」这条分工没有门禁覆盖：门禁全部把 daemon 关掉，因为真 daemon 是长驻进程，
   会在门禁跑完后继续写用户仓库。目前的证据是代码路径 + 启动日志 `[desktop] wake-source ...`。
3. 默认 60s 是照 daemon 的节奏定的，没有按「定时发文最多晚多久」做过产品化论证；间隔也不可配给
   最终用户（只有环境变量）。
4. `desktop-sweep.jsonl` 1MB 轮转只保留 500 行，极端情况下历史会被截断（这是运行日志，不是用户数据）。
5. 打包后的 App 仍**没有**被真机安装验证过；本门禁证明的是「同一个 main.js 在 daemon 不可用时自己会扫」，
   `electron-builder` 打出来的包能不能找到 `hosts/shared`、能不能启动，属于打包门禁的范畴，未在本轮验证。
6. 新增 9 条同样只进本地聚合矩阵；CI 仍不含它 —— 与 §8.32 / §8.33.⑦ 同一条残留。

## 8.35 远端最新提交里躺着未解完的冲突标记：桌面 App 连 require 都过不去（GP-171）

**① 事故事实（不是猜的，是对远端提交本身跑出来的）。**

拉最新代码时 `cursor/next-target-v1` 已经推到 `a0ec929`。这个提交里有两份源码是
**未解完冲突的工作树**直接提交的：

```
$ git show a0ec929:hosts/desktop/product_surface.js > /tmp/a.js && node --check /tmp/a.js
/tmp/a.js:2516
<<<<<<< HEAD
^^
SyntaxError: Unexpected token '<<'

$ git show a0ec929:scripts/prove_room_orchestrator.js > /tmp/b.js && node --check /tmp/b.js
/tmp/b.js:141
<<<<<<< HEAD
^^
SyntaxError: Unexpected token '<<'
```

编排门里还多了一份重复夹具（`const noRunner` 出现两次，第 159 与 184 行）。也就是说：

- 桌面 App 一 `require("./product_surface")` 就 SyntaxError —— **整个应用起不来**；
- `prove_room_orchestrator.js` 即使在解掉标记之后也会因为重复 `const` 解析失败；
- 而当时没有任何门禁/CI 报告这件事：所有门都跑在「源码已经解析成功」之后，
  源码本身坏掉时它们连第一行都到不了，矩阵仍然是绿的。

这正是本项目反复记的同一类根因：**「门存在但没人跑」之外，还有「门跑在坏源码的下游」**。

**② 解决冲突的口径（按 §8.30 合同，不按哪边行数多）。**

两侧其实在争同一件事的措辞：`accepted/ok` 是「受理」，`replied/transferred/pending/reply_error`
是「答没答上」。采用的合并结果：

- `handoffTaskAsync` 没有 runner：`ok/accepted=true`、`error=""`、`pending=true`、
  `replied/transferred=false`、`reply_error="handoff_runner_required"`、`execution="queued"`，
  保留 `queue_reason`（旧读者只认它也不受影响）；
- `handoffTask` 同步入口：`accepted=true` + `replied=false`，注释保留「accepted 只说受理」；
- `prove_room_orchestrator.js`：删掉重复夹具，合并两侧断言。**丢弃**了旧的
  `bad.error.length > 0` —— 它和本轮实现（受理成立时 `error` 必须为空）自相矛盾，
  而「原因可见」由 `reply_error === "provider down"` 覆盖。这一条如果照抄，门会永远红。

**③ 新门：`scripts/prove_repo_integrity.mjs`（只问源码本身）。**

- I-00 `git ls-files` 可用；
- I-01 全部被跟踪文件里没有 `<<<<<<< ` / `>>>>>>> ` 行；**`.md` 代码围栏内的行算引用**
  （本报告 §8.35 必须逐字贴 node 的报错原文），围栏外、以及所有非文档文件照罚；
- I-02 全部被跟踪 `.js/.mjs` 通过 `node --check`（排除 `node_modules/vendor/_build/artifacts/dist`）；
- I-03 尺子自身三向对照：代码里的标记必抓、文档围栏内的引用**不误报**、围栏外的标记照抓、
  干净文件不误报且可解析。

**④ 尺子翻车一次（记下来）。**

注入对照最初把标记追加到「门禁脚本自己」身上：脚本直接解析失败退出，日志里根本没有
`I-01` 那一行，于是判定条件「必须看到 I-01 变红」永远不成立 —— 尺子红对了，判据却读不到。
改成往一份被跟踪、本门不执行的普通源码（`hosts/desktop/paths.js`）追加标记后，
`✗ I-01` 如预期出现，恢复后 `cmp` 一致。

**④b 尺子第二次翻车（全量矩阵抓到，比第一次更值得记）。**

把 GP-170/171 的改动丢进全量矩阵后，G-60 反而红了 —— 不是源码坏了，是**门把报告自己判成了事故**：

```
✗ I-01 被跟踪文件里没有冲突标记 — docs/design/desktop-target/report.md
prove_repo_integrity: pass=3 fail=1 skip=0
```

§8.35 ② 为了「逐字留证」，把 node 的报错连同 `<<<<<<< HEAD` 那几行原文贴进了代码围栏。
旧 I-01 是「全仓任意文件行首出现标记即红」，于是**验收报告写了证据，就被自己的门判红**。
这把尺子的问题不是误报本身，而是它逼着人「为了门绿而删掉证据」—— 那正是本项目明令禁止的
「看起来修了」。修法不是给报告漂白，而是把口径收窄到危害面：

- 代码/配置里的标记 → 红（危害：`node --check` 失败、应用起不来）；
- `.md` **围栏内**的标记 → 引用，不报（本次事故的证据必须留）；
- `.md` **围栏外**的标记 → 照红（README 里留一组没解完的冲突仍是事故）。

I-03 也随之从两向变成三向。两次变异确认这条豁免既不松也不紧：

| 变异 | I-01 | I-03 | 说明 |
| --- | --- | --- | --- |
| 删掉「围栏内豁免」（`if (fence) continue` → `false`） | ✗ report.md | ✗ `quoteExempt:false` | 证据又被误判 |
| 把豁免放宽成「`.md` 整份不扫」 | ✓ | ✗ `bareCaught:false` | 围栏外的真冲突被放过 |

恢复后 `cmp` 一致，`pass=4 fail=0`。**「能被两处喂饱的尺子不算尺子」之后，还要加一条：
「会把证据判成事故的尺子，会训练人删证据」。**

**⑤ 修复后绿（实测）。**

| 门 | 修复前 | 修复后 |
| --- | --- | --- |
| `node --check`（全部被跟踪 .js/.mjs） | `product_surface.js` / `prove_room_orchestrator.js` 解析失败 | **174/174 通过**（本门自身提交后为 175/175） |
| `scripts/prove_repo_integrity.mjs` | 0/3（若当时存在，会红在两份文件） | **pass=4 fail=0** |
| `scripts/prove_room_orchestrator.js` | SyntaxError（重复 `const noRunner`） | **pass=97 fail=0** |
| `scripts/prove_gp168_handoff_wake.js` | — | pass=18 fail=0 |
| `scripts/e2e_desktop_sweep_timer.mjs` | 应用起不来，无从跑 | PASS=6 FAIL=0 |

同一批还暴露了第二处断点：常驻内核提交把 `kernel_server.js` / `event_log.js` 变成新的
`require`，但 `pack-box.sh` 的手写清单没跟着加 —— 闭包门立刻 **P-01 红（缺
`shared/kernel_server.js`）**，`prove_box_pack_closure` 4/1。补进清单后 shared 23 → 25，
闭包门 **5/0**，真 Box 取证 `prove_box_routine_sweep` 仍 **18/0**。这条不是 GP-171 修的，
是 GP-169 的闭包门自己抓出来的 —— 正好证明「清单不能靠人记」。

**⑥ 门禁接线：G-60。**

G-60 = 完整性门 + 4 条 I 锚点 + 「真塞一行标记就翻红、恢复后仍绿」的注入对照
（目标选 `paths.js`，不选门禁脚本本身）。

**⑦ 残留（诚实）。**

1. 完整性门只管「语法/标记」这一层。它能抓到这次的重复 `const`，但**抓不到**语义层面的重复：
   同名 `function` / `var` 重复定义在 JS 里合法，I-02 不会红。合并后仍需人看 diff。
2. I-02 只覆盖 `.js/.mjs/.cjs`；`index.html` 里的内联脚本、JSON 夹具、`.mbt` 不在内。
3. I-01 只认行首的 `<<<<<<< ` / `>>>>>>> `；行内出现这些字符（文档讲解）不会触发；
   `.md` 围栏内的引用按「证据」放行 —— 这是有意的口径，不是漏扫，双向由 I-03 钉住。
4. 该门与 G-60 同样只进本地聚合矩阵；CI 仍不跑它 —— 与 §8.32 / §8.33.⑦ / §8.34.⑨.6 同一条残留。
   这次事故恰好说明：**CI 不跑的验收，等于把分支质量交给运气**。


## 8.36 装好的 App 第一次启动就崩：门禁一直跑在源码树里（GP-172）

**① 这一步不是「再加一道门」，是把最外一层补上。**

从 GP-170 起，「电脑开着就有人敲钟」已经成立 —— 但那条证据全部来自
`electron hosts/desktop/main.js`：真 Electron、真内核，**却跑在源码树里**。
`__dirname` 可写、`moon` 在 PATH、`scripts/` 就在旁边。用户拿到的不是这个，
而是 electron-builder 打出来的 `app.asar`：只读、没有 moon、没有 scripts。

2026-10-29 第一次真跑 `dist/linux-unpacked/bitbot-desktop`（本仓 `pack-desktop.sh`
的 `--dir` 产物，Linux + xvfb），主进程在 **require 阶段**就炸了：

```
A JavaScript error occurred in the main process
Uncaught Exception:
Error: ENOENT, desktop/.env.local not found in
  .../resources/app.asar
    at upsertDesktopEnvLocal (…/app.asar/desktop/main.js:485)
    at syncInjectedSecretsToEnvLocal (…/app.asar/desktop/main.js:440)
```

用户视角就是：双击图标 → 一个报错框 → 没有窗口。**所有开发机上的绿灯都没覆盖这条路径。**

**② 两条缺陷叠加，缺一条都不会崩。**

1. `DESKTOP_ENV_LOCAL = path.join(__dirname, ".env.local")`。开发时它是
   `hosts/desktop/.env.local`（历史布局，可写）；装机后 `__dirname` 指向 asar
   内部，**只读**。写就在这里 ENOENT。
2. 触发写的不是用户注入的密钥，是 App 自己的默认值：`BITBOT_CONTENT_MODERATION`
   在 `ALLOWED_SECRET_KEYS` 里，而 main.js 在同步之前先把它填成 `"1"`，
   于是「云端注入了密钥，顺手落盘」这条逻辑把**产品默认值**当成了用户密钥。
   开发机上表现为悄悄多一行 `.env.local`，没人注意；装机后就是崩溃。

**③ 修复（每一条都对应上面的断点）。**

- `DESKTOP_ENV_LOCAL`：`app.isPackaged && USER_DATA_DIR` → `<userData>/.env.local`，
  否则保持 `hosts/desktop/.env.local`。密钥跟着用户数据走，不跟着安装目录走。
- `upsertDesktopEnvLocal` 的写盘包 `try/catch`：写不进去返回
  `{ok:false, error:"env_local_unwritable", detail}`（`pretend_saved:false`），
  IPC 层原样回给 Settings，`process.env` 的热加载仍然生效 —— 一次会话可用，
  下次启动要重新填，这个边界说清楚，不假装保存成功。
- `syncInjectedSecretsToEnvLocal()` 在模块加载处包 `try/catch`：它是「顺手帮忙」，
  不能成为启动的单点。
- `BITBOT_CONTENT_MODERATION` 的默认值挪到同步**之后**：默认值是产品行为，不是注入。
- 顺带修掉同一类装机断点：Linux 自启的 `Exec=` 之前是
  `"<execPath>" "<__dirname>"`，装机后 `<__dirname>` 在 asar 里，桌面环境拉不起来；
  现在 `app.isPackaged` 时只写 `"<execPath>"`。

**④ 新门：`scripts/e2e_desktop_packaged.mjs`（只认打包产物）。**

不启动源码树，直接 spawn `dist/<platform>-unpacked/...`，环境按「用户机器」构造：
不继承任何 `BITBOT_*`（尤其 `BITBOT_REPO_ROOT` / `BITBOT_NO_SECRET_SYNC`）、
PATH 里没有 moon、数据落在临时 `--user-data-dir`。

| 门 | 判据 |
| --- | --- |
| P-00 | `app.asar` 在、`resources/kernel/bin/desktop_turn` 在；`moon.mod` / `cmd` / `scripts` 都**不在**包里 |
| P-01 | 进程活着，日志里没有 `Uncaught Exception` / `FATAL` |
| P-02 | `<userData>/data/routines/desktop-sweep.jsonl` 至少 2 轮 `tick_ok:true`，每轮带 `handoff_retry.ok:true`；`last-tick` 是 `desktop_sweep` 写的（daemon=false long_lived=false） |
| P-03 | 注入的 `BITBOT_LLM_API_KEY` 落进 `<userData>/.env.local`（0600），安装目录里没有任何 `.env.local` |
| P-04 | 运行前后 `app.asar` 的 sha256 不变（App 没往自己安装目录写） |
| P-05 | SIGTERM 后退出，且退出后不再产生新 tick |

**⑤ 红 → 绿（同一份产物，同一把尺子）。**

| 版本 | P-00 | P-01 | P-02 | P-03 | P-04 | P-05 | 合计 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 修复前（`a0ec929` + GP-170 的源码打出来的包） | ✓ | ✗ 未捕获异常 | ✗ 0 行 | ✗ 没写 | ✓（什么都没写） | ✓（空跑） | **3 / 4** |
| 修复后 | ✓ | ✓ | ✓ 19 轮 | ✓ 0600 | ✓ | ✓ | **7 / 0** |

**⑥ 尺子自身对照（不是只看它绿）。**

- 假产物对照：`BITBOT_PACKAGED_BIN=/tmp/fake-pack/bin/bitbot-desktop`（一个只会
  `sleep 60` 的脚本）→ P-00 / P-02×2 / P-03 / P-04 **全部翻红**（2/5）。
  这证明 P-02/P-03 不是「进程活着」就能喂饱的。
- 尺子自己踩过一次坑：第一版用白名单环境（只给 `DISPLAY`），漏了 `XAUTHORITY`，
  Electron 连不上 X 直接 **SIGSEGV**，看起来像产品崩了。改成「继承宿主环境 +
  剔掉 `BITBOT_*`」后同一条命令稳定复现产品行为 —— 布局隔离和显示环境不是一回事。

**⑦ 接线：不再靠人记得跑。**

`scripts/pack-desktop.sh` 在打包之后直接跑本门（Linux；有 `DISPLAY` 就直接跑，
没有就 `xvfb-run -a`）。也就是说以后每一次 `BITBOT_PACK_TARGET=dir|dist` 的本机
打包都会真的启动一次产物。macOS/Windows 分支打印「本机未验」并跳过，**不假装跑过**。

**⑧ 残留（诚实）。**

1. 只在 **Linux + xvfb** 下验过。macOS / Windows 的安装包、真机双击安装、
   首次启动向导，仍是未验状态（CI 的 mac 打包产物目前只验「包里有能跑的内核」，
   不启动窗口）。
2. 本门不点窗口、不验首启引导页是否出现；它证明的是「主进程能起、能扫、能写对地方」。
   窗口渲染由 `e2e_grok_desktop_boot` / `shell_v2` 在源码树里覆盖，两者合起来才算完整。
3. 自启 `Exec=` 的修复没有门禁：需要真桌面环境写 `~/.config/autostart` 再登录，
   本沙箱做不到。现在只有代码路径与打包后 `app.isPackaged` 分支。
4. P-02 的 19 轮来自 250ms 测试间隔；产品默认 60s 的节奏在 `e2e_desktop_sweep_timer`
   与 GP-170 里论证，本门不重复。
5. 打包本身依赖 `pack-desktop.sh` 先编内核；本门不负责「包里有没有内核」的构建正确性
   （那是 `prove_pack_artifacts.mjs`），只负责「有内核的包能不能真的跑」。
6. **全量矩阵在这一轮暴露了一个既有的不稳定点（不是 GP-172 引入的，但必须记）**：
   三次全量矩阵里，两次在 `e2e_grok_desktop_boot` 的「回合落盘」型断言上偶发红
   —— 一次是 `GP-112 isolation`（Bot B 的 recall 30s 内没有行），一次是
   `GP-128 session`（M27 探针会话没进 store），且都会连带让后面 grep 该日志的
   G-27 三条锚点一起红。同一个脚本单独连跑三次都是 **128/0**，最终矩阵 **441/0**。
   当前结论是「墙钟等待 + 固定端口 stub 在长矩阵里偶发超时」，不是产品行为回退；
   但**没有找到根因之前不算修好**。下一步该把这几处从固定 30s 等待改成事件驱动
   （store 落盘即返回），并给 stub 端口做占用探测。

## 8.37 用户只是填了个 key，内容审核门被静默关掉（GP-173）

**① 用户路径与现象（装机包，CDP 真点，不是读源码猜的）。**

```
账户胶囊 → 设置 → 凭证 → 填 sk-ui-saved-2468 → 保存并热加载
<userData>/.env.local 里出现：BITBOT_CONTENT_MODERATION=0
```

填 key 之前，这个复选框在页面上就是**未勾选**的（`勾选前=false`）——而产品的默认值
是开（`main.js`：`BITBOT_CONTENT_MODERATION === undefined` 时填 `"1"`）。也就是说：
**一次再普通不过的「保存并热加载」，把默认开启的内容审核门关掉了，用户全程没有看到任何提示。**
对「自媒体博主 → 多 Bot 产稿 → 定时发群/推邮箱」这条主线，这是把安全默认值当成了可选项。

**② 根因：三处各差一点，叠起来才发生。**

1. `bitbot:secrets:status` 只对 `_POST$|_MODEL$|_BASE_URL$|_CHAT_ID$|_AGENT_ID$|
   _TOUSER$|_FILING$|_FEED_URL$|_PROVIDER$|_API_BASE$` 回读 `value`；
   `BITBOT_CONTENT_MODERATION` 不在里面 → 返回 `value: undefined`。
2. 渲染层 `refreshSecretsForm()` 只在 `value !== undefined` 时回填复选框
   （`index.html` 的 `if (mod && f.BITBOT_CONTENT_MODERATION && …value !== undefined)`），
   所以它保持 HTML 里的初始「未勾选」，看起来就是「用户自己关的」。
3. `saveSecretsFromForm()` **无条件**提交
   `BITBOT_CONTENT_MODERATION = checked ? "1" : "0"`；写盘成功后热加载立刻生效。

附带一条同类断点：`secrets:status` 的 `path` 硬编码 `"hosts/desktop/.env.local"`。
GP-172 已经把装机后的真实文件挪到 `<userData>/.env.local`，但这条没跟上 ——
界面上「配置文件位置」指着一个用户机器上根本不存在的路径。

**③ 修复（一处读、一处显示）。**

- `value` 的正则加 `_MODERATION$` → 复选框按进程里的真实值回填（默认就是勾选）。
- `path: DESKTOP_ENV_LOCAL` → 开发时是 `hosts/desktop/.env.local`，装机后是
  `<userData>/.env.local`，和 GP-172 的写盘路径同一个来源。

**④ 新门 P-06：在装机包里走一遍真实 UI（不是直接调 IPC）。**

在 `scripts/e2e_desktop_packaged.mjs` 里、P-05 之前，用 CDP 真点：
账户胶囊 → 设置 → 凭证 → 填 key → 保存，然后断言三层：

| 断言 | 为什么是这三层 |
| --- | --- |
| `<userData>/.env.local` 里 `BITBOT_CONTENT_MODERATION=1` | 最终事实：保存没有改掉默认值 |
| `#sec-moderation` 保存后仍勾选 | 用户看到的状态与磁盘一致，不是「磁盘对、界面错」 |
| `secrets.status().path === <userData>/.env.local` | 界面指向的路径真的存在 |

红 → 绿（同一份装机产物，同一把尺子）：

| 版本 | P-06 | 整门 |
| --- | --- | --- |
| 修复前（GP-172 产物） | ✗ `保存后审核门不是 1（实际 0）; 保存后复选框未勾选（勾选前=false）; status.path 不是 userData：hosts/desktop/.env.local` | **7 / 1** |
| 修复后（重新 `pack-desktop.sh --dir`） | ✓ | **8 / 0** |

**⑤ 尺子第三次翻车：`DISPLAY` 设了不等于能用。**

把 P-06 接进 `pack-desktop.sh` 后，整门连续两次 4/4 红，P-01 只写
`signal=SIGSEGV` —— 看起来像「刚修好的产物又崩了」。先补「崩溃时打印输出尾部」，
下一轮立刻拿到真因：

```
[desktop] synced injected secrets → .env.local: BITBOT_LLM_API_KEY,...
ERROR:ozone_platform_x11.cc(245)] Missing X server or $DISPLAY
```

本沙箱宿主有 `DISPLAY=:1`，但 `:1` 的 Xvfb 早就退了。`pack-desktop.sh` 的判断是
「`DISPLAY` 为空才套 `xvfb-run`」，于是直接跑了 Electron；门的 `hasDisplay()` 也
只认「变量非空 / 有 xvfb-run」，于是既不 SKIP 也起不来。

修法：新增 `displayUsable()`（`xdpyinfo -display $DISPLAY` 探活；没装 `xdpyinfo`
就退化为 `/tmp/.X11-unix/X<n>` 是否存在）。不可用且还没包装过 →
用 `xvfb-run -a` **重新执行自己**（`BITBOT_XVFB_WRAPPED=1` 防递归）；
已经在 xvfb 里仍不可用 → 判红 `P-00`，**不 SKIP**（那是尺子坏了，不是缺证据）。

证据：修前 `node scripts/e2e_desktop_packaged.mjs`（宿主 `DISPLAY=:1`）→ 4/4 红；
修后同一条命令打印「`DISPLAY=:1` 连不上，改用 xvfb-run 重跑」→ **8/0**；
`BITBOT_PACK_TARGET=dir bash scripts/pack-desktop.sh` 端到端 → **8/0**。

**⑥ 残留（诚实）。**

1. P-06 只在 **Linux + xvfb** 的 `--dir` 产物上走过；macOS / Windows 的安装包与
   真机安装同 §8.36 仍是未验。
2. 只钉了「内容审核」这一个开关。其余开关（`_POST` 系列、`_FEED_URL`）本来就在
   status 回读白名单里；P-06 是这类「保存会顺手改开关」缺陷的模板，但不是全量矩阵。
3. dev 树里没有对应锚点：凭证页的「保存」会写用户真 `.env.local`（固定路径，
   `BITBOT_REPO_ROOT` 隔离不到），所以 `e2e_desktop_llm_key_paste_guard` 只验到
   「不点击保存」的那一层。要回归只能跑打包门；CI 仍不跑打包门。
4. 本轮矩阵第一遍出现 **437/4**，全部集中在 `G-47 e2e_android_roster`（AR-06 401 /
   AR-11 拿不到局域网地址）。根因不是产品：上一轮手工复现留了一个 packaged app
   （`--user-data-dir=/tmp/pk-shot/ud`）占着 `127.0.0.1:18765`，门里的入站
   `EADDRINUSE`，请求打到了那个旧实例上。杀掉后单跑 **20/0**，矩阵复跑
   **441/0**。记一条：**固定端口的门禁不会自己发现环境里还有上个实例**；
   下一步该让门禁用临时端口（`BITBOT_CN_INBOUND_PORT=0` 已是合法请求）或在启动前探测占用。

## 8.38 「会话没进 store」不一定是产品丢了：800ms 单次读 + 固定 stub 端口（GP-174）

**① 症状与代价。**

GP-172 那一轮的三次全量矩阵里，两次红在同一条断言上：

```
✗ E2E GP-128 session — M27 probe session never reached the store
```

连带 G-27 三条 grep 锚点一起红（它们 grep 这份日志）。同一个脚本单跑三次都是 128/0。
当时的结论只到「墙钟等待偶发超时」，根因未定位 —— 这条按未修记在 §8.36 ⑥.6。

**② 根因（已定位的那一条）。**

M27 段先发一条真消息，然后：

```js
await win.waitForTimeout(800);
const st = JSON.parse(fs.readFileSync(SESS_M27, "utf8"));
```

**死等 800ms，然后只读一次**。store 的落盘是异步的：机器一忙（长矩阵里同时在编译、
跑别的 Electron 门），写入晚于这个窗口，这一次读就是空的 → `m27SessionId` 为空 →
整段右栏断言被 `if` 跳过 → 最后只报一句「没进 store」。

这条**可以确定性复现**：stub 已支持 `BITBOT_STUB_LATENCY_MS`（同步阻塞、真的晚回包），
给它 3s，旧代码 100% 红，报错原文一模一样。

另一条同类隐患：这个 stub 用的是固定端口 `8796`。上一轮被打断的重跑留下的 stub 还在时，
新 stub 绑不上，回合会打到旧进程（或者干脆 connection refused）。症状同样是「没进 store」。

**③ 修复（只动尺子，不动产品）。**

- 把「死等 + 单次读」换成**轮询到出现**（150ms 间隔，20s 兜底）；
- stub 端口改成每轮 `pickFreePort()`，端口号写进 base_url；
- 超时的时候把现场带进断言：store 条数、最近 3 个标题、stub 尾部、主进程尾部
  （Playwright 的 `electron.launch` 解析时启动日志已输出完，主进程尾部可能为空，
  空的时候明确写「启动日志早于 launch 解析」，不装成采集成功）；
- `launchOnce` 里挂一个 300 行的进程输出环形缓冲，`GP-111/112` 失败时一并带出
  新出现的 `recall-*.json`（prefix / bot_id / count）——GP-112 的偶发红还没有定位，
  先把「看不见」变成「看得见」。

**④ 红 → 绿（确定性复现，不是等它偶发）。**

| 跑法 | 结果 |
| --- | --- |
| 旧脚本 + `BITBOT_STUB_LATENCY_MS=3000` | **121 / 1**：`✗ E2E GP-128 session — M27 probe session never reached the store` |
| 新脚本 + 同样 3s 延迟 | **128 / 0**（GP-128 三条 + GP-129 两条全绿） |
| 新脚本 + 40s 延迟（> 20s 兜底，负向对照） | **118 / 4**，报错带现场：`{"store_sessions":33,"last_titles":[...],"stub_tail":"[stub-llm] http://127.0.0.1:36113/v1 mode=ok"}` |
| 新脚本 + 正常时序 ×2 | **128 / 0**、**128 / 0** |

负向对照是必须的：只证明「慢的时候也绿」还不够，还要证明**真的没有**的时候它仍然红。

**⑤ 诚实边界。**

- 这是尺子修复，产品行为没有改变；它解释的是「为什么同一份代码有时红」。
- **GP-112 的偶发红仍未定位**（`recall` 30s 内没有出现该 Bot 的行）。这一轮只补了现场：
  下一轮再红，断言里会直接看到是不是「点错 Bot / 文件归错人 / 回合根本没跑」。
  在没有拿到那份现场之前，不写「已修」。

## 8.39 固定 18765：环境里残留一个实例，门就假红 5 条（GP-175）

**① 症状。**

GP-173 收尾跑矩阵时，`G-47 e2e_android_roster` 判了 **13 / 5**：
AR-06 带凭证打 `/v1/turn` 得到 `401 invalid_token`、AR-07 同、AR-08 花名册不点亮、
AR-11 拿不到局域网地址。看起来像「手机连桌面大脑」整条链路断了。

**② 根因：不是产品，是环境。**

上一轮手工复现 GP-173 时留下的 packaged app（`--user-data-dir=/tmp/pk-shot/ud`）
一直占着 `127.0.0.1:18765`。门里的 app 入站 `EADDRINUSE`（日志：
`[desktop] cn-inbound failed: listen EADDRINUSE ... 18765`），请求于是打到了那个旧实例上：
令牌当然对不上（401），`listening:false` 也就没有局域网地址。杀掉旧进程后单跑 **20/0**。

**③ 修复：门禁自己挑一个空闲端口，并在本轮内固定。**

`e2e_android_roster` 启动时 `pickFreePort()`，用 `BITBOT_CN_INBOUND_PORT` 传给 app。
为什么不是直接 `0`（app 支持临时端口）：AR-11 收回局域网时会**重启**入站服务，
`0` 会让重启后的端口变掉，于是「同一个局域网地址不该还能用」变成「端口换了当然连不上」，
断言被掏空。挑一次、固定住，重启复用同一个端口，语义保持。

**④ 红 → 绿（同一个占位进程在场时）。**

| 跑法（18765 被一个返回 401 的假实例占着） | 结果 |
| --- | --- |
| 旧门（HEAD 版本） | **13 / 5**（AR-06/07/08/09/11） |
| 新门 | **20 / 0** |
| 新门（无占位） | **20 / 0** |

**⑤ 残留。**

- 同一份 boot 门里还有 4 个固定端口的 stub（8793/8794/8795/8799），同类碰撞风险没逐个清；
  这一轮只把 M27 用的 8796 换成了空闲端口（§8.38）。
- 这是「门禁对环境残留没有自愈」的一个实例，不是产品缺陷；但它会让矩阵的红色失去意义，
  所以按缺陷对待。

## 8.40 「退出后还在 tick」：快照取早了 250ms（GP-176）

**① 症状。**

GP-174/175 之后的全量矩阵到了最后一段，`G-59 e2e_desktop_sweep_timer` 判 **5 / 1**：

```
✗ S-06 退出后不再产生新 tick — before=…01:02:27.375Z after=…01:02:27.625Z rows 6→7
```

两个时间戳正好差一个 250ms 周期（本门的时间尺度）。同一份代码此前多次 6/0。

**② 根因：快照在「发 quit」之前取，而不是「进程真的没了」之后。**

S-06 原来的顺序是：

```js
const beforeQuit = readJson(TICK);      // ① 先拍快照
void app.evaluate(({app:e}) => e.quit()); // ② 再请求退出（IPC 是异步的）
await waitForAppExit(proc, 15000);
```

①和②之间只要跨过一个 tick 周期，就会有一轮在 `quitRequested` 置上之前已经开跑，
它的写入被算成「退出后还在 tick」。矩阵里那次跨了整整一个 250ms 周期。
**这不是定时器没停，是尺子把「退出中」算成了「退出后」。**

**③ 复现（确定性）。**

把「快照 → quit 真正到达主进程」这段延迟人为放大到 400ms（矩阵里那次是 250ms），
旧逻辑立刻红，报错原文与矩阵一致：

```
✗ S-06 退出后不再产生新 tick — before=…41.831Z after=…42.333Z rows 6→8
```

**④ 修复：快照移到进程退出之后。**

进程已经没了，此后任何写入都只可能来自残留写手 —— 这才是这条断言想抓的东西。
`at_exit` / `rows_at_exit` 与 1.5s 后的值比较，失败信息也改成 `at_exit=…`。

**⑤ 红 → 绿（同一段人为延迟）。**

| 跑法 | 结果 |
| --- | --- |
| 旧逻辑 + 400ms 延迟 | **5 / 1**（S-06，`rows 6→8`） |
| 新逻辑 + 同样 400ms 延迟 | **6 / 0**（`rows=8`） |
| 新逻辑 + 正常时序 ×2 | **6 / 0**、**6 / 0** |

修复后的全量矩阵 **441 / 0**（无 `✗`；S-06 以 G-59 锚点身份在矩阵里绿），
`data/` 无脏文件，`prove_repo_integrity` 4/0、`prove_report_history_intact` 7/0。
上一轮 439/2 里的 S-06 由这次修复覆盖；同批的另一条红当时未留下可复现证据，
不按「已修」记账，再出现就按现场定位。

**⑥ 残留。**

- 这条断言修完后仍然能抓「主进程退出后还有写手」，但它抓不到「退出过程中定时器
  还在跑」—— 那本来就不是缺陷（`quitRequested` 之前的一轮属于正常收尾）。
- 同一个「先拍快照再触发异步动作」的模式在别的门里是否还有，没有全量排查；
  目前只修了 S-06 这一处有证据的。

---

## 8.41 boot 门里四个写死的 stub 端口（GP-177）

**① 症状（同一类，只是没赶上）。** `scripts/e2e_grok_desktop_boot.mjs` 里还有
四处 stub 端口写死：GP-14 用 8793、G19 用 8794、M28 用 8795、M29 用 8799。
stub 自己 `listen(port)`，端口被别人占着就 bind 失败、不打 `[stub-llm]`，
门的就绪等待 8s 超时，整段异常——产品代码一行没错，红却是真的。

这不是「理论上可能」：G-47 那次 5 红就是残留实例占着 18765 造成的；M27 已经
改成空闲端口，这四个是漏网的。

**② 复现（确定性）。** 起一个 500 回包的 HTTP 服务占住这四口（冒充旧 stub 残留），
再跑 boot 门：

```
✗ E2E GP-14 块异常 — stub boot timeout
✗ E2E GP-130/131 块异常 — m28 stub boot timeout
✗ E2E GP-143 real turns — {"returned":0,"total":2,"partial":true,
     "sections":[{"id":"agent-bit","ok":false,"err":"(occupied by stale stub 8799)"}, …]}
✗ E2E GP-146 reply cards — []
✗ E2E GP-146 report card — …模型或服务返回失败，未取得该成员的产出…
✗ E2E GP-93/94/95 块异常 — g19 stub boot timeout
e2e_grok_desktop_boot: PASS=99 FAIL=6   （exit=1）
```

注意 GP-143 的残留是真打到 500 上的：占位服务自己的命中计数停在 4，
说明这几段确实把回合发给了陌生进程，而不是单纯的 bind 冲突。

**③ 修复。** 四处改成 `await pickFreePort()`，和 M27 同一条路：每次运行挑空闲端口，
base_url 跟着走。改完门里不再有任何写死的 stub 端口。

**④ 红 → 绿（同一批占位进程不撤）。**

| 跑法 | 结果 |
| --- | --- |
| 四口被占 + 旧代码 | **99 / 6**（exit=1，六条红如上） |
| 四口被占 + 新代码 | **128 / 0**（exit=0；占位服务命中数仍停在 4，绿跑一次没碰旧端口） |

修复后的全量矩阵 **441 / 0**（exit=0，无 `✗`；G-16 仍是 128 项、`data/` 干净）。
端口被占时门不再假红，端口空着时项数一条没少。

**⑤ 残留。**

- 这是门禁的环境自愈，不是产品行为变化：用户不会因为 8793 被占而看到 bug。
- 「写死端口」这类问题只按门逐个清，没有做全仓库静态扫描（比如直接把
  `BITBOT_STUB_PORT: "87xx"` 列为 lint 规则）—— 现在四个门里已经没有固定端口，
  但新写的门仍可能再犯。

---

## 8.42 全量矩阵搬进 CI（GP-178）

**① 问题不是「有没有门」，是「门只在一个人机器上开」。** 441/0 这个数字此前
只有最后一个跑矩阵的人见过；别人把改动合进去之前，没有任何独立环境复核过。
本轮的几处偶发红（GP-174/175/176/177）全都只在「同一份代码、另一台机器/另一次
运行」里露头。

**② 加了什么。** `.github/workflows/desktop-parity.yml`：

- 触发：`workflow_dispatch`、push 到 `cursor/next-target-v1` / `main`、PR 到 `main`；
- `concurrency` 按 ref 取消旧跑（矩阵十几分钟，两条并行会抢 Xvfb 和端口）；
- 步骤：装 MoonBit → `moon check` + `moon build --target native` → `npm ci
  --prefix hosts/desktop` → 装 Xvfb → `xvfb-run -a bash scripts/smoke_grok_desktop_parity.sh`；
- 失败时打印 `✗` 行与日志尾部，无论成败都把矩阵日志上传成 artifact。

**③ 本地能证的（和 CI 互相不替代）。**

- YAML 能解析，10 个 step；
- workflow 里那条外层 `xvfb-run` 的调用形式和本机一致：拿 S-06 那道门按同一形式
  跑了一遍 **6/0**（门自己再包一层不会打架：DISPLAY 活着时它就不包）；
- 矩阵本体在本机 **441/0**（§8.41 复跑）。

**④ 第一次真跑（已观测，不是「应该会绿」）。**

推上 `a04adaf` 之后 Actions 自己跑了一次，用公开 API 轮询到的现场：

| 项 | 值 |
| --- | --- |
| run id | `40989489921`（event=push，head=`a04adaf`） |
| 结果 | **completed / success** |
| 步骤 1–8 | Checkout、Host info、Setup Node、Install MoonBit、**Build kernel (native)**、npm ci、Install Xvfb 全 success |
| 步骤 9 | **Run full parity matrix — success** |
| 步骤 10 | `Show red lines (if any)` — skipped（只有失败才跑，跳过本身说明它没红） |
| 步骤 11 | Upload matrix log — success |

矩阵脚本 `[ "$FAIL" -eq 0 ]` 才退 0，所以「步骤 9 success」等价于 runner 上
`FAIL=0` 且无 `✗`；同一条命令在本机是 441/0。两份环境、同一个数字。

**⑤ 仍然不能证的。**

- **具体 PASS 计数没读到**：job 日志的下载接口要仓库 admin 权限（403），
  我拿到的是步骤级结论，不是日志里的 `PASS=441`。若要看逐项清单，得有人
  在 Actions 页面下载 artifact `parity-matrix-log`。
- Android APK 段依赖 runner 的 SDK / gradle / JDK；缺任一件时
  `prove_android_build` 打 SKIP，矩阵按 skip 记（SKIP ≠ PASS）。这一段的实际
  状态在日志里，我读不到，所以**不声称 APK 在 CI 上真编译过**。
- macOS / Windows 的「装上、双击、能用」仍然没验；`desktop-macos.yml` 只打包。
- 这次成功只覆盖 `a04adaf` 这一个提交；回退或后续改动是否仍绿，要看它自己那次 run。

---

## 8.43 GP-112 红的时候，先说清「切没切过去」（GP-179）

**① 症状。** GP-112 偶发红，签名是「切到 Bot B 之后，30s 内没有出现该 Bot 的
recall 行」。上一轮（§8.38）只补了现场：新出现的 `recall-*.json` 的
prefix / bot_id / count，加主进程尾部。**原因没定位，也没写「已修」。**

**② 一个看起来对、被实验否掉的修法。** 阅读代码时最像原因的是：`openBot(id)`
会把「点一下 + 等 pill 变成目标 Bot」重试到 20s，失败返回 false，而三处调用
都没看返回值。直觉是「切成断言」：没落地就红。

做了注入实验再决定 —— 把 `openBot` 的落地判定改成「永不匹配」（pill 名字不可能
等于这个串），用**旧代码**跑整套门：

```
e2e_grok_desktop_boot: PASS=128 FAIL=0
```

点击本身把 Bot 切过去了，只是名字比对的判据没满足。**「pill 名字没对上」不等于
「没切过去」**，按它判红会造出假红。这个方案撤回。

**③ 现在的做法：不动判红条件，只改失败信息。** 三处 `openBot` 的返回值都存下来
（`switchA1` / `switchB` / `switchA2`），失败信息改成先写现场、再写原始 JSON：

```
✗ E2E GP-112 isolation — switch_landed=false pill=«Bit Bot»
  rows=[{"bot":"agent-bit","count":0}] got={"bot_id":"agent-bit",…
```

顺序不是随手排的：`bad()` 只保留 200 字，**现场必须写在被截断之前**。第一版把
JSON 放在前面，实测红行在 `"at` 处就断了，switch_landed 根本没出现 —— 等于白加。

**④ 负向对照（证明这段现场真的会打出来，不是死代码）。**

在副本里注入两处：`want` 改成永不匹配、`count === 0` 改成 `count === -1`，
强制走失败分支：

| 跑法 | 结果 |
| --- | --- |
| 注入副本（强制失败分支） | **127 / 1**，红行原文：`switch_landed=false pill=«Bit Bot» rows=[{"bot":"agent-bit","count":0}] got={"bot_id":"agent-bit",…}` |
| 未注入（同一份代码的正常路径） | **128 / 0**、**128 / 0**（本轮两次） |

**⑤ 残留（照实写）。**

- **GP-112 的偶发红当时没有消除**：那一轮没有拿到可复现的失败，所以只做到
  「下一次红能指认」。后面 §8.44 就抓到了那一次真红，并按 id 修掉了判定层。
  断言一个字没放松。
- 本轮没有系统处理「块内异常之后那台 App 没关」的问题。实测后果真实存在：把
  `openBot` 失败改成抛异常的那一版里，下一个块再 launch 时旧进程还占着
  `127.0.0.1:18765`，红从 1 条蔓延成 3 条（`page has been closed`）。产品没坏，
  是门的收尾不干净；要改就得逐个块改收尾，本轮没做。

---

## 8.44 那次 GP-112 真红：名字不是身份（GP-179 续 / GP-180）

**① 真红来了（不是构造的）。** §8.43 的现场改造之后第一次全量跑，GP-112 就红了：

```
✗ E2E GP-112 isolation — switch_landed=true pill=«Bit Bot»
  rows=[{"bot":"bot-cd3806","count":1}]
```

关键矛盾：**胶囊说切到了 B，实际回合跑在 A 上**（A 有这条记忆，count=1）。
断言没错，它抓的是真实串位。

**② 归因：判定用的是「名字」。** `openBot` 以前等 `#bot-pill .bot-pill-name`
的文字等于目标 Bot 的名字。可是名字不是身份：门禁数据里就有一串同名的
`SmokeRenamed`（几十个），用户也能把 Bot 改成重名。名字对上只能说明「标题看起来
对」，说明不了 `activeBotId` 是谁。这一次就是「pill 文字匹配、activeBotId 没变」。

**③ 修法（产品侧加一个可断言的事实，不改任何行为）。**
`updateBotPill(..., botId)` 在胶囊上写 `data-bot-id`，两个调用点都传真实 id
（默认主 Bot、点开 Bot）。门禁的 `openBot` 改成等 `pill.dataset.botId === id`，
名字只留在失败信息里。判定变严了：以前按名字能过、实际没切过去的情况，现在会
重试点击，20s 还不行就明确报 `switch_landed=false`。

**④ 顺手抓到的产品缺陷：点头像条根本没切换（GP-180）。**
侧栏默认折叠成头像条，chip 的点击回调写的是 `selectBotForChat(b.id)` —— 传的是
字符串，而函数读 `b.id / b.name`。结果 `activeBotId = undefined`、胶囊退回默认
文案、会话标题多出一条 `undefined · DM`。这不是门禁问题，是用户点一下就中。

**⑤ 红 → 绿。**

| 跑法 | 结果 |
| --- | --- |
| 新增 GP-180 断言、`index.html` 未修（传字符串） | **129 / 1**：`✗ GP-180 strip avatar bot-cd3806 — stale pill=agent-bit/«Bit Bot»`（点 agent-bit 那条「通过」是因为胶囊本来就在 agent-bit 上） |
| 同一份断言、改成传对象 | **130 / 0** |
| GP-112（id 判定 + 修好的切换） | 本轮跑绿；上面那次红之后再没出现 |

**⑥ 残留。**

- GP-112 的偶发红在新判定下没有再出现，但这只是修复后 1 次绿的样本，**不写成
  「已彻底消除」**；差别在于：下一次若还红，红行会直接给出 `switch_landed` 与
  胶囊上的 id，而不是只剩一个名字。
- 头像条只修了「点击传什么」；头像条本身没有键盘可达性（button 有了，但没有
  aria-label / focus 样式），这块属于无障碍打磨，未做。


---

## 8.45 「胶囊说的是 B，消息发给了 A」：重绘把标题拉回主 Bot（GP-179 收尾）

**① 按 id 判定之后，同一形态又红了一次。** 在 cc26876 上跑全量矩阵：

```
✗ G-16 E2E 冷启动+像素断言
✗ G-20 界面契约
  ✗ E2E GP-112 isolation — switch_landed=true pill=agent-bit/«Bit Bot»
    rows=[{"bot":"bot-cd3806","count":1}]
```

`switch_landed=true` 意味着**点击那一刻**胶囊上的 id 就是 B，但回合仍落在 A 上。
所以「按 id 判定」只解决了「假落地」，没有解决「胶囊先对、随后被改掉」。

**② 根因：Bot 列表每次重绘都把胶囊拉回主 Bot。** `refreshBotsNow()` 末尾原来写死：

```js
const primary = bots.find(x => x.id === (view && view.primary_id)) || bots[0];
if (primary) updateBotPill(primary.name, primary.id, primary.avatar_data_url);
```

侧栏会被 `bitbot:bots-changed` 广播频繁重绘。用户点开 A（胶囊 A、activeBotId=A），
任何一次重绘就把胶囊改成主 Bot B —— 之后门禁/bot 切换逻辑看到的「当前 Bot」
与真正接消息的 `activeBotId` 不再一致。这也是用户能看到的：跟 A 聊天时标题栏
写着 B。

**③ 修法。** 重绘时先看胶囊上已有的 `data-bot-id`：它在、且这个 Bot 还在列表里，
就继续显示它；只有「还没选过」或那个 Bot 已经没了，才回落到主 Bot。id 由新增的
`markPillBot(id)` 写在胶囊上（`updateBotPill` 签名保持三个参数，G-20 的静态契约
不动 —— 第一版加第四个参数直接让 G-20 翻红，见 ⑤）。

**④ 红 → 绿（同一台机器，同一份数据）。**

| 跑法 | 结果 |
| --- | --- |
| 全量矩阵（修前，cc26876） | **439 / 2**：G-16（内含 GP-112 isolation 那条）+ G-20（`updateBotPill` 签名多了一个参数） |
| 单跑 G-20 静态门 | 修前 `23 passed, 1 failed`（bot pill）→ 修后 **24 / 0** |
| 单跑 boot 门 | **130 / 0** |
| 全量矩阵（修后） | **441 / 0**（exit=0，无 `✗`，`data/` 干净） |

**⑤ 诚实边界。**

- 同一提交在 GitHub Actions 上也红过一次（run `40996522403`），但 job 日志要仓库
  admin 才能下载（403），**我没有读到那次 CI 的 `✗` 行**。上面两个红是本地在
  `cc26876` 上复现出来的，不冒充「CI 的失败原因已确认」。
- 胶囊现在只保证「点开谁就显示谁，重绘不再抢」，没有做「多窗口/多会话各自
  独立标题」；那是另一个形状的需求，没在本轮范围。

**⑥ 修完这一版在 CI 上也绿了。** 推上 `86134ea` 后 Actions 自动跑：

| 项 | 值 |
| --- | --- |
| run id | `41001215575`（head=`86134ea`） |
| 结果 | **completed / success** |
| 「Run full parity matrix」 | **success**（`Show red lines` skipped —— 只有失败才跑） |

同一条命令在本机是 **441/0**，与 §8.42 的第一次 CI 绿一致。上一版 `cc26876` 的
CI 失败（run `40996522403`）与本机复现到的 439/2 是同一形状：G-16 里的 GP-112
与 G-20 的静态签名。日志仍然只有 admin 能下，**逐项 `PASS=` 计数没有读到**。

## 8.46 红的是尺子：`set -u` 下的空数组，和不听开关的进程内唤醒（GP-181 / GP-182）

**① 一天之内三个红，没有一个是产品坏的。** 整合上游 14 个提交后跑全量矩阵：

```
scripts/smoke_grok_desktop_parity.sh: line 2534: gp170_xvfb[@]: unbound variable
✗ G-16 E2E 冷启动+像素断言（见 /tmp/e2e-g16.log）
✗ G-57 真 Box 取证未通过（见 /tmp/gp169-sweep.log；pass=0 fail=1）
```

第一条最贵：矩阵在 2534 行**直接断掉**，G-59 之后十几道门根本没跑（报的是
430/2，其实分母也不完整）。这一条连同「G-1/G-2 每跑一次往用户侧栏留一批
Smoke 夹具」一起在 `48ef31d` 里落了 —— 夹具现在按前缀自清（开跑前摘一次、
跑完摘一次、EXIT trap 兜底），实测把 25 个 Bot 里的 16 个门禁造的清掉。

**② 空数组这一类的形状。** macOS 自带 `/bin/bash` 是 3.2，`set -u` 下
`"${ARR[@]}"` 摊到空数组不是「摊成 0 个词」，而是报 unbound 并让整条命令不执行
（bash 4.4 才修）。命中的都是「按条件才 push 元素」的数组：

| 位置 | 什么时候是空的 | 后果 |
| --- | --- | --- |
| 矩阵 G-59 `gp170_xvfb` | macOS 没有 `xvfb-run` | 整轮矩阵从 2534 行断掉 |
| `scripts/pack-box.sh:59` `BUILD_FLAGS` | `--profile debug`（只有 release 才 `+=--release`） | 死在 `moon build` 之前，Box 打不出来 → G-57 真机取证 `0/1` |
| `prove_agent_context.sh` / `prove_kernel_binary.sh` / `prove_product_tools.sh` 的 `FLAGS` | 非 release profile | 同型，一旦 CI 换 profile 就连环假红 |
| `host_matrix_i_sweep.sh` 的 `EXTRA`、`host_xdotool_mock.sh` 的 `args` | 无附加参数 | 同型 |

**这类破损 `bash -n` 全绿**，§8.35 之后新增的完整性门（冲突标记 + `node --check`）
也全绿 —— 它们看的是「是不是一份源码」，不是「在这台机器的 shell 上跑不跑得动」。
Linux（CI）既有 `xvfb-run` 又是 bash 4+，所以这道坑只在 mac 上开。

**③ G-16 的红是另一个开关没关。** GP-170 把「唤醒源」从 bash daemon 搬进主进程后，
`BITBOT_ROUTINE_DAEMON_AUTOSTART=0` 只关得掉 shell daemon，管不住进程内那个
`DESKTOP_SWEEP_MS`（默认 60s，且 `startDesktopSweep()` 在 startup 就先扫一次）。
boot 门的 GP-108 断言是「点 Fire **之后**新增几份草稿」，启动那一下多落 3 份，
于是读出 `{"n":4,"d":{"routine_id":"desk-r",…}}` —— 数错了，不是草稿机制坏了。

**④ 修法。** shell 侧统一换成仓库里其余八道门已经在用的
`${ARR[@]+"${ARR[@]}"}`（`pack-desktop.sh` 那种「先 `${#ARR[@]}` 判长度」的写法也认可）。
门禁侧把唤醒开关收进唯一入口：`scripts/electron_env.mjs` 的 `electronLaunchEnv()`
在未显式指定时默认 `BITBOT_DESKTOP_SWEEP_MS=0`，测唤醒节律的两道门
（`e2e_desktop_sweep_timer.mjs`、`e2e_desktop_packaged.mjs`）本来就自己显式设值，
不受影响；boot 门另外把 `BITBOT_ROUTINE_DAEMON_AUTOSTART=0` 与新的 `…SWEEP_MS=0`
成对写明。产品侧「应用本身就是唤醒源」没有改 —— 装机的 App 仍然会在启动时扫一次。

**⑤ 补一把尺子（GP-181 的回归门）。** `scripts/prove_repo_integrity.mjs` 加两条：

- **I-04** 扫全部被跟踪 `.sh`（实测 56 个）。四个条件同时成立才算红：文件里有
  `set -u`、某数组出现过 `NAME=()`（含 `local/declare/typeset/export` 前缀）、
  该数组有裸展开（先把 `${ARR[@]+…}` 与 `${ARR[@]:-…}` 剥掉再判，所以惯用法的
  内层 `"${ARR[@]}"` 不会误报，同一行里另留一处裸展开照样抓）、且全文件找不到
  对该数组的 `${#ARR[@]}` 长度守卫。
- **I-05** 尺子自己的对照：9 份探针（裸 / 带引号 / 惯用法与裸展开混在同一行 /
  `local` 起空 必抓；纯注释引用、`+` 惯用法、长度守卫、无 `set -u`、非空字面量 不报），
  外加**行为对照** —— 用 `/bin/bash` 真跑一份 `set -u; FLAGS=(); printf '%s\n' "${FLAGS[@]}"`，
  在 3.2.57 上必须非 0 退出（实测 `rc=1`），惯用法那份必须 0；bash 4.4+ 上
  反过来要求两边都 0，版本号打在 ok 文案里，读的人知道走的是哪半边。
  违规探针自己也带一行同名注释，用来证明「注释豁免」只豁免那一行、不会整份放过。
- 矩阵 G-60 挂上真文件注入对照：把 `pack-box.sh:59` 的惯用法改回裸展开 →
  `✗ I-04 … scripts/pack-box.sh:59 BUILD_FLAGS`，恢复后 `fail=0`、`cmp` 一致。
  另一处手工实测（不落进矩阵）：把 `gp170_xvfb` 改回裸展开，尺子同样指到
  `scripts/smoke_grok_desktop_parity.sh:2568 gp170_xvfb`。

**⑥ 红 → 绿（同一台机器）。**

| 跑法 | 结果 |
| --- | --- |
| `node scripts/prove_box_routine_sweep.js`（修前） | **0 / 1**（pack-box 死在 `BUILD_FLAGS[@]: unbound variable`） |
| 同上（修后） | **18 / 0**，`bash scripts/pack-box.sh --out /tmp/boxprobe --profile debug` 打出 `[pack-box] done → /tmp/boxprobe` |
| `node scripts/e2e_grok_desktop_boot.mjs`（修前） | G-16 红：GP-108 `n=4` |
| 同上（修后） | **130 / 0**（GP-108 四条 + GP-109 两条都在） |
| `node scripts/prove_repo_integrity.mjs` | **7 / 0**（I-00…I-05，含 56 个脚本全扫） |
| 全量矩阵（修后） | **436 / 0**，exit=0，日志里无 `✗`；`· 收尾自清：夹具 Bot 2 条、夹具群 1 条`（最终树重跑 `/tmp/matrix-gp183b.log`；中途一次 436/**2** 是我把 §8.46 标题改字触发的 RH-06/07，见 ⑨ 倒数第二条） |

矩阵里对应那四条（`/tmp/matrix-final.log`，逐字）：

```
✓ G-16 E2E 冷启动+像素断言全绿（130 项，e2e_grok_desktop_boot: PASS=130 FAIL=0)
✓ G-57 真 Box 取证：打包→起进程→到点扫→手机拉待批→批准留痕→重复批准被拒（pass=18 fail=0）
✓ G-60 锚点：I-04 被跟踪的 .sh 没有 / I-05 空数组尺子对照 / I-05 行为对照
✓ G-60 注入对照（I-04）：把 BUILD_FLAGS 那条 + 惯用法改回裸展开就翻红、且指到 pack-box.sh 行号，恢复后仍绿
```

**⑦ 这一版在 CI（ubuntu runner）上也绿。** 推上 `59204d6` 后 Actions 自动跑同一份矩阵：

| 项 | 值 |
| --- | --- |
| run id | `41062832802`（head=`59204d6`，workflow `Desktop Parity Matrix`） |
| 结果 | **completed / success** |
| 矩阵计数（CI 日志里摘到的汇总行） | **`smoke_grok_desktop_parity: PASS=439 FAIL=0`**，无 `✗` |
| I-05 行为对照那半边 | 锚点在 CI 上同样绿：`✓ G-60 锚点：I-05 行为对照` —— runner 的 bash 是 5.x，走的是「4.4+ 要求两边都 0」那条分支，本机 3.2.57 走「裸展开必须 rc=1」那条，两平台各证一次 |

这次的 CI 日志用 `gh run view --log` 读得到（本仓的 run，与 §8.45 里那个需要
admin 的外部 run 不同），所以下面的 `·` 行是逐字摘录，不是推断。

**⑧ GP-183：把两份日志逐条对差，抓到一条 CI 层的断点（与 §8.31 的 AE 门同型）。**
本机 436 与 CI 439 差的不是「几条小项」，而是**两整块**：

| 块 | 本机（mac） | CI（ubuntu） | 逐字的 skip 行 |
| --- | --- | --- | --- |
| G-47 APK 真编译 | **skip** | 跑（16 项全绿） | `· skip：prove_android_build: SKIP — 没装 Android SDK（ANDROID_HOME / local.properties sdk.dir 都没有）（SKIP ≠ PASS）` |
| G-58 常驻内核（T1-07） | 跑（11 项全绿） | **skip** | `· skip：没有 release 内核二进制（_build/native/release/build/cmd/desktop_turn/desktop_turn.exe），G-58 未跑（SKIP ≠ PASS）` |

也就是说：**T1-07 那条常驻内核契约（KR-01..KR-10）在 CI 上从来没跑过。**
workflow 里那步 `moon build --target native` 出的是 **debug** profile 的产物，
而 G-58 只认 `_build/native/release/…`，于是两边各自绿着、合起来才是全覆盖 ——
单看任何一份日志都会以为另一块也跑了。门禁本身是诚实的（`SKIP ≠ PASS` 写在文案里），
断的是**覆盖面**，不是判定。补法就是那两条命令（`moon build --target native --release`
产 release 产物，紧跟一条 `ls _build/native/release/build/cmd/desktop_turn/desktop_turn*`
当存在性断言）—— 产物不在就当场红，而不是让矩阵记一句 `·` 之后整体绿。

**GP-183 的 CI 半边已自证（推上 `6e93e6b` 后自动跑的那轮）。**

| 项 | 值 |
| --- | --- |
| run id | `41069037431`（head=`6e93e6b`，workflow `Desktop Parity Matrix`） |
| 结果 | **completed / success**，`Run full parity matrix` 步骤 ✓，日志里 `✗` 计数 **0** |
| 矩阵计数 | **`smoke_grok_desktop_parity: PASS=445 FAIL=0`** |
| 与 ⑦ 那轮 439 的差 | 正好 **6 条** —— G-58 跑起来时走的是 2511/2517/2520/2524/2527/2531 这六个 `ok`，skip 分支只打一行 `·`（不计入）。439 + 6 = 445，差值能被门代码解释，不是我挑出来的数 |
| 本机侧 | 同一份矩阵在 mac 上是 **436 / 0**（那边 G-47 的 APK 块仍是 skip），两平台合起来才是全绿 |

G-58 那一段在 CI 日志里的逐字（`gh run download --name parity-matrix-log` 取到的
`parity-matrix.log`，不是 `gh run view` 的步骤摘要）：

```
== G-58 常驻内核进程（T1-07 · 一行请求换一回合，替代每轮 spawn）==
  ✓ G-58 常驻内核契约全绿（11 项，pass=11 fail=0）
  ✓ G-58 反向对照 + 语义不变都在：关常驻 6 次 spawn，常驻侧 Host 侧 spawn=0；同一批 argv 两条路结果逐条相同
  ✓ G-58 旧内核兼容锚点在：不认 --serve 的二进制被如实判成 not_serving，不是 crashed，也不挂死
```

原来那行 `· skip：没有 release 内核二进制…G-58 未跑（SKIP ≠ PASS）` 在这一轮里
**已经不在日志里了**（全文 `grep -n "G-58 未跑"` 无命中），换成了上面的 11 项全绿。

**⑨ 诚实边界。**

- I-04 是**文本规则**，不是 shell 解析器：靠 `eval` 拼出来的命令名、`printf -v`
  间接起的数组、以及把 `=()` 写进注释/字符串又恰好同名的展开，都看不见。它只保证
  「这四种真炸过的形状」不再复发，不保证 shell 端口性无债。
- 整行注释被豁免（门禁的注释天天引用 `"${ARR[@]}"` 讲这个坑），行中出现 `#` 的
  不豁免；所以「注释里写了解释、代码里仍然裸用」这一行照样会被抓 —— I-05 的
  违规探针就故意长这样。
- `${#ARR[@]} -gt 0` 这条豁免是**文件级**的，不是控制流级的：同一个数组若既在守卫
  分支里裸用、又在守卫外裸用，本规则会放过。选它是因为 `pack-desktop.sh` 已是这种
  写法，宁可少报也不把存量全改一遍；新增的门禁请直接用 `+` 惯用法。
- G-16 修的是**门禁环境**。GP-170「App 自己是唤醒源」这个产品行为没动，装机版启动
  仍会扫一次；如果哪天需求变成「启动扫描也要出现在草稿计数里」，这把尺子得跟着改。
- 本轮自己踩了一次 RH-06/07：把 §8.46 的**标题**改字（想把 GP-183 也写进标题）后，
  这两条立刻翻红 —— 它们拿 HEAD 的标题逐字比，「改标题」和「段落被吃掉」在这把尺子
  里同形。已还原标题、GP-183 只在正文里标；代价是**已提交段落的标题从此不能改字**，
  要改就得连门一起改。这一条是记录，不是绕过它的理由。
- ⑦/⑧ 的 CI 数字来自 `gh run view --log`（本仓 run 可读）。矩阵跑动期间工作区里
  短暂出现过 `docs/next-target-requirements.md`、`parity-gaps-next.md` 的 `M` 状态、
  几秒后又与 HEAD 一致 —— 我没有复现出是谁写的（两份内容现在都和 HEAD 相同，
  没有丢段落）。写下以免下次再看到时被当成我改的。

## 8.47 双写旁路上线：一条 require 打死整个桌面端，和 Box 里那块没拷进去的文件（GP-184）

**① 起点是上一节自己写下的那句「残留」。** G-61 的诚实行说「T1-04 读切换、T1-06 单写者
还没接上」，而它前面那格（`docs/next-target-requirements.md:259`）是 T1-03：

```
| T1-03 | 双写旁路：现有写入点同时写 events（不改行为） | T1-02 | 1d | `fold(events)` 与 JSON 快照逐字段相等（sessions/rooms/approvals） |
```

于是这一轮做的是**旁路本身**：`hosts/shared/event_mirror.js`（镜像 + `foldEvents`）挂进
三个收敛点（`sessions.js:65-70` 的 `writeStore`、`product_surface.js:49-57` 的 `atomicWrite`、
`product_surface.js:68-74` 的 `appendJsonl`），词表写进 `docs/events.md` §5.4（新增 8 个 kind、
复用 4 个），门是 `scripts/prove_event_dual_write.mjs`。**本机门 28 项全绿之后我跑了全量矩阵。**

**② 矩阵从 G-16 起一起翻红：318 绿 / 25 红。** 逐字（`/tmp/matrix-t103.log`，我在 G-46 中段掐掉的）：

```
  ✗ G-16 E2E 冷启动+像素断言（见 /tmp/e2e-g16.log）
  ✗ E2E 冷启动 — electron.launch: Target page, context or browser has been closed
  ✗ G-46 e2e_desktop_quit（见 /tmp/g46-quit.log；e2e_desktop_quit: PASS=0 FAIL=1 SKIP=0）
✗ fatal — electronApplication.firstWindow: Timeout 30000ms exceeded while waiting for event "window"
    at /Users/zfl/Downloads/bitbot/scripts/e2e_desktop_quit.mjs:129:25
```

红的 7 个块（G-16 / G-24 / G-25 / G-26 / G-27 / G-28 / G-46）**全是会启动 Electron 的门**，
G-47 之后还有四处也启动 Electron（矩阵的第 2117 / 2149 / 2257 / 2628 行），它们只是没跑到。

**③ 根因是一条 require 链，而开关是关着的。**

| 位置 | 干了什么 |
| --- | --- |
| `hosts/desktop/sessions.js:11`、`product_surface.js:13` | 顶层 `require("../shared/event_mirror")`（每个 host 进程加载时执行） |
| `hosts/shared/event_mirror.js`（原第 26 行） | 顶层 `require("./event_log")` |
| `hosts/shared/event_log.js:22-33` | 顶层 `require("node:sqlite")`，失败就 `throw new Error("event_log 需要内置 SQLite…")` —— **加载即抛** |

Electron 里那颗 Node 没有这个内置模块，实测：

```
node 20.18.3
sqlite MISSING
```

（`electron` 33.4.11，`hosts/desktop/package.json:121` 钉的是 `^33.2.0`。）
也就是说：**`BITBOT_EVENT_DUAL_WRITE` 还没被读到，主进程已经在 require 阶段死了。**
「默认关就不改行为」这条设计在语义上守住了，在**加载路径**上完全没守住。

**④ 为什么 28 项门的绿是假的（对我的问题而言）。** `prove_event_dual_write.mjs` 跑在宿主
Node v22.23.1 上，G-62 整块的 skip 条件也是 `node -e "require('node:sqlite')"` —— 它问的是
**门禁自己的运行时**，不是**产品的运行时**。这两件事此前从没在同一道门上对齐过，
所以本轮之前没人说过「产品在 Electron 里跑」。补上的正是这一格（DW-10，见 ⑥）。

**⑤ 修法分两层，都不动产品行为。**

- `event_mirror.js` 把库依赖压到真要开库的那一刻（`openEventLogLazy`，
  `hosts/shared/event_mirror.js:29-35`），失败由 `handle()` 的 try/catch 咽下并降级；
- `getSharedMirror()` 先探一次可用性（`isAvailable()`），运行时撑不起来就返回一个
  **接口相同、一个字都不写**的替身（`createDisabledMirror`，同文件 `:706-733`）：
  开关关着完全静默，开着打印一行「已降级为不写」。入口只有 `getSharedMirror` 一处，
  两个 host 文件里各只有一行 `mirror()` 调用，没有第二份判断。

真 Electron 里的实测（不是设计意图）：

```
available false | enabled false | stub true | capture null | commit false | eventsDir false
[event-mirror] 已降级为不写：当前运行时没有内置 SQLite（node:sqlite，Node v20.18.3），而双写开关是开着的…
```

`node scripts/e2e_desktop_quit.mjs` 从 `PASS=0 FAIL=1` 回到 **8 / 0**。

**⑥ 但这不等于能上线：矩阵继续跑到 G-57，真 Box 取证翻红。** `pass=8 fail=3`，逐字：

```
FAIL SW-6 手机拉得到待批项 503 {"ok":false,"error":"approval_queue_unavailable"}
FAIL SW-6 清单里有那一条 {"ok":false,"error":"approval_queue_unavailable"}
prove_box_routine_sweep crashed — TypeError: Cannot read properties of undefined (reading 'every')
    at main (/Users/zfl/Downloads/bitbot/scripts/prove_box_routine_sweep.js:284:38)
```

三层各有一个洞，缺一不可见血：

| 洞 | 事实 | 后果 |
| --- | --- | --- |
| 清单级 | `scripts/pack-box.sh:81` 那张手写 `shared/` 允许清单里没有 `event_mirror.js` | 包里少一个文件 |
| **布局级** | Box 的包是**平铺**的（`hosts/desktop/product_surface.js` → `<包>/product_surface.js`），那句 `require("../shared/event_mirror")` 在包里指向 `<包>/../shared/…`，**在包外面** | 就算拷了文件也照样 MODULE_NOT_FOUND |
| 说话级 | `hosts/shared/product_surface_ref.js` 原来是 `catch (_) { _cached = null; }` | surface 没起来，日志一个字没有，症状只剩 503 |

修法：新增 `hosts/desktop/event_mirror_ref.js`（两条候选：`../shared/event_mirror` →
`./shared/event_mirror`，与 `hosts/shared/host_ffi.js:26-30`、`product_surface_ref.js:23-33` 同一个手法），
两个 host 文件都改走它；`pack-box.sh` 补 `event_mirror.js` 进 `shared/`、补
`event_mirror_ref.js` 进包根清单；`product_surface_ref.js` 把咽掉的错误写成一行 stderr。

**⑦ 给这三层各补一把尺子，并且都做了注入对照。**

- `scripts/check_box_requires.js`（新）：扫**打出来的包**，把每个 `.js` 的相对 require
  按 basename 聚成簇，判「簇内至少一条候选指得到文件」——只要求每条都指得到会误报
  try-chain（实测 10 条里 9 条是合法候选），所以按簇判。`pack-box.sh` 收尾调用它，
  红就 abort 打包。
- `prove_box_pack_closure.js` 的 walker 从「只认 `./x`」升级成认 `../shared/x`、
  `../desktop/x`、`../../hosts/…`、平铺的 `../x` 与 `./shared/x`（try-chain 的多条拼法
  归一到同一个 `(kind,name)`，靠 `seen` 去重，所以不会把「三选一」误当成「三都得在」）。
  加 P-05（尺子自己的视力：必须有来自 `../…` 的边走通）和 P-06（GP-184 三个名字各在其位）。

| 注入对照 | 实测 |
| --- | --- |
| 把顶层 `require("./event_log")` 塞回 `event_mirror.js` | `FAIL DW-10a — 开关关着、运行时没有 node:sqlite，主进程链却起不来：event_log 需要内置 SQLite（node:sqlite）…` + `FAIL DW-10b` → `PASS=29 FAIL=2`，恢复后 **31 / 0** |
| 从 `pack-box.sh` 清单里摘掉 `event_mirror.js` | `✗ P-01 … 缺：shared/event_mirror.js`、`✗ P-06 …` → `pass=5 fail=2` |
| 把 `REQUIRES` 退回只看 `./x`（老视力） | `✓ P-01`（**照样绿**）、`✗ P-05 …（来自 \`../…\` 的 0 条）` → 这条正是 ⑥ 那天「闭包尺子绿着、包却是坏的」的形状 |
| 在打好的包里删 `shared/event_mirror.js` | `[pack-box] 1 个 require 簇在包内指不到文件：event_mirror_ref.js → event_mirror（试了 ../shared/event_mirror / ../shared/event_mirror / ./shared/event_mirror）` |
| 在打好的包里把 `event_mirror_ref` 换回裸 `../shared/event_mirror` | `· product_surface.js → event_mirror（试了 ../shared/event_mirror，包内都指不到）` rc=1 —— 布局级破损单独可抓 |

`prove_box_routine_sweep.js` 现在还会点名打印打包那步的自检行，G-57 块加了对应锚
（缺这一行 = 尺子没跑，不算绿）。

**⑧ 回到 T1-03 本体：棘轮抓到的四个真 bug。** DW-02 那条「每步写入后 fold 必须等于快照」
不是摆设，每一条都是先红过一次才知道的：

| 现象 | 机制 | 落点 |
| --- | --- | --- |
| 激活 A→B→A 只落一行 | 镜像曾按 payload 内容哈希发 `idem_key`，第二次、第三次 A→A 的转换被当成重复吞掉，`fold` 折回来的 `active_id` 停在旧值 | 决定改成**镜像不发 `idem_key`**（§5.4 规则 3），幂等落在 diff 上；DW-05b/c 双向钉住 |
| 一次 no-op 重写被报成「有行被改写」 | `diffList` 无 id 分支里 `tail === nh.length` 那条 problem 只在两份完全相同的列表上触发（`deleteBot` 级联会无条件 `saveRooms`） | 删掉那条分支，新增 `describeIdlessMismatch`（`event_mirror.js:189-199`）把「对不上在哪」说清楚；DW-03d 从红转绿 |
| 一批事件静默消失 | `entity_activated` 曾把 `active_id`（删到空时是 `""`）当 `session_id` 送进适配器，被「需要 sessionId」拒收，异常咽下后**同批剩下的事件一起丢** | store 级事件一律用保留 id `"system"`（`event_mirror.js:335,339`），DW-09b 专门造这个形状 |
| 顶层字段少了却不报错 | `changedScalars` 只看 `next` 的键，`removed` 那半边没人记，fold 把旧值留在原地 | `store_state_changed` 带 `removed[]`（`event_mirror.js:324-326,337-340`），DW-09 一冒一消都断言 |

**⑨ 两条「假覆盖」也是同一把尺子逼出来的。** `rooms.roomLibraryAdd` 那一步原本传的参数
根本写不进快照（`added:0`），清单上多算一步、DW-02 少考一步 → 新增 **DW-03e**：清单里每一步
都必须真的改到快照，空步直接红。`DW-04` 原来只比最终态，于是「一个后来被删掉的会话」
的当年事件对最终态毫无贡献，被误判成三个死词 → 改成**逐类真删 + 对全部 20 步按 seq 前缀
整轮重放**（DW-04z），库里 11 类每类都能指到「第几步跟不上」。

**⑩ 数字。**

| 项 | 值 |
| --- | --- |
| `prove_event_dual_write.mjs` | 28 → **31 / 0**（DW-10a/b/z 三条是本轮加的） |
| `prove_box_pack_closure.js` | 5 → **7 / 0**（P-05 视力 / P-06 名字；跨目录边实测 17 条） |
| `prove_box_routine_sweep.js` | `pass=8 fail=3` → **18 / 0** |
| G-57 块 | 8 项 → **10 项**（P-05 / P-06 / 打包 require 自检三个锚） |
| G-62 块 | **PASS=31 / 0**，263 条事件、11 类 kind 逐个承重（矩阵逐字行见 `/tmp/matrix-t103c.log`） |
| `e2e_desktop_quit.mjs` | `PASS=0 FAIL=1` → **8 / 0** |
| 全量矩阵（本机 mac） | 中断那轮 318/**25** → 修 Electron 后 442/**1**（只剩 G-57）→ 修 Box 后 **446 / 0** |

**⑪ 诚实边界。**

- **DW-10 是伪装，不是真机**：它用 `Module._load` 把 `node:sqlite` 拦成 MODULE_NOT_FOUND，
  跑在宿主 Node 22 上。真老运行时的开机证明在 G-16 / G-46 / G-59 那几道 Electron 门里，
  两边缺一不可 —— ④ 说的正是只有前者会绿、只有后者会红的错配。
  伪装生效由 DW-10z 自己断言（同一份 hook 下直接 `require("event_log")` 必须抛）。
- **今天装机版跑不起双写**：产物里是 Electron 33（Node 20.18.3），没有 `node:sqlite`。
  开关在装机版里开着也只会走 ⑤ 那行「已降级为不写」。要它真写库，得先让宿主运行时升到
  内置 SQLite 的版本（`hosts/desktop/package.json:121` 现在钉 `^33.2.0`），或者换一个后端。
  本轮刻意不为此改打包策略。
- **可用性探测只看 `node:sqlite` 在不在**：如果哪天 `event_log` 因为**别的原因**加载即抛，
  这条探测会一并判成「撑不起来」→ 静默降级（开关开着还有一行说明）。目前可接受，
  但 T1-04 把读路径接上去之前要重新看这个口径。
- **替身只装在 `getSharedMirror()` 这一个入口**：门里的夹具直接调 `createMirror()`，
  在老运行时仍会走到 `handle()` 的「开库失败」那条。这是显式请求，刻意不改成替身。
- `check_box_requires.js` 只判 require 簇，不判动态 `require(变量)`、不判 `import()`；
  闭包尺子（P-01）的入口是写死的三个（`box_main.js` / `host_ffi.js` / `product_surface.js`），
  入口选漏了照样看不见。两条都只覆盖 Box；桌面安装包（G-59）是整棵 `hosts/` 进 asar，
  没有这张清单，因此也没有这类漂移。
- **双写 ≠ 上线**：T1-03 证明的是「日志记得下今天的 JSON」，不证明产品已改读它（T1-04）、
  不再写 JSON（T1-05）、或同会话单写者（T1-06）；`approvals.log.jsonl` 与
  bots/settings/routines 不在这三张面里（`docs/events.md` §7）。
- 本轮把 `product_surface_ref.js` 的静默 catch 改成一行 stderr：它让 ⑥ 从「只有 503」
  变成「有 MODULE_NOT_FOUND 的名字」。这条改动没有被哪道门断言（只作为可读性），
  如果哪天有人把它改回 `catch (_)`，G-57 仍然会红，但要重新靠 503 猜一次。

## 8.48 同一件事写三遍：多端通用逻辑收口（GP-185）

Desktop、CLI Host、iOS/Android 壳、`mobile_host` 用的是同一颗 MoonBit 大脑和同一套
Host FFI。但 Host 侧还有三件事各写一份：

1. **`.env.local` 解析**：桌面主进程 `parseEnvFile` / `loadEnvLocalFiles`、`mobile_host`
   的 `loadEnvLocalFiles`、入站 onTurn 的 `loadEnvLocal` —— 三份，切分/引号/注释相同，
   差别只在「跳过哪些键、打不打日志」。任一端学会 `export KEY=…` 或行尾注释时，另外两端
   不会跟着变。
2. **42 个 `*_residual` 词表**：`mobile_host/run.js` 的镜像里手写一遍，
   `send_to_user_surface.js` 的 chip 里又手写一遍（集合相同、顺序不同）。漂移的表现是
   手机侧说「已投递」而桌面侧说「仍有残差」，单端门禁看不见。
3. **机器 id 默认值**：`machine_identity.DEFAULTS` 一份，入站 `seedMachineId` 又写死
   `phone-ios` / `phone-android`，`agent_loop_product_wire` 还写死一个 `desk-1`。

改法（不改任何 store / IPC / 内核 JSON 契约）：

- 新增 `hosts/shared/host_env.js`：只做纯解析 + 可配置装载（`skip` / `overwrite` /
  `onFile` / `onError`）。桌面、`mobile_host`、入站都改为调用；各端的密钥策略仍留在各端
  （SK-D7 / `BITBOT_NO_SECRET_SYNC` 一行未动）。
- 新增 `hosts/shared/delivery_mirror.js`：`DELIVERY_HOST_KINDS`（98 项）+
  `RESIDUAL_KEYS`（42 项）+ `collectResidualFlags` + `pickMirrorPath` +
  `buildDeliveryMirror`。镜像字段顺序与旧落盘文件逐字一致；`send_to_user_surface`
  只从它取词表，chip 的嵌套规则仍是展示层自己的事。
- `seedMachineId()` 改为 `DEFAULTS[normalizeKind(kind)]`；`agent_loop_product_wire`
  的默认上下文槽位改用 `DEFAULTS.desktop`。三处字面量只剩 `machine_identity.js` 一份。
- `scripts/pack-box.sh` 的 shared 清单补 `host_env.js` —— 入站 onTurn 在 Box 里 require
  它，漏拷的后果和 GP-184 那次「一条 require 打死整个桌面端」同型。

尺子 `scripts/prove_multihost_common.mjs`（MC-00..MC-08，矩阵 G-63）：

- **改前红**：`pass=3 fail=5`。MC-00 指出 mobile 没接 `delivery_mirror`；MC-01 列出
  三份 `.env` 解析；MC-02 列出两份残差词表；MC-03 指出 mobile 内联 98 项 kind；
  MC-04 列出 `agent_loop_product_wire` / 入站 / `machine_identity` 三处字面量。
- **改后绿**：`pass=9 fail=0`。
- **注入对照**：把一份 `.env` 解析塞回 `mobile_host/run.js` → MC-01 翻红并指名该文件；
  把 `phone-android` 写回 `seedMachineId` → MC-04 翻红并指名入站文件；恢复后 `cmp`
  核对仍绿。两条都在 G-63 里每轮重跑。
- **MC-08 行为等价**：`.env` 的注释 / 引号 / 空值 / 坏行 / 值里带 `=`；装载的
  「默认不覆盖 / overwrite / skip」；镜像 58 个字段的名称、值与顺序；SendToUser chip
  与镜像同源 —— 都用 fixture 钉住，不靠「看起来一样」。
- **真链**：`node hosts/cli_host/run_turn.js --machine-kind ios "ListMachines"` 与
  `node hosts/mobile_host/run.js --machine-kind ios …` 都返回 200/ok，手机侧落出
  58 字段镜像（`data/device/mobile-delivery-mirrors/machines_list-*.json`）。
- **全量矩阵**：`xvfb-run -a bash scripts/smoke_grok_desktop_parity.sh` →
  **PASS=467 FAIL=0**（G-63 的 9 个锚点 + 2 条注入对照全绿）。

诚实边界：

- 共享的是**词表与布尔收集**，不是像素。SendToUser chip、iOS/Android 的
  `SendToUserSurface`、桌面 `index.html` 仍各自决定怎么展示；这些是展示层，不强行合并。
- Android / iOS 仍是薄壳，本轮没有真机样本；`pack-mobile.sh` 只暂存 shell 树。
- `pack-box.sh` 的 shared 清单仍是人工维护。但「该打忘打」并非只能靠人看：
  从**真入口**算 require 闭包的 `scripts/prove_box_pack_closure.js` P-01 能抓住
  （GP-186 复核：从清单删掉 `host_env.js` → `✗ P-01 … 缺：shared/host_env.js`，
  恢复后 7/0）。`check_box_requires.js` 是打包后自检的另一把尺子，只查「已经打进去的
  require 指不指得到」，不负责清单完整性；两者职责不同，不能互相替代。
  （原文「P-01 也发现不了」是过度表述，GP-186 实测更正。）



## 8.49 把残留真正关上：原生壳指令矩阵、旧 smoke 回矩阵、打包闭包更正（GP-186）

GP-185 诚实留了四条：展示层各写、原生壳薄且无真机样本、`pack-box.sh` 清单人工维护、
旧 `smoke_desktop_turn.sh` 不在矩阵。这一轮逐条处理；过程中又抓出三处「门禁自己过期」
的假红（HEAD 上就红，不是本轮改坏），一并修正并留下红→绿证据。

### 8.49.1 原生壳的 42 个残差键与 canonical 同序（MC-09）

iOS `SendToUserSurface.swift` 与 Android `SendToUserSurface.kt` 的 `residualSuffix`
词表此前是「集合一样、顺序不同」。顺序不同就会让镜像/展示按不同次序裁切，
单端门禁看不出来。现在两份都按 `hosts/shared/delivery_mirror.js` 的 `RESIDUAL_KEYS`
逐项同序排列（各 42 项），并由 `prove_multihost_common.mjs` 新增的 **MC-09** 钉住：
先定位 `residualSuffix`，再解析其后的 keys 块，与 canonical 做有序全等比较；
失败信息能指出「第 N 项起不同」或「共同前缀之外缺哪项」。

- 改前：MC-09 不存在（词表顺序无人管）。
- 改后：`prove_multihost_common: pass=10 fail=0`。
- 注入对照（G-63 每轮重跑）：从 iOS 壳删掉 `"signin_fill_residual",` → MC-09 翻红并
  指名 iOS；恢复后 `cmp` 核对仍绿。

### 8.49.2 原生壳从「薄壳」到有完整指令矩阵（154 条模板）

`scripts/verify_native_shells.sh` 在 HEAD 上本身就是红的，根因不是本轮改动：

1. `7789966` 重写 Grok 风格聊天壳时删掉了 ContentView / MainActivity 里的
   quick-action 矩阵，但 gate 的 163 条 needle 一直留着；
2. GP-185 把 `mobile_host` 里的 Host kind 字面量与 `receipt_path` / `skill_path`
   选择逻辑收进 `hosts/shared/delivery_mirror.js`，gate 仍去 `mobile_host/run.js` 找；
3. `list models` 的真实 Host 路径已经是 `llm_list_models`（真列提供方），gate 只认
   `settings_open`。

处理（都不是把门放宽）：

- 两个壳各新增 **154 条 `commandTemplates`**，词表与桌面快捷指令同源。点一条只
  **填入输入框**，不直接发送——`room `、`cold mail to=`、`todo write ` 这类模板还缺
  参数，直接发会变成半句话；注释写明这一点。iOS 在「能力」里加「全部指令模板」入口，
  Android 在 `CapabilitiesSheet` 里加同一段模板列表，点击即填回草稿并落盘。
- gate 的 mobile_host 部分改为断言**唯一事实源** `delivery_mirror.js + host_ffi.js`，
  同时要求 `mobile_host` 仍 wire `DELIVERY_HOST_KINDS` / `buildDeliveryMirror` /
  `pickMirrorPath`（防止「有源没接线」）。
- `list models` 改为两路都认：`llm_list_models` 必须 ok 且输出 `LLM providers`，
  `settings_open` 必须不 pretend 且 anchor 含 models。

证据：`bash scripts/verify_native_shells.sh` → `OK`（163 条 needle 全过）；
Android `:app:testUniversalDebugUnitTest` **126 tests / 0 failures**（其中
`SendToUserSurfaceTest` 7/0）。iOS 仍无 Xcode/真机，模板 UI 只在源码与 gate 层验证，
这一条按残留记，不冒充「真机点过」。

### 8.49.3 旧 smoke 回矩阵（G-64）

`smoke_desktop_turn.sh` 是产品路径最全的老脚本，但长期不在矩阵里。本轮的修法不是
「让它少跑」，而是把它跑通：

- **模型**：沙箱没有真 provider，第一条入站 turn 就红。脚本顶部起仓库自带的
  `scripts/dev_stubs/openai_compat_stub.js`，只替模型应答；`run_turn → Host FFI →
  llm_chat HTTP → deliver` 仍是真链。
- **root 容器 Chrome**：显式 `BITBOT_CU_CHROME_NO_SANDBOX=1` /
  `BITBOT_OAUTH_CHROME_NO_SANDBOX=1` 才加 `--no-sandbox`，默认安全姿态不变。
- **媒体 / OCR / 语音**：CI 安装 `ffmpeg espeak-ng tesseract-ocr xdotool wmctrl`；
  本机缺工具时保留显式 `SKIP:` 并只断言 Host 如实记 residual，不假 PASS。
- **mic**：`/dev/snd` 只有 seq/timer 时先试真 ALSA，失败后回退
  `data/device/mic.wav` fixture，mode=`host_device_mic_fixture`；仍失败才 residual。
- **产品 bug（code_changes 路径）**：kernel 输出的是 box 虚拟路径
  `/workspace/README.mbt.md`，Host 用 `path.isAbsolute` 直接当宿主绝对路径
  → `exists=false`、`applied=false`，`code_apply_residual` 永远关不上。现在
  `/workspace/`、`/home/box/` 前缀统一映射到 `REPO_ROOT`，其余绝对路径仍按原样
  且拒绝出仓。红证据：`target=/workspace/README.mbt.md, applied=false`；绿证据：
  apply / commit mock / push mock 三段全过（commit_sha 来自 mock，不伪造）。
- **gh 未登录**：live PR view/dry-run 不可达时走诚实分支（`remote_pr_residual=True`、
  `mode=gh_pr_create_failed`、打印 `SKIP:`），gated mock 的 dry-run / real create 照跑。
- **过期断言**：travel 只存在 `pretend_purchased`，`pretend_booked` 是旧字段名；
  改为两者都不得为真。另把 G-53 的 qwen 回执从「stub 收到请求后立刻读 DOM」改为
  有界等待文本出现——原写法在负载下会先读到上一条气泡（实测 FAIL=1，重跑即绿；
  改后 `PASS=71 FAIL=0`）。
- **矩阵**：新增 **G-64**，跑完旧脚本并校验四条锚点（webhook 入站、Electron 回合、
  payment_wall fixture、live charge），`SKIP:` 逐行打印。

证据：完整 legacy smoke 日志 915 行，0 处 `Traceback` / `AssertionError`，
2 条显式 SKIP（headless 无 WM 的 native OS act、gh 未登录）；全量矩阵
`smoke_grok_desktop_parity: PASS=474 FAIL=0`（G-63 含 MC-09 锚点，G-64 在矩阵内）。

### 8.49.4 `pack-box.sh` 闭包：P-01 能抓「该打忘打」

GP-185 的原文说「`check_box_requires.js` 查不出该打忘打」是过度表述。实测：
从清单里删掉 `host_env.js`，`prove_box_pack_closure.js` P-01 立刻报
`✗ P-01 … 缺：shared/host_env.js`；恢复后 **7/0**。P-01 从**真入口**算 require
闭包，能抓漏拷；`check_box_requires.js` 是打包后自检的另一把尺子，只查「已经打进去的
require 指不指得到」。两者职责不同，不能互相替代，也不能拿后者去否定前者。
（§8.48 末条已按此更正。）

### 8.49.5 诚实残留（本轮没关掉的）

- **真机样本**：Android 有 JVM/Robolectric 126/0，iOS 连编译器都没有；两个壳的
  模板 UI 没有在真机上点过。`pack-mobile.sh` 仍只暂存 shell 树。
- **native OS act**：本机 headless、无窗口管理器，`xdotool` 能装但枚举不到真实窗口；
  G-64 只断言 `os_window_automation_residual=true` 并打印 SKIP。
- **gh 未登录**：remote PR 的 live view 不可达，只有 mock 的 gated create 证据。
- **`pack-box.sh` 清单**：仍人工维护；P-01 能在打包前抓住漏拷，但不会自动生成清单。
- **文档事故（已恢复）**：本轮早期一次工具回写把 report/parity 文档覆盖成陈旧快照
  （3180→182 行 / 322→95 行），已从 HEAD 恢复后只做增量；本轮末
  `prove_report_history_intact: PASS=7 FAIL=0`（RH-05/06/07）证明段落只增不减。

### 8.49.6 复跑命令与结果

```
node scripts/prove_multihost_common.mjs          # pass=10 fail=0（MC-00..MC-09）
node scripts/prove_box_pack_closure.js           # pass=7 fail=0（P-01..P-06）
node scripts/prove_repo_integrity.mjs            # pass=7 fail=0 skip=0
node scripts/prove_report_history_intact.mjs     # PASS=7 FAIL=0
bash scripts/verify_native_shells.sh             # OK（含 154 条模板 + 移动端 kind 事实源）
cd hosts/android/BitBotHost && ./gradlew --offline :app:testUniversalDebugUnitTest
                                                 # 126 tests / 0 failures（STU 7/0）
env -u DISPLAY xvfb-run -a bash scripts/smoke_desktop_turn.sh
                                                 # OK；2 条显式 SKIP；0 断言失败
env -u DISPLAY xvfb-run -a bash scripts/smoke_grok_desktop_parity.sh
                                                 # PASS=474 FAIL=0（G-63 MC-09、G-64 旧 smoke）
```
