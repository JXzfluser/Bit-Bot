# Layout Contract v1 — Bit Bot Desktop Shell

> 规范用语：`MUST`=合同要求（渲染门断言），误差带外即 FAIL；`SHOULD`=非阻断建议。
> 断言载体：`scripts/e2e_desktop_layout_target.mjs`（Playwright `_electron.launch`，真实渲染）。`scripts/prove_*.js` 仅为 lint。

## 1. 唯一 grid

`body` 是唯一 shell grid，3 列 + 3 行：

```
grid-template-columns: var(--sidebar-w) minmax(0, 1fr) var(--panel-w);
grid-template-rows: var(--header-h) minmax(0, 1fr) auto;
grid-template-areas:
  "header header header"
  "agents main  rail"
  "agents composer rail";
```

- 第 3 列恒存在，宽度由状态决定（见 §2），**禁止**再出现第 4 列、`0fr` 占位列、或按类名组合穷举列宽的组合规则（现状 `body.tools-open.computer-open` 一类全部删除）。
- sidebar 折叠 = 第 1 列变 `0px` 且 `#agents` 隐藏，与 rail 状态正交（由 `data-sidebar="collapsed"` 表达，**不是** body class 穷举）。
- `#main` / `#composer` / header 区域内部不再嵌套顶层 grid 列语义。

## 2. 单一面板状态源

`document.body.dataset.panel ∈ {"none","bot","conv","computer","tools"}`（缺省视为 `none`）。

| 值 | rail 内容 | rail 宽度 |
|----|-----------|-----------|
| none | 无（rail 区域不可见、不可聚焦） | 0px |
| bot | `#bot-rail` | 340px |
| conv | `#conv-rail` | 340px |
| computer | `#computer-rail` | 340px |
| tools | `#machines` | 340px |

- MUST：任意时刻 DOM 中至多一个 rail 子元素可见（`offsetWidth>0 && getComputedStyle().display!=="none" && visibility!=="hidden" && opacity==="1"`）。
- MUST：`panel=none` 时 rail 区域贡献宽度 0（rail 内任何元素 `offsetWidth===0`），杜绝"空 rail"。
- MUST：rail 内容切换的唯一写入口 = `setPanel(next)` 一个函数；旧 body class（`tools-open/computer-open/bot-open/conv-open`）退役，JS 侧 0 个 `classList.toggle("*-open")` 残留（sidebar-collapsed 亦迁移为 `data-sidebar`）。
- SHOULD：切换带 150–250ms 宽度过渡；过渡不改变终值断言。

## 3. 区域尺寸合同（1440x900 与 1280x800 两档视口分别断言）
| 区域 | 选择器 | 期望 | 误差带 |
|------|--------|------|--------|
| header | `body>header` | height = 56px | ±2 |
| sidebar | `#agents` | panel=none 时宽 280；折叠时 0 | ±2 |
| main | `#main` | 宽 = viewport − 280 − panel_w（±2）；高 = viewport − 56 − composer_h | ±2 |
| 消息流列 | `#log > .msg` | `max-width: 760px` 且 `margin-inline:auto` 居中 | 计算值=760 ±0 |
| composer | `#composer` | 与消息流同一 760 列（内容盒 ≤760+padding 合同值） | 居中 |
| rail | 当前可见 rail | 宽 = 340（panel≠none） | ±2 |

- MUST：任何状态下 `document.documentElement.scrollWidth <= clientWidth`（无横向滚动）；`#log`、`#agents`、rail 内部纵向滚动各自成立且不溢出区域矩形。
- MUST：区域矩形两两不重叠（header/sidebar/main/composer/rail 的 `getBoundingClientRect()` 交集面积为 0；composer 与 main 共享列但垂直不重叠）。
- MUST：任何可见交互元素完全位于其区域矩形内（误差 ≤2px），position:fixed 元素只允许：modal/lightbox/toast 层（必须带合同 z-index 层级：modal=`--z-modal`、toast > modal）。
- 清理：shell `<style>` 与 `ui_chrome.css` 中除 `[hidden]{display:none!important}` 一类的全局修正外，0 个 `!important`（迁移后 lint 断言 `!important` 命中数 ≤ 现存唯一豁免并逐条注释原因）。

### 3.1 窄视口（≤900px，含产品最小宽 480）

桌面窗口 `minWidth=480`，所以 480 是产品必须可用的下界，不是假想档位。

| 约束 | 期望 | 断言（`D-L-13`） |
|------|------|------------------|
| 列 | 单列 `minmax(0,1fr)`；`body.grok-ui` 的 areas 不得压过媒体查询 | header/main/agents 宽 = viewport ±2 |
| 行 | `header 56 / agents auto（≤140）/ main minmax(0,1fr) / composer auto` | composer 完整落在视口内（右/下都不越界） |
| sidebar | 展开时占满整行；折叠时 0 宽（`#agents` display:none） | 两态都断言 |
| rail | 不再占列：`position:fixed`，`top:56`、`right:0`、宽 `min(340px,100vw)` 的覆盖抽屉 | 打开面板时 main 宽度不变；抽屉右缘贴 viewport |
| composer | 抽屉打开时仍要发得出：composer 在 rail 之上、modal 之下（57 < composer 58 < modal 60），发送键命中的是按钮本身 | `elementFromPoint(发送键中心)` 属于发送键 |
| 账户弹层 | ≤900 的 140px 横带把账户条抬到 y≈143，平时「向上开」的 `#account-popup` 会整片跑出屏外；横带里改 `position:fixed` + 贴横带下缘**向下开**，层号 59（57 < 58 < 59 < modal 60），高度受视口约束自己滚 | `MC-11`：弹层每一项都在视口内，且中心命中自己（`e2e_desktop_mobile_control.mjs`） |
| 移动端远程控制弹窗 | sheet 不超视口、两列降为单列、关闭与生成键都在视口内 | `MC-09` |
| 滚动 | 无横向滚动 | `scrollWidth ≤ clientWidth` |
| 重叠 | header / agents / main / composer 两两不重叠（rail 是覆盖层，允许压在 main 上） | 矩形交集 |

已踩过的坑：`ui_chrome.css` 的 `body.grok-ui { grid-template-areas: ... }` 比裸 `body`
选择器更具体，曾把 `<900px` 的单列规则整条压掉 —— 网格只剩 1 个显式列、areas 却仍写 3 个名字，
于是浏览器生成隐式 auto 列。480px 下实测 main 被挤到 380px、rail 74px、header 455px。
窄视口规则必须同时写 `body, body.grok-ui`。

### 3.2 窄窗口径变更（更正上面的 §3.1，2026-11-01）

§3.1 的表格**保留原文**（它记录的是当时的合同），但从本轮实测起有两条不再成立。
变更来自上游提交 `9d89d17`，不是门禁自己放宽标准，证据是代码里写明了设计意图：

```
hosts/desktop/index.html:18788-18791
  // 侧栏收起改为「手动控制」：展开 ⇄ 完全隐藏。不再按窗口宽度强制收起
  // （原 ≤768 自适应会与用户手动作反复对拉，已移除）。隐藏态下 #agents display:none，
  // 左边缘浮一个细长重开条（#sidebar-reopen-tab）把侧栏再展开，避免「收起后找不到入口」。
```

同时窄窗的侧栏宽度在媒体查询里被压小：

| 位置 | 事实 |
|------|------|
| `hosts/desktop/ui_chrome.css:134` | `--sidebar-w: 280px`（宽窗基准，`checkState` 仍按 280 断，未变） |
| `hosts/desktop/index.html:2025-2047` | `@media (max-width: 900px)` 里 `--sidebar-w: 200px` + `"agents main" / "agents composer"` 两列 |

于是 §3.1 里这两条要按下面读：

1. **列**：窄窗不是「单列」，而是 `200px 紧凑文字侧栏 + 主列拿剩下的全部宽度`。
   不变量从 `main.w == viewport` 改成 **`main.w == viewport − min(200, viewport)`**（折叠态 `== viewport`）。
   用户最初抱怨的本质没变，也仍然被断着：**侧栏最多吃 200px，不许把聊天区挤没**。
   `rail 必须覆盖而不是挤主列` 这条没删，它落在 rail 的宽度/右缘断言上（`min(340, vpW)`、右缘贴视口）。
2. **sidebar**：「展开时占满整行」作废；折叠仍是 0 宽（`#agents display:none`），但**只能由用户手动进入**
   （`#sidebar-toggle-btn` / `#sidebar-reopen-tab` / Cmd·Ctrl+B）。
   按宽度自动收起/自动展开这条能力已经不存在，`e2e_desktop_sidebar_adapt` 原来的 R-02/R-03
   测的是这个已删除的设计，继续留着只会红得没有意义。

改成纯手动带来一个新风险，合同必须补一条，因为它正是「收起后找不到入口」的落点：

> **D-L-14（新）** 窄窗与宽窗的**收起态**都必须有一个可见、可命中、能点回展开的重开条
> （`#sidebar-reopen-tab`：`display != none`、宽高 > 0、`elementFromPoint(中心)` 命中的是它自己），
> 点下去侧栏必须真的回来。自动收起时代「放宽窗口就回来了」这条兜底已经没有了。
> 断言落在 `e2e_desktop_sidebar_adapt.mjs` 的 R-05（真实点击，不调内部函数）。

对应门禁的改动（同一轮里做，红绿原文写在 `report.md`）：

| 门 | 原来断什么 | 现在断什么 |
|----|-----------|-----------|
| `e2e_desktop_sidebar_adapt` | R-02 窄→自动收起、R-03 宽→自动展开 | R-02/R-03 `700`、`480` 档主列不被挤没（`main + agents == 视口`、无横向滚动、composer 完整在视口内）；R-04 手动收起后主列拿满视口；**R-05 收起态重开条可见可点、点得回来**；R-06 手动意图不被自动展开覆盖 |
| `e2e_desktop_layout_target` | `narrow/*: main w ≠ viewport` | `main w == vpW − min(200, vpW)`（折叠 `== vpW`）、`agents w == min(200, vpW)`；另外两处的 `setPanel/applySidebarCollapse` **无条件内部函数调用**改成真实点击（那个符号已被上游删除，`ReferenceError` 一次就把整档 12 条断言全打成红） |

这两处改动的判据是同一条：**尺子只能断用户看得见的事实**。
引用一个不存在的内部函数不是断言，是坏的尺子；把「侧栏宽度」换写成「主列还剩多少」也不是放宽，
因为抱怨的内容（聊天区被挤没）在原式子里根本没被量到。

## 4. 默认状态

启动后（无用户操作、无 dev-mode）：`data-sidebar` 未设或 `expanded`、`data-panel="none"`、无调试面、无打开的 modal。MUST 由渲染门在 boot 后立即断言。

## 5. ID/事件/IPC 不变式

迁移只动几何与状态表达：元素 id、`data-i18n` 键、IPC 通道名（`bitbot:*`）、store 路径、事件监听器语义全部保持。`e2e_grok_desktop_boot.mjs` 既有 GP-* 门 0 回归（同一 runner 下跑）。

## 6. 调试面位置合同

- 默认 DOM：以下选择器 0 可见命中：`details.lab`、`#probe-*`、`#tool-webfetch`、`#tool-device`、`#cu-open`、`#gp-panel` 内非产品行、raw JSON dump 节点、`.msg.kernel/.msg.adr/.msg.effect`（以 audit.md 清单为准）。
- dev-mode（`body[data-devmode="on"]`，来源 = 设置→开发选项持久化 或 启动参数 `--bitbot-devmode`）：上述选择器出现且可见，并显示"开发模式"标记（可断言节点 `#devmode-badge`）。
- 归位映射（终版在 audit.md 处置表）：`#machines`→rail(tools)；`#computer-rail` 保持 rail(computer)；试连大脑/国内渠道→设置→凭证 tab；`#account-bar`/Hidden Bots/Connect apps/Marketplace/Settings→`#sidebar-footer` 常驻；审批队列/自动复核规则→产品面（审批卡、设置→通用）。
- 落地补充（实现时确认的边界）：
  - rail(tools) 与 `#tools-toggle-btn` 整体视为 dev 面：`setPanel("tools")` 在非 dev-mode 被拒绝，能力按钮带 `data-lab`。
  - `#hidden-bots-lab` 是产品入口（GP-118），保留 disclosure 形态、**不**入 dev-mode；`#agents-lab`（列出代理/队友 stub）才是 dev 面。
  - `#gp-panel`（群组创建 / 后台审批队列 / Computer 旧行）维持产品面；其 Computer tab 与 rail(computer) 重复的部分随后续波次收敛。
  - `#agent-info-panel`（raw 代理 dump）由 JS 直接拒绝在非 dev-mode 渲染（inline style 无法被样式表压制，走逻辑门）。
  - raw JSON overlay（`.debug-json` / Alt+D）只在 dev-mode 下可切换。

## 7. 渲染门编号（`e2e_desktop_layout_target.mjs`）

- **D-L-01..12** 几何：两档视口 × {none,bot,conv,computer,tools,collapsed} 的 §3 表断言 + §2 可见性/互斥 + §1 无第 4 列。
- **D-L-13** 窄视口：900 / 700 / 480 三档 × 6 面板态的 §3.1 断言，**按 §3.2 更正后的口径执行**
  （`main = 视口 − min(200, 视口)`、折叠态 `main = 视口`；composer 在视口内且发送键不被 rail 盖住、
  rail 覆盖不挤主列、无横向滚动）。侧栏两态由真实点击（`#sidebar-toggle-btn` / `#sidebar-reopen-tab`）进入，
  不再调用内部函数。本门由 `smoke_grok_desktop_parity.sh` 的 G-46 聚合，CI 每次推送都真跑。
- **D-L-14** 收起态重开条（§3.2 新增）：`#sidebar-reopen-tab` 必须可见、宽高 > 0、中心命中自己，点下去侧栏真的回来。
  断言在 `e2e_desktop_sidebar_adapt.mjs` R-05（同一档 G-46 聚合），因为改成纯手动后「放宽窗口自动回来」这条兜底已不存在。
- **D-L-OVL**：区域矩形不重叠；交互元素不出区；无横向滚动。
- **D-L-DIF**：前后截图逐区对比（掩码负面红）；误差红区 ≤2px 带宽外即 FAIL。
- **D-C-01..03**：可见文案全量扫描（text/placeholder/title/aria-label）：zh-CN 无未豁免英文句、en 无汉字、三语键集合一致（`copy-contract.md` §4 口径）。
- **D-D-01/02**：调试面默认 0 命中；dev-mode 开则命中且 badge 可见。
- **D-R-01**：既有 `smoke_grok_desktop_parity.sh` 与 e2e GP-* 门非回归；工具链缺失如实 SKIP 并记录原因。
