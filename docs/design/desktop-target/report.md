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
