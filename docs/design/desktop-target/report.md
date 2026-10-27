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
