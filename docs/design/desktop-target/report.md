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
