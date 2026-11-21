# P1 方案：任务为主轴的 UI 重构 + 手机端「能指挥」

> 状态：**方案稿**（本轮只出方案，一行产品代码都没改；落地是下一轮）
> 基线仓库：`Bit-Bot-cursor-desktop-layout-target-v2`，HEAD `0fce9ed`，分支 `team/t4-p1-plan`
> 口径：每条能力都标 **证据来源**（`文件:行号`）。凡是仓库里查不到支撑的，一律写 **需要新增**，不写「建议」「可以考虑」这类没有落点的句子。
> 前提：产品的形态是「**用户自己机器上的可指挥团队**」，手机 = 用户自己那台机器的一个窗口，**可以随时指挥团队**。不是 SaaS、不是托管平台。

---

## 0. 一页摘要

| # | 结论 | 证据 / 依据 |
|---|---|---|
| 1 | 桌面指挥台**已经有** Task 实体、**已经有**唯一同步点、**已经有**插话/改向/刹停/换人四件套 —— 这一轮**不需要新造数据源**，要改的是**信息架构** | `hosts/desktop/product_surface.js:2499`（唯一同步点）、`hosts/desktop/product_surface.js:2708/2743/2763/2782`（四个动作）、`hosts/desktop/preload.js:151-158`（IPC 已接） |
| 2 | 指挥台的四个状态桶**只渲染计数、不成列表**，任务列表是**一张平铺** ⇒ 用户第一眼看不到「哪一件在跑、哪一件要我拍板」 | `hosts/desktop/index.html:26519-26534`（`cmdRenderBuckets` 只出数字）、`hosts/desktop/index.html:26536-26588`（`cmdRenderList` 平铺全部任务） |
| 3 | 手机端**已经有**：设备签名、审批决定、跨机执行、事件流 | `hosts/shared/cn_inbound_server.js:1021/1280/1376/1514`、`hosts/android/.../ApprovalClient.kt:71-129`、`hosts/android/.../DesktopPairing.kt:361` |
| 4 | 手机端**没有**：看任务列表、插话、改向、刹停、换人 —— 因为入站 HTTP 面**一个 task 路由都没有** | `hosts/shared/cn_inbound_server.js` 全文件 0 处 `task`；`hosts/shared/cn_inbound_server.js:19,714` 只把 surface 当成**审批队列**用 |
| 5 | 「刹停」不能简单照搬给手机：它命中的是**进程内存里的 scope 表**，HTTP 侧是**另一个 surface 实例** ⇒ 照搬会永远返回 `no_running_task` | `hosts/desktop/product_surface.js:2567`（`_taskScopes` 是工厂内的 Map）、`hosts/desktop/product_surface.js:2618-2636`（`cancelRoomTask` 读它）、`hosts/shared/product_surface_ref.js:31-37`（HTTP 侧**另建**一个实例） |
| 6 | UI 重构的**硬约束**：四桶 → 可点 tab + 行动区 + 分桶列表 + 已完折叠；复盘区**并进**已完区（同一个数据源，不新增） | 见 §2.3 改造清单 |
| 7 | 落地拆 **5 个可独立验收的批次**，批与批之间只依赖已定义的接口 | 见 §4 |

---

## 1. 现状盘点（逐条带证据）

### 1.1 桌面指挥台的 DOM 事实

| 事实 | 位置 |
|---|---|
| 入口按钮 `#cmd-open-btn`，`title`/`aria-label` 都是「团队指挥台」 | `hosts/desktop/index.html:2568` |
| 面板容器 `#command-panel`，默认 `display:none`，`margin:0 16px 8px`，**是侧栏里的一个浮出块，不是独立视图** | `hosts/desktop/index.html:2772` |
| 面板头：标题 + `#cmd-refresh-btn` + `#cmd-panel-close` | `hosts/desktop/index.html:2773-2777` |
| `#cmd-hint`：「任务来自各群的真实执行记录。」 | `hosts/desktop/index.html:2778` |
| `#cmd-buckets`：四个状态桶的**容器** | `hosts/desktop/index.html:2779` |
| `#cmd-detail`：任务卡列表的容器 | `hosts/desktop/index.html:2780` |
| `#cmd-duty`：值班区容器 | `hosts/desktop/index.html:2781` |
| `#cmd-review`：复盘区容器 | `hosts/desktop/index.html:2782` |
| 整个指挥台的脚本块 | `hosts/desktop/index.html:26250-26769` |
| 四个状态桶的定义 `needs_you / working / waiting / closed` | `hosts/desktop/index.html:26263-26268` |
| `cmdRenderBuckets()`：每个桶只画 **标题 + 数字**，**没有列表、没有可点入口** | `hosts/desktop/index.html:26519-26534` |
| `cmdRenderList()`：把所有桶的任务**平铺**进 `#cmd-detail`，按 `at` 倒序 | `hosts/desktop/index.html:26536-26588` |
| 分桶判定（Task 实体状态优先于转录推导） | `hosts/desktop/index.html:26407-26418` |
| `cmdRenderDuty()`：值班区，数据来自 `routines.list` **逐房读** | `hosts/desktop/index.html:26452-26486` |
| `cmdRenderReview()`：复盘区，数据 = Task 实体 `state === "done"` | `hosts/desktop/index.html:26492-26517` |
| 渲染层状态只有一个：`CMD_STATE = { tasks, selected, note, duty, records }` | `hosts/desktop/index.html:26270` |
| 暴露给门禁的入口 `window.__bitbotCommand = { aggregate, open, close, refresh, state, buckets }` | `hosts/desktop/index.html:26763-26767` |

> **口径更正（对任务描述里的「四桶(Task / 转录 / 值班 / 复盘)」）**：代码里的实际形态是 **4 个状态桶（只计数） + 一张平铺任务列表（由转录重建） + 值班区 + 复盘区**。「四桶」不是四个并列的内容区，而是四个**状态计数**。这份方案按代码事实写。

### 1.2 Task 实体与唯一同步点

| 事实 | 位置 |
|---|---|
| Task 实体落盘 `data/desktop/tasks.json`（`{version, tasks:[…]}`） | `hosts/desktop/product_surface.js:324-345`（`loadTasks` / `saveTasks`）、`hosts/desktop/product_surface.js:33`（`TASKS_PATH`） |
| 实测数据：46 条，字段 `id / room_id / state / task / title / total / returned / partial / closed_at / created_at / updated_at`；**当前 46 条的 `state` 全是 `done`** | `data/desktop/tasks.json`（实测） |
| `id` 的形状 = `<room_id>|<message_id>`（例 `room-mwq7b5jl-b3vio\|room-msg-mwq7c896-ai2um1`） | `data/desktop/tasks.json`（实测）+ `hosts/desktop/product_surface.js:2770-2772`（改向时按 `\|` 取幂等键） |
| **唯一同步点** `syncTaskFromTranscript(entry)`：只认 `final_report`→`done`、`confirm_request`→`waiting`、`task_state/cancelled`→`cancelled`、`task_state/replanned`→改标题 | `hosts/desktop/product_surface.js:2499-2530` |
| 它挂在 `appendRoomTranscript` **内部**，且在转录写成功**之后**调用；同步失败**不许**让转录写入变成失败 | `hosts/desktop/product_surface.js:2532-2548`（调用点 `2543`） |
| 合并写：按 `id` 合并、不整表覆盖、`created_at` 保留 | `hosts/desktop/product_surface.js:333-364` |
| 读侧 `listTasks()`（按 `updated_at` 倒序） | `hosts/desktop/product_surface.js:367-370` |
| IPC：`bitbot:tasks:list` → `surface.listTasks()` | `hosts/desktop/main.js:3115-3121`、`hosts/desktop/preload.js:126-129` |

> **诚实缺口**：Task 实体**没有 `running` 态** —— 没有任何写入方会写 `state:"running"`。聚合里 `st === "running"` 那条分支（`hosts/desktop/index.html:26413`）目前是死路，「在跑」实际是从转录的 `steps.length` 推出来的（`hosts/desktop/index.html:26416`）。这一点在 UI 上必须继续按「从转录推」的口径说，不许写成「Task 说它在跑」。

### 1.3 已有的「指挥」四件套走的是哪条链路

四件套**已经实现、已经接了 IPC、已经有门禁**，只是目前只有桌面渲染层能点到：

| 动作 | 渲染层入口 | preload | 主进程 IPC | product_surface | 数据落点 |
|---|---|---|---|---|---|
| 插话 | `data-cmd-steer`（`index.html:26571`） | `rooms.steerTask`（`preload.js:154`） | `bitbot:rooms:task:steer`（`main.js:3128`） | `steerRoomTask`（`product_surface.js:2743-2757`） | 共享板 `roomBoard.post` + 一条 `task_state/steered` 转录行 |
| 改向 | `data-cmd-replan`（`index.html:26573`） | `rooms.replanTask`（`preload.js:158`） | `bitbot:rooms:task:replan`（`main.js:3136-3149`） | `replanRoomTask`（`product_surface.js:2763-2779`） | 一条 `task_state/replanned` 转录行；**主进程随后 fire-and-forget 重跑** |
| 刹停 | `data-cmd-cancel`（`index.html:26580-26583`，只在 `bucket==="working"` 且有 `task_sig` 时给） | `rooms.cancelTask`（`preload.js:152`） | `bitbot:rooms:task:cancel`（`main.js:3152-3170`） | `cancelRoomTask`（`product_surface.js:2618-2636`） | 命中 `_taskScopes`（`product_surface.js:2567`）；主进程再补一条 `task_state/cancelled` 转录行 |
| 换人 | `data-cmd-swap`（`index.html:26439-26441`，在成员明细行上） | `rooms.reassignTask`（`preload.js:156`） | `bitbot:rooms:task:reassign`（`main.js:3123-3126`） | `reassignRoomTask`（`product_surface.js:2708-2736`） | 一条 `task_state/reassigned` 转录行 |

**已有的诚实边界（UI 必须照抄，不许美化）**：

- 插话落**共享板**，**下一棒**看得见，**当前这一轮看不见** —— 返回值就写着 `scope:"next_hop", current_turn_sees:false`（`product_surface.js:2756`）。
- 换人换的是**下一棒**，当前那一轮已经拿到 prompt（`product_surface.js:2734-2735`）。
- 改向会**立刻重跑同一批**（`main.js:3141-3148`，`force:true`）。
- 刹停**只精准命中一个 `task_sig`**，不是全停（`product_surface.js:2565-2567`）。
- 共享板落盘位置 `data/agents/sections/`（`hosts/desktop/room_orchestrator.js:61-64`）—— **跨进程、跨机器可见的文件面**。

### 1.4 手机端现状

| 能力 | 现状 | 证据 |
|---|---|---|
| 手机发指令（触发一轮） | **能**。`POST /v1/turn {text, machine_kind, session_id}` | `hosts/shared/cn_inbound_server.js:1376-1490`；Android `TurnBridge.kt`、iOS `TurnBridge.swift` |
| 手机上看这一轮的进度 | **能**。`GET /v1/events`（SSE），游标 `?since=`/`?from_seq=`，`?session_id=` 过滤 | `hosts/shared/cn_inbound_server.js:1514-1660`；Android `EventStreamClient.kt`（`sessionFor()` 在 `TurnBridge.kt:262`） |
| 手机上批审批 | **能**。`GET /v1/approvals` / `POST /v1/approvals/<id>/decide` | `hosts/shared/cn_inbound_server.js:1021,1040,1067`；Android `ApprovalClient.kt:71-129`、iOS `ApprovalClient.swift` |
| 手机上「总是允许」 | **能**，但语义是**作用域规则**，不是万能钥匙 | `scripts/prove_approval_scope.js`（AS-01..AS-07）；服务端 `surface.approvalDecide(id, decision, undefined, {scope:"wide"})`（`cn_inbound_server.js:1081-1086`）；宽授权必须显式 `scope:"wide"` |
| 设备身份（每台机器一对 ed25519） | **能**。配对时带 `device_public_key` → 服务端登记 | Android `DesktopPairing.kt:361`；服务端 `cn_inbound_server.js:1312-1335`（坏公钥当场 400，不发 bearer） |
| 登记表非空 ⇒ 只认设备签名 | **是**。老客户端拿的共享 bearer 在登记后失效 | `cn_inbound_server.js:1383-1387`（`hasDevices` 三元）、`:1353-1365`（`requires_device_credential`） |
| 跨机执行 | **能**。`@box_host` 机器表 + `machine_presence` 的真实在线证据 | `box_host/machines.mbt`（`MachineKind`/`MachineRegistry`）、`hosts/shared/machine_presence.js`（文件头：内核那本机器表是 seed 出来的，只有 Host 知道谁真的在说话） |
| **手机上「看任务列表」** | **不能**。入站面 **0 条 task 路由** | `hosts/shared/cn_inbound_server.js` 全文 0 处 `task`（实测） |
| **手机上插话 / 改向 / 刹停 / 换人** | **不能**。这四个函数只挂在 Electron 渲染层的 IPC 上 | `hosts/desktop/preload.js:151-158` 是 `ipcRenderer.invoke`；`hosts/shared/cn_inbound_server.js` 没有任何对应路由 |

**入站服务拿不到「桌面那份 surface」这件事，是手机指挥的第一道坎**：`cn_inbound_server.js:19,714` 用 `createProductSurfaceRef(repoRoot, dataRoot)` **另建**了一个 surface 实例（`hosts/shared/product_surface_ref.js:31-37`）。因此：

- **读**（rooms.json / tasks.json）是文件读的 ⇒ 第二个实例读得到（**可用**）。
- **写**（插话/改向/换人）是文件写 + 文件锁 + 合并不覆盖 ⇒ 第二个实例写得对（**可用**）。
- **刹停**命中的是**进程内存**里的 `_taskScopes`（`product_surface.js:2567`）⇒ 第二个实例的表是空的 ⇒ `cancelRoomTask` 永远返回 `no_running_task`（**不可用，必须修**）。

### 1.5 会被这次改动打到的门禁（先认清，才敢动 DOM）

| 门禁 | 它读什么 | 会被什么改动打到 |
|---|---|---|
| `scripts/prove_command_panel.js` | `#command-panel` / `#cmd-buckets` / `#cmd-detail` 的文案与 `innerHTML.length`（`:169-196`） | 桶改成 tab、列表分栏 |
| `scripts/prove_command_task_control.js` | `#cmd-detail`、`.cmd-step-name`、`.cmd-step-text`、`.cmd-tag`、`[data-cmd-task]`、`.cmd-input`、`[data-cmd-swap]`、`[data-cmd-cancel]`、`#cmd-duty`、`.cmd-duty-row`、`#cmd-review`、`.cmd-review-row`（`:401-575`） | 复盘区合并、列表分栏 |
| `scripts/prove_copy_contract.js` | 三语键集合、`data-i18n*` 引用齐全、渲染器 0 硬编码中文（`:100-200`） | 新增文案键 |
| `scripts/prove_ui_tokens.js` | css `!important` ≤178、css hex ≤48、html hex ≤25、**行内 `font-size` ≤13**、`[style*=` ≤5、`--sidebar-w`/`--header-h` 单一源（`:29-140`） | 新增 CSS 类 |
| `scripts/prove_i18n_render.js` | 真渲染后 en 界面 0 汉字（IR-01） | 新增文案 |
| `scripts/prove_ui_simplicity.js` | 主区可见输入框数量 = 0、既有 32 个 id 全在（`:8-16`） | 新增 DOM 元素（尤其输入框） |
| `scripts/e2e_desktop_layout_target.mjs` | 1440×900 / 1280×800 几何、**窄视口 900/700/480×720**、D-C-03 三语键一致（`:306,480-570`） | 面板宽度/溢出 |
| `scripts/e2e_desktop_mobile_control.mjs` | 480×720 下弹窗不破版（MC-09/MC-11） | 窄宽下的指挥台 |
| `scripts/prove_mobile_approval_client.js` | 手机端抄的端点/字段必须与服务端字面量一致 | 新增端点时必须同批更新 |

---

## 2. UI 形态重构方案（任务为主轴）

### 2.1 诊断（每条都能落到 §2.3 的某一行）

1. **桶是死的**：`cmdRenderBuckets` 只出四个数字（`index.html:26519-26534`），用户点不动、数字与列表之间没有映射 —— 用户看到「在跑 3」，不知道是哪 3 件。
2. **列表是平的**：`cmdRenderList` 把四个桶混在一张列表里按时间倒序（`index.html:26536-26588`），「在跑的那件事」和「三天前做完的」长得一样，只靠一行小字区分（`index.html:26554-26557`）。
3. **首屏不是「该我干嘛」**：面板顶部是标题 + 刷新 + 关闭（`index.html:2773-2777`），第一眼看到的是四个计数，不是那件需要拍板的事。
4. **复盘与已完是同一件事、两个视图**：`cmdRenderReview` 只列 Task 实体 `state==="done"`（`index.html:26496-26498`），而「已完」桶也由 `state==="done"` 推出（`index.html:26411`）—— 同一份数据画两遍。

### 2.2 信息架构（先给什么 / 后给什么）

**一级：现在要我做决定的那件事。** 面板打开后的第一屏只有「要你拍板」的卡（最多 3 条 + 「还有 N 件」）。这直接对应 `bucket === "needs_you"`（`index.html:26412/26414`）。

**二级：正在跑的事。** 四个状态桶从「只计数」变成**可点的 tab**（`needs_you / working / waiting / closed`，`index.html:26263-26268`）。点「在跑」就只看在跑的。

**三级：已经收口的。** 默认折叠的「已完成」，内容 = 原来的复盘区（同一个 Task 实体，不新增数据源）。

**四级：值班与排期。** 降级为面板末尾的折叠区 —— 它是「未来的事」，不该和「现在的事」抢首屏。

**聊天在哪？** 聊天是这批任务**某一个视角**：`#cmd-open-room` 按钮（`index.html:26577`）已经能跳到对应群聊。本方案**不删聊天、不改聊天**，只把任务提为主轴、聊天降为一个视图。

### 2.3 DOM 改造清单（选择器级）

> 规则：**新增/改动的元素一律不写行内 `font-size`**（T-3 基线 13，只许不涨）；**不写十六进制色值**（T-2/T-2b）；**不写 `!important`**（T-1）；**不用 `[style*=]`**（T-4）。新样式一律进 `hosts/desktop/ui_chrome.css`，只用 `var(--token)`。

| # | 现状选择器（`index.html`） | 改后 | 动作 | 备注 |
|---|---|---|---|---|
| D-1 | `<div id="command-panel" style="display:none;margin:0 16px 8px">`（`:2772`） | `<div id="command-panel" class="cmd-panel" hidden role="region" aria-label="团队指挥台" data-i18n-aria="cmdTitle">` | 改 | 内联 `display:none` 换成 `hidden` 属性（`hosts/desktop/ui_chrome.css:332` 已有 `[hidden]{display:none!important}` 豁免，`scripts/prove_ui_tokens.js:78` 认它）；`margin` 移进 `.cmd-panel` 类 |
| D-2 | `#cmd-buckets`（`:2779`） | `<div id="cmd-buckets" class="cmd-tabs" role="tablist">`，内部渲染 4 个 `<button class="cmd-tab" data-cmd-tab="needs_you" role="tab" aria-selected="true|false">`，每个内含 `<span class="cmd-tab-label" data-i18n="cmdNeedsYou">` + `<span class="cmd-tab-count">N</span>` | 改 | 标签文本在 JS 渲染时用 `cmdT()` 取词**同时**挂 `data-i18n`（语言切换扫描会覆盖内层 span，不影响计数 span）；`data-i18n` 挂在**内层 span** 上，避免扫描把计数一起抹掉 |
| D-3 | （无） | 新增 `<section id="cmd-active" class="cmd-active">`，含 `<h3 class="cmd-sec-title" data-i18n="cmdActiveTitle">` + `<div id="cmd-active-list" class="cmd-list">` | 新增 | 只放 `bucket==="needs_you"` 的卡，最多 3 条 |
| D-4 | `#cmd-detail`（`:2780`） | 保留 id（门禁依赖），改成 `<div id="cmd-detail" class="cmd-sections">`，内部 4 个 `<section class="cmd-section" data-bucket="needs_you|working|waiting|closed">`，每区一个 `<div class="cmd-list">` | 改 | 桶与列表第一次真正对应上 |
| D-5 | （无） | 新增 `<details id="cmd-done" class="cmd-fold"><summary class="cmd-fold-summary"><span data-i18n="cmdDoneTitle">已完成</span><span class="cmd-fold-count" id="cmd-done-count"></span></summary><div id="cmd-done-list" class="cmd-list"></div></details>` | 新增 | 装原复盘区的行，**行 class 沿用 `.cmd-review-row`**（门禁改动最小） |
| D-6 | `#cmd-duty`（`:2781`，`<div>`） | `<details id="cmd-duty" class="cmd-fold"><summary class="cmd-fold-summary"><span data-i18n="cmdDuty">值班</span><span class="cmd-fold-count" id="cmd-duty-count"></span></summary><div id="cmd-duty-list" class="cmd-list"></div></details>` | 改 | `cmdRenderDuty` 的写入点从 `#cmd-duty` 改成 `#cmd-duty-list`；门禁读 `#cmd-duty` 的 `textContent` 仍能拿到行文本（`details` 未展开时子节点仍在 DOM 里） |
| D-7 | `#cmd-review`（`:2782`） | **删除**（连同 `cmdRenderReview` 函数，`index.html:26492-26517`） | 删 | 复盘 = 已完 = Task 实体 `state==="done"`，与 `#cmd-done` 同源；**不新增数据源**。门禁 `prove_command_task_control.js` 的 TC-30 断言改成查 `#cmd-done-list`（`.cmd-review-row` class 保留） |
| D-8 | 卡片根 `div.frame-box[data-cmd-task]`（`:26558`） | `<article class="cmd-card" data-cmd-task="…" data-bucket="…" data-task-sig="…">` | 改 | `data-cmd-task` 保留（门禁 `prove_command_task_control.js:527` 依赖） |
| D-9 | 卡片标题裸 `div style="font-weight:600"`（`:26559`） | `<h4 class="cmd-card-title">` | 改 | 去掉行内样式，字号走类型阶 class |
| D-10 | （无） | 卡片头加 `<span class="cmd-state" data-cmd-state>` + `<span class="cmd-card-room cmd-room">` | 新增 | 状态徽标让「在跑 / 要你拍板 / 已完」一眼可辨 |
| D-11 | `div.cmd-actions`（`:26576`） | 保留 class；按钮不变：`data-cmd-open-room`、`data-cmd-cancel`（仍只在 `bucket==="working"` 且有 `task_sig` 时给） | 不变 | 现有语义（`index.html:26578-26583`）是对的，不动 |
| D-12 | `div.cmd-command` + `.cmd-input` + `data-cmd-steer` + `data-cmd-replan`（`:26567-26575`） | 保留 class 与属性 | 不变 | 换人复用同一张卡的输入框（`:26437-26441`），这条交互**不改** |
| D-13 | `.cmd-step` 行（`:26433`） | 保留；行内加 `data-cmd-step="{name}"` | 小改 | 为了批 2 的像素门能定位「每个成员一行」 |
| D-14 | `#cmd-hint`（`:2778`） | 保留 | 不变 | 口径「任务来自各群的真实执行记录」仍然准确 |
| D-15 | （无） | `window.__bitbotCommand` 增加 `render: cmdRender`（`index.html:26763-26767`）；`wavegLangApply`（`:23099`）末尾加一行 `try { if (window.__bitbotCommand && typeof window.__bitbotCommand.render === "function") window.__bitbotCommand.render(); } catch (_) {}` | 新增 | 换语言时已渲染的面板要重画，否则会留下上一种语言（`wavegLangApply` 的注释 `index.html:23171-23173` 记录过这个病） |

**删除清单小结**：`#cmd-review`（并进 `#cmd-done`）、`cmdRenderReview` 函数、`#command-panel` 的行内 `style`。**不删**：聊天视图、`#cmd-detail` 这个 id、`.cmd-input`、`.cmd-step*`、`.cmd-tag`、所有 `data-cmd-*` 动作属性。

### 2.4 改完后的用户动线

1. **打开就看到该干嘛**：点头部 `#cmd-open-btn`（`index.html:2568`）→ 面板弹出 → **第一屏是 `#cmd-active`**：要你拍板的那件事，带「回答问题 / 换人」两个动作。没有待办时 `#cmd-active` 整块隐藏（不占屏），首屏直接是四个 tab。
2. **找到在跑的那件事**：点 tab「在跑（N）」→ `#cmd-detail` 里只显示 `.cmd-section[data-bucket="working"]` → 第一张卡就是最新在跑的（`cmdRenderList` 现有的 `at` 倒序保留）。卡上写着：标题、群名、谁干了什么（`.cmd-step` 明细）、谁在等。
3. **插话**（让下一棒看见）：卡片底部 `.cmd-input` 写一句 → 点「插话」→ `rooms.steerTask` → 回执「已插话。下一棒会看到。」（`cmdSteered`，`index.html:19083`）。UI 必须在按钮旁常驻一句小字说明「下一棒会看到，当前这轮看不到」—— 依据 `product_surface.js:2756` 的诚实边界。
4. **改向**（换目标并重跑）：同一个输入框 → 点「改向」→ `rooms.replanTask` → 回执「已改向，正在重跑。」且**列表里这一条要变成「在跑」**（因为主进程 `main.js:3141-3148` 会 `force:true` 重跑）。
5. **刹停**：在跑卡上的红色「刹停」→ `rooms.cancelTask` → 回执「已停。」；**这一条要从「在跑」掉到「已完」**（主进程会补一条 `task_state/cancelled` 转录行，`main.js:3160-3166`）。
6. **换人**：在步骤明细里某个成员那一行右侧的「换人」→ **读同一张卡的输入框当新人选** → `rooms.reassignTask`。失败时回执必须显示服务端原因（`bot_not_found` / `bot_not_in_room` / `same_bot`，`product_surface.js:2717-2727`），不许显示成「没换成:undefined」。

### 2.5 三语文案（Copy contract v1）

**复用的键（零新增）**：`cmdNeedsYou` / `cmdWorking` / `cmdWaiting` / `cmdClosed`（tab 标签，`index.html:19091-19094` / `20600-20603` / `22109-22112`）、`cmdDuty`（值班折叠标题）、`cmdSteer` / `cmdReplan` / `cmdCancel` / `cmdSwap` / `cmdOpenRoom`、全部回执键（`cmdSteered` / `cmdReplanned` / `cmdStopped` / `cmdSwapped` / `cmdCmdEmpty` / `cmdCmdFailed` / `cmdStopFailed` / `cmdSwapFailed`）。

**新增的键（共 5 个，每个语言 1 条，共 15 条）**：

| 键 | zh-CN | zh-TW | en | 用在哪 |
|---|---|---|---|---|
| `cmdActiveTitle` | 要你拍板 | 要你拍板 | Needs you | `#cmd-active` 标题（`:2772` 区块） |
| `cmdRunningTitle` | 在跑的 | 在跑的 | Running | 「在跑」分区标题（`#cmd-detail` 内的 section 头） |
| `cmdDoneTitle` | 已完成 | 已完成 | Completed | `#cmd-done` 的 `<summary>` |
| `cmdMoreCount` | 还有 {n} 件 | 還有 {n} 件 | {n} more | `#cmd-active` 超过 3 条时的溢出提示 |
| `cmdSteerScopeHint` | 下一棒会看到，当前这轮看不到 | 下一棒會看到，當前這輪看不到 | The next hop sees it, the current turn does not | 插话按钮旁的小字 |

**插值的写法必须用模板键**：`cmdT()` 是**不带参数**的（`index.html:23063-23076`），带参数的是 `t(key, params)`（`index.html:23079-23087`，支持 `{{name}}` 与 `{name}`）。所以：

- `cmdMoreCount` 必须写成 `t("cmdMoreCount", { n: String(n) })`，**不许**写成 `cmdT("cmdMoreCount") + n`（那是 Copy contract §1 禁止的「中文前缀 + 变量」拼句形态）。
- 现有的 `cmdSet` / `cmdDone` 已经用 `{v}` 形态（`index.html:18914` / `21936`），照抄这个形态即可。

**三处插入位置**（同一批改，缺一条 `prove_copy_contract.js` 的 CC-03 立刻红）：
- zh-CN 段：`hosts/desktop/index.html:19102` 之后（`cmdUnavailable` 后面）。
- zh-TW 段：`hosts/desktop/index.html:20611` 之后。
- en 段：`hosts/desktop/index.html:22120` 之后。

### 2.6 门禁合规清单（批 1 收工时必须全绿）

| 门禁 | 判据 | 批 1 的影响 |
|---|---|---|
| `node scripts/prove_copy_contract.js` | CC-03 三语键集合一致；CC-05 每个 `data-i18n*` 三语都有词条；CC-01/CC-02 渲染器 0 硬编码中文、0 中文前缀拼句 | 新增 5 个键 ⇒ 三段都补；新文案一律走 `cmdT`/`t` |
| `node scripts/prove_ui_tokens.js` | T-1 `!important` ≤178；T-2 css hex ≤48 / html hex ≤25；T-3 行内 `font-size` ≤13；T-4 `[style*=` ≤5 | 新 CSS 只用 `var(--token)`；新 DOM 不带行内 `font-size`；`#command-panel` 的行内 `style` 删掉 |
| `node scripts/prove_i18n_render.js` | en 界面渲染后 DOM 0 汉字 | JS 渲染的 tab 标签必须走 `cmdT()` |
| `node scripts/prove_command_panel.js` | CP-4 桶标题渲染出来；CP-5 空态「还没有任务」 | 桶改 tab 后 `#cmd-buckets` 的 `textContent` 仍须含标签文本 ⇒ tab 标签用 `cmdT()` 写入内层 span |
| `node scripts/prove_command_task_control.js` | TC-6..TC-31 | TC-30 的 `#cmd-review` → `#cmd-done-list`；其余选择器全部保留 |
| `node scripts/prove_ui_simplicity.js` | 主区可见输入框 = 0；既有 id 全在 | `.cmd-input` 在指挥台内、指挥台默认 `hidden` ⇒ 不在主区；不删任何既有 id |
| `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_desktop_layout_target.mjs` | 1440×900 / 1280×800 几何；**窄视口 900/700/480×720**；D-C-03 三语键一致 | 面板宽度变化不得影响 header/sidebar/main/composer 几何；`#cmd-panel` 宽度不得超过 `#agents` 内容宽 |

---

## 3. 手机端「能指挥」方案

### 3.1 能力矩阵（现状判定）

| 手机上能做到的事 | 现在就能做？ | 证据 / 缺口 |
|---|---|---|
| 看到「这台机器上正在跑的任务」清单 | **不能** → **需要新增** `GET /v1/tasks` | 入站面 0 条 task 路由（`cn_inbound_server.js` 全文实测） |
| 看到某个任务的成员各自干了什么 | **不能** → 随 `GET /v1/tasks` 一起新增 | 桌面侧的聚合逻辑在 `index.html:26331-26421`，服务端没有对应物 |
| 看到「哪件要我拍板」 | **不能** → 随 `GET /v1/tasks` 一起新增 | `needs_you` 来自 `confirm_request` 行（`product_surface.js:2514-2521`），手机读不到转录 |
| 插话（下一棒看见） | **不能** → **需要新增** `POST /v1/tasks/<sig>/steer` | `steerRoomTask`（`product_surface.js:2743`）只挂在 IPC 上 |
| 改向（换目标并重跑） | **不能** → **需要新增** `POST /v1/tasks/<sig>/replan` | 同上；且重跑要能触发 `surface.orchestrateRoom` |
| 刹停 | **不能，且不能简单照搬** → **需要新增** `POST /v1/tasks/<sig>/cancel` + **跨实例取消通道** | `_taskScopes` 是工厂内的内存 Map（`product_surface.js:2567`），HTTP 侧是另一个实例（`product_surface_ref.js:31-37`）⇒ 照搬必得 `no_running_task` |
| 换人 | **不能** → **需要新增** `POST /v1/tasks/<sig>/swap` | `reassignRoomTask`（`product_surface.js:2708`）只挂在 IPC 上 |
| 批审批 | **能**（已有） | `cn_inbound_server.js:1040/1067` + `ApprovalClient.kt` / `ApprovalClient.swift` |
| 决定「总是允许」 | **能**（已有，语义 = 作用域规则） | `scripts/prove_approval_scope.js` |
| 看这一轮的实时进度 | **能**（已有） | `cn_inbound_server.js:1514` |
| 发新一轮指令 | **能**（已有） | `cn_inbound_server.js:1376` |
| 挑「让哪台机器 / 哪个人去做」 | **不能**（内核机器表是 seed 出来的固定花名册） | `box_host/machines.mbt`（`MachineRegistry::seed`）、`hosts/shared/machine_presence.js` 文件头 |

### 3.2 链路：走什么

**不复用 IPC（IPC 只活在 Electron 渲染进程里，手机没有这个通道）；不复用「mailbox」** —— 仓库里叫 mailbox 的是**邮件连接器的草稿箱**（`connectors/mail/mailbox_draft.mbt`），跟任务指挥无关。**真正该复用的是那台机器上的共享板与共享转录**：

```
手机（Android/iOS）
  │  设备签名（x-bitbot-device / -timestamp / -nonce / -signature）
  │  ← hosts/android/.../DeviceIdentity.kt ；hosts/ios/.../DeviceIdentity.swift
  ▼
那台机器的入站 HTTP（hosts/shared/cn_inbound_server.js，与桌面主进程同进程）
  │  ├─ GET  /v1/tasks                      【新增】
  │  ├─ POST /v1/tasks/<sig>/steer          【新增】
  │  ├─ POST /v1/tasks/<sig>/replan         【新增】
  │  ├─ POST /v1/tasks/<sig>/cancel         【新增】
  │  ├─ POST /v1/tasks/<sig>/swap           【新增】
  │  └─ 已有：/v1/turn、/v1/events、/v1/approvals
  ▼
product_surface（**必须是主进程那一份实例** —— 见 §3.2.3）
  ├─ 读：data/desktop/rooms.json（转录）+ data/desktop/tasks.json（Task 实体）
  ├─ 写：共享板 data/agents/sections/（插话落点）+ 共享转录（task_state 行）
  └─ 刹停：进程内 _taskScopes
```

#### 3.2.1 新增路由的契约（逐条写死）

- **鉴权**：**只认设备签名**（`deviceKeys.verifyDeviceTurn(deviceStoreNow(), req, raw, { nonceStore })`），与 `/v1/approvals` 同构（`cn_inbound_server.js:1022`），**不回落共享 bearer**。理由：指挥那台机器上的团队，权限比发一轮对话重。后果要说清楚：还没登记公钥的老客户端只能聊天、不能指挥 —— 但这个状态本来就已经存在（`cn_inbound_server.js:1355-1362` 的 `requires_device_credential`）。
- **`<sig>` 的编码**：`task_sig` 形状是 `<room_id>|<message_id>`（`data/desktop/tasks.json` 实测），含 `|` ⇒ **必须 `encodeURIComponent`**。服务端路由正则与已有的 approvals 一致：`/^\/v1\/tasks\/([^/]+)\/(steer|replan|cancel|swap)$/` + `decodeURIComponent`（照抄 `cn_inbound_server.js:1069-1073` 的写法）。
- **错误码一律如实回**，不编：沿用 `product_surface.js` 已有的码 —— `task_sig_required` / `room_id_required` / `text_required` / `task_required` / `from_bot_required` / `to_bot_required` / `same_bot` / `bot_not_found` / `bot_not_in_room` / `room_not_found` / `no_running_task`（`product_surface.js:2713-2727`、`2619-2624`、`2747-2749`）。HTTP 状态：参数缺失 400、业务失败 409、找不到任务 404。
- **`GET /v1/tasks` 的响应体**：

```jsonc
{
  "ok": true,
  "device_id": "<设备 id>",
  "count": 7,
  "tasks": [
    {
      "task_sig": "<room_id>|<message_id>",
      "room_id": "room-…",
      "room_title": "内容团队",
      "bucket": "needs_you | working | waiting | closed",
      "state": "waiting | running | done | cancelled | \"\"",
      "title": "…", "task": "…",
      "members": ["Alice", "Bob"],
      "steps": [{ "name": "Alice", "bot_id": "…", "ok": true, "text": "…", "error": "", "at": "…" }],
      "needs_you": { "question": "…", "candidates": [], "at": "…" },
      "total": 2, "returned": 1, "partial": true,
      "running": true,
      "at": "…", "updated_at": "…",
      "can": { "steer": true, "replan": true, "swap": true, "cancel": true }
    }
  ]
}
```

`can.*` 是**服务端算的**，不是端上猜的 —— 依据现有规则：刹停只在 `bucket==="working"` 且有 `task_sig` 时可点（`index.html:26580`）；换人只在成员行有 `bot_id` 时可点（`index.html:26438`）。

#### 3.2.2 聚合逻辑只留一份（不许平行数据源）

桌面渲染层的聚合在 `hosts/desktop/index.html:26292-26421`（`cmdMergeTaskRecords` + `aggregateCommandTasks`）。HTTP 侧要出同样的清单 ⇒ **同一份逻辑必须同时被 Node 与浏览器用**。

做法（照抄仓库已有的 UMD 形态，见 `hosts/shared/client_core/reducer.js:1-24,尾`）：

- 新增 `hosts/shared/task_view.js`：把 `cmdMergeTaskRecords` / `aggregateCommandTasks` 原样搬进去，尾部 `if (typeof module !== "undefined" && module.exports) module.exports = API;` + `globalThis.__bitbotTaskView = API`。
- `hosts/shared/cn_inbound_server.js` `require("./task_view")`。
- `hosts/desktop/index.html` 用 `<script src="../shared/task_view.js"></script>` 加载，并照抄 `index.html:4298-4307` 的打包态兜底（`document.write('<script src="./shared/task_view.js"><\/script>')`）。打包路径可证：`hosts/desktop/package.json` 的 `build.files` 把 `../shared/**` 映射到 `app.asar/shared/**`。
- 渲染层的 `aggregateCommandTasks` 改成委派 `__bitbotTaskView.aggregate(...)`，**不保留第二份实现**（门禁要加一条「`index.html` 里不再出现 `function aggregateCommandTasks`」）。

**这是「不许另起平行数据源」的落法**：Task 实体只有 `data/desktop/tasks.json` 一份（`product_surface.js:324`），转录只有 `data/desktop/rooms.json` 一份（`product_surface.js:2533-2539`），聚合只有 `hosts/shared/task_view.js` 一份。

#### 3.2.3 刹停的跨实例问题（必须单独解决，不能糊）

- 现状：`_taskScopes`（`product_surface.js:2567`）+ `_activeRoomScopes`（`:2564`）是 `createProductSurface()` **工厂内**的内存状态；桌面主进程有自己那份（`main.js:823`），入站服务另建了一份（`product_surface_ref.js:31-37`）。
- 修法（选一，本方案选 a）：
  - **(a) 注入同一份实例**：`createCnInboundServer({ …, surface })` 接受一个**可选** surface；`main.js:5128` 创建入站服务时把 `surface` 传进去。入站服务仍保留 `createProductSurfaceRef` 作为**没有注入时的回落**（`box_main.js` 那条路径没有 Electron surface）。这样桌面模式下 HTTP 与 IPC **共用同一个实例** ⇒ `_taskScopes` 命中、取消生效、且不再有两个实例各写各的。
  - (b) 落一个跨实例的取消请求文件，桌面实例轮询 —— 多一个文件面、多一份延迟、多一个失败模式。**本方案不选。**
- 批 4 必须同时落一条断言：**用 HTTP 端点真的停掉一个在跑的任务**（真起一轮 → 真取消 → 收到 `{"ok":true,"cancelled":1}`），而不是只测路由存在。

#### 3.2.4 改向的「立刻重跑」怎么在 HTTP 侧触发

桌面侧是 IPC handler 里 fire-and-forget 调 `surface.orchestrateRoom({room, task, message_id, force:true})`（`main.js:3141-3148`）。HTTP 侧要复刻这一步 ⇒ **必须走同一个 surface 实例**（即 §3.2.3 的 (a)）。否则手机点了「改向」，转录里多了一条 `replanned`，但**没有任何人重跑** —— 界面会说谎。

### 3.3 安全边界

| 边界 | 规则 | 证据 / 落点 |
|---|---|---|
| 身份 | **账号 = 设备密钥对**。手机没有账号体系，只有一对 ed25519；私钥永不出设备，公钥在配对时登记 | `hosts/shared/device_keys.js`、`cn_inbound_server.js:1314-1341`（服务端只收公钥，id 由公钥指纹派生）、`docs/design/desktop-target/cross-end-roadmap-a.md` §0 |
| 指挥面鉴权 | 控制类路由**只认设备签名**，bearer 一律 401，且回执带 `error_description` / `next_step`（不裸返回 code） | 照抄 `cn_inbound_server.js:1022-1034` 与 `:1413-1428`（A2-4 口径） |
| 审批作用域 | 「总是允许」默认写**作用域**规则（`shell:git status`、`mail_send:me@example.com`），**不含正文/参数值**；算不出作用域就**不写长期规则**；按类放行必须显式 `scope:"wide"` | `scripts/prove_approval_scope.js`（AS-01..AS-07）、`product_surface.js` 的 `approvalScope` |
| 「总是允许」不是万能钥匙 | 批了 `git status` 不等于批了 `git push --force`；`ask` 优先于 `allow` | 同上（AS-05 / AS-06） |
| 审批可吊销 | 设备可被吊销，吊销即失效 | `hosts/shared/device_roster.js`（`revokeInRoster`）、`device_keys.js` 的 `!revoked_at` 过滤 |
| 手机端的读边界 | `GET /v1/tasks` 返回的是**这台机器上所有群的任务**。设备签名只证明「你是登记过的设备」，**不证明你只该看某一个群** ⇒ 必须如实说明：这是**单机单账号**模型，不是多租户 | 与 `cross-end-roadmap-a.md` §6.1 的 R-A1-1 同源（`?session_id=` 只挡「看得见谁」，不挡「有权看谁」）—— 本方案**如实登记这条残留**，不假装解决 |
| 手机端的写边界 | 插话/改向/刹停/换人 = **改这台机器上的团队**。写操作全部落**可审计**的转录行（`task_state/steered|replanned|cancelled|reassigned`），不静默 | `product_surface.js:2729-2733,2751-2754,2773-2777`；刹停的转录行在 `main.js:3160-3166` |
| 不新增身份体系 | 不做邮箱/手机号注册、不做 SaaS 账号 | `docs/next-target-requirements.md` §1「五条不做」 |

### 3.4 手机端的界面形态（最小可用）

Android 侧现有 UI 结构（`hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/ui/`）：`HomeScreen.kt`（唯一一屏）、`Sheets.kt`（`MenuSheet` / `CredentialsSheet` / `CapabilitiesSheet` / `PairingSheet`）、`ApprovalSheet.kt`（审批）、`Components.kt`（`AppTopBar` / `ChatListView` / `ComposerBar` / `DeliveryStrip`）。

新增：

- `ui/TaskCommandSheet.kt`：一个 sheet，结构 = 顶部两个计数（「要你拍板 N」/「在跑 N」）+ 任务卡列表 + 每卡的动作行（插话输入 + 插话 / 改向 / 刹停 / 换人）。
- `TaskCommandClient.kt`：与 `ApprovalClient.kt` **同形**（同 URL 拼装、同 `DeviceIdentity.requestHeaders` 签名、同 `x-bitbot-*` 头、同错误映射口径）。
- `MainActivity.kt`：在 `MenuSheet`（`Sheets.kt:82`）里加一项「指挥任务」→ 打开 `TaskCommandSheet`；拉取时机 = sheet 打开时 + `EventStreamClient` 收到 `turn_ended` 后刷新一次（复用已有的 `TurnBridge.sessionFor` 会话 id，`TurnBridge.kt:262`）。

iOS 侧同形：`hosts/ios/BitBotHost/Sources/BitBotHost/TaskCommandClient.swift` + `TaskCommandSheet.swift`。

**诚实边界**：本沙箱**没有 Swift/Kotlin 编译器**（`scripts/prove_mobile_approval_client.js` 文件头已写明这条），所以端上只能证明「抄的端点与字段名没和服务端漂」，**不能**证明原生代码能编译、不能在真机上点通。真机验收单独列在 §4 批 5 的「诚实残留」里。

---

## 4. 落地顺序（5 个可独立验收的批次）

> 每批只依赖**前面批次已经定义好的接口**；批内不引用任何还没定义的东西。跨批的接口在 §2.3 / §3.2 里已经写死。

### 批 1 · 指挥台改骨架（只改渲染层，不碰数据源）

| 项 | 内容 |
|---|---|
| 改哪些文件 | `hosts/desktop/index.html`（DOM `:2769-2783`；脚本 `:26263-26270`、`:26492-26517`、`:26519-26600`、`:26763-26767`；i18n 三段 `:19102` / `:20611` / `:22120`；语言刷新 `:23099` 的 `wavegLangApply` 尾部）、`hosts/desktop/ui_chrome.css`（新增 `.cmd-panel` / `.cmd-tabs` / `.cmd-tab` / `.cmd-tab-label` / `.cmd-tab-count` / `.cmd-active` / `.cmd-sections` / `.cmd-section` / `.cmd-card` / `.cmd-card-title` / `.cmd-state` / `.cmd-list` / `.cmd-fold` / `.cmd-fold-summary` / `.cmd-fold-count`）、`scripts/prove_command_task_control.js`（TC-30 的 `#cmd-review` → `#cmd-done-list`，**只改这一个 id 字符串**） |
| 不改 | 任何数据源：`product_surface.js` 一个字不动；`data/desktop/tasks.json` 形状不动；`cmdMergeTaskRecords` / `aggregateCommandTasks` 本批**仍在 index.html 里**（批 3 才搬走） |
| 怎么验收 | ① 打开指挥台，第一屏是「要你拍板」区，没有待办时该区不出现；② 四个桶变成可点的 tab，点「在跑」只看 `data-bucket="working"` 的卡；③ 已完区默认折叠，展开后能看到 Task 实体里 `state==="done"` 的批次；④ 值班区折叠；⑤ 复盘区不再单独出现（已并进已完区）；⑥ 插话 / 改向 / 刹停 / 换人四个动作的按钮与回执逐条不变；⑦ 换语言后已打开的面板重画（不残留上一种语言） |
| 验收命令 | `node scripts/prove_copy_contract.js` <br>`node scripts/prove_ui_tokens.js` <br>`node scripts/prove_i18n_render.js` <br>`node scripts/prove_command_panel.js` <br>`node scripts/prove_command_task_control.js` <br>`node scripts/prove_ui_simplicity.js` <br>`ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_desktop_layout_target.mjs` |
| 通过判据 | 以上 7 条命令全部 `FAIL=0`（`prove_i18n_render.js` 在拿不到 Chromium 时是 `rc=2` = SKIP，**SKIP 不算 PASS**，必须在报告里写明没跑） |

### 批 2 · 两档像素回归门（1440×900 / 480×720）

| 项 | 内容 |
|---|---|
| 改哪些文件 | 新增 `scripts/prove_task_axis_pixels.mjs`；新增基线 `docs/design/desktop-target/reference/task-axis-1440x900.png`、`docs/design/desktop-target/reference/task-axis-480x720.png`（**新文件，不覆盖** `live-1440x900-none.png` / `live-480x720-none.png`，那两张是「面板关闭态」的既有基线，`e2e_desktop_layout_target.mjs:44-47` 负责） |
| 依赖 | 批 1（要能打开指挥台并定位新结构） |
| 怎么验收 | 真 Electron（Playwright `_electron.launch`）在 **1440×900** 与 **480×720** 两档下：① 打开指挥台；② 行动区第一张卡**完全在视口内**；③ **无横向滚动**（`scrollWidth ≤ clientWidth`）；④ 桶 tab 数 = 4；⑤ 卡片之间不重叠；⑥ 480 宽下四个动作按钮**逐个可点**（`elementFromPoint` 命中按钮本身）；⑦ 与基线图逐像素比对，差异像素占比 **≤ 0.5%**（用 `scripts/lib_png_pixel.mjs` 的 `decodePng`；自带负向对照：故意改 1% 像素 ⇒ 判据必须翻红） |
| 验收命令 | `node scripts/prove_task_axis_pixels.mjs` <br>刷新基线（要有意识地做）：`BITBOT_TASK_AXIS_SHOT_COMMIT=1 node scripts/prove_task_axis_pixels.mjs` <br>回归两档既有基线：`ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_desktop_layout_target.mjs` |
| 通过判据 | 新门 `FAIL=0`；且 `e2e_desktop_layout_target.mjs` 产出的 `live-1440x900-none.png` / `live-480x720-none.png` 与仓库里已提交的那两张**逐字节一致**（指挥台默认关闭 ⇒ 关闭态像素**不该变**；变了就说明改动漏到了壳层） |

### 批 3 · 抽出共享聚合 + 手机端「看」

| 项 | 内容 |
|---|---|
| 改哪些文件 | 新增 `hosts/shared/task_view.js`；改 `hosts/desktop/index.html`（用 `<script src="../shared/task_view.js">` + 打包态兜底，删掉本地 `cmdMergeTaskRecords` / `aggregateCommandTasks` 实现，改成委派）；改 `hosts/shared/cn_inbound_server.js`（新增 `GET /v1/tasks`）；新增 `scripts/prove_task_view_http.mjs` |
| 依赖 | 批 1（`aggregateCommandTasks` 仍在 index.html 里，先搬走再改路由） |
| 不改 | `product_surface.js` 不动；`data/desktop/tasks.json` 不动；**不新增任何文件作为数据源** |
| 怎么验收 | ① `GET /v1/tasks` 返回的清单，与桌面指挥台同一份数据算出来的清单**逐条一致**（同一份 fixture：rooms + tasks ⇒ 两边条数、桶分布、`task_sig` 集合都相同）；② **桌面关闭态**下 `GET /v1/tasks` 与桌面指挥台的清单一致（证明没有第二份真相）；③ 鉴权：不带签名 ⇒ 401；带签名 ⇒ 200；**带 bearer 且登记表非空 ⇒ 401**；④ `task_sig` 里的 `\|` 走 `encodeURIComponent` 后仍能命中；⑤ 没有任务时返回 `{"ok":true,"count":0,"tasks":[]}`，**不编**一条 |
| 验收命令 | `node scripts/prove_task_view_http.mjs` <br>`node scripts/prove_command_panel.js`（聚合改委派后仍要绿） <br>`node scripts/prove_copy_contract.js` <br>`node scripts/prove_ui_tokens.js` |
| 通过判据 | 两条命令全绿；`prove_task_view_http.mjs` 的断言 ①③ 必须**真起一个入站服务**（不起服务只测函数不算） |

### 批 4 · 手机端「指挥」（插话 / 改向 / 刹停 / 换人）

| 项 | 内容 |
|---|---|
| 改哪些文件 | 改 `hosts/shared/cn_inbound_server.js`（新增 4 条路由 + **只认设备签名**的鉴权）；改 `hosts/desktop/main.js`（`createCnInboundServer({…})` 处 `main.js:5128` **注入 `surface`**，`surface` 已在 `main.js:823`）；改 `hosts/shared/product_surface_ref.js`（保留为回落：注入存在时优先用注入的）；新增 `scripts/prove_task_command_http.mjs` |
| 依赖 | 批 3（`task_sig` 的编码/形状、清单字段已经在批 3 定死） |
| 不改 | 四个动作的**语义**一个字不改（沿用 `product_surface.js:2708/2743/2763/2618`）；IPC 面不动（桌面继续走原路） |
| 怎么验收 | ① **插话**：真起一轮 → 手机端 POST `/steer` → 共享板里出现该条、群里转录出现 `task_state/steered`；② **改向**：POST `/replan` → 转录出现 `task_state/replanned` 且**真的重跑了**（有一轮新的 `bot_reply`）；③ **刹停**：真起一个在跑的任务 → POST `/cancel` → 返回 `{"ok":true,"cancelled":1}`，且任务从「在跑」掉出去；**负向**：对不在跑的任务再点 ⇒ `409 no_running_task`（**不假装停掉了什么**）；④ **换人**：POST `/swap` → 转录出现 `task_state/reassigned`；**负向**：换成不在群里的人 ⇒ `409 bot_not_in_room`；⑤ **注入生效**：HTTP 侧发出的取消能被桌面主进程那份 `_taskScopes` 命中（这一条是批 4 的核心，不做这层断言就等于没验跨实例那个坑）；⑥ 鉴权：bearer 一律 401 |
| 验收命令 | `node scripts/prove_task_command_http.mjs` <br>`node scripts/prove_command_task_control.js`（桌面侧四个动作不许回归） <br>`node scripts/prove_approval_scope.js`（审批语义不许被顺手改掉） |
| 通过判据 | 新门 `FAIL=0`，且断言 ③⑤ 必须**真跑一轮再真取消**（stub 不算） |

### 批 5 · 手机端界面（Android / iOS）

| 项 | 内容 |
|---|---|
| 改哪些文件 | 新增 `hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/TaskCommandClient.kt`、`.../ui/TaskCommandSheet.kt`；改 `.../MainActivity.kt`、`.../ui/Sheets.kt`；新增 `hosts/ios/BitBotHost/Sources/BitBotHost/TaskCommandClient.swift`、`TaskCommandSheet.swift`；新增 `scripts/prove_mobile_task_client.js` |
| 依赖 | 批 4（端点与字段名必须先定死） |
| 怎么验收 | ① **结构门**（与 `scripts/prove_mobile_approval_client.js` 同形）：Android 与 iOS 抄的端点路径、字段名、决定词表与服务端源码**逐字对齐**（脚本会剥注释再抠字面量，避免被注释里的字符串骗过 —— 那个坑在 `prove_mobile_approval_client.js` 的文件头写着）；② Android JVM 单测：真 SSE 帧 / 真 JSON → Compose 屏上出现对应行（照抄 `EventStreamUiWiringTest` 的形态，`prove_android_event_stream.mjs` 覆盖的那一层）；③ 端上不新增可见文案硬编码（三语 key 对齐现有 `EventStreamMessages.kt` 的 locale 口径） |
| 验收命令 | `node scripts/prove_mobile_task_client.js` <br>Android 单测：`cd hosts/android/BitBotHost && ./gradlew :app:testDebugUnitTest` <br>iOS：沙箱无 Swift 编译器 ⇒ **只跑结构门**，真机验收留作残留 |
| 诚实残留 | **端上能编译、真机点通**在沙箱里不可验证（`prove_mobile_approval_client.js` 文件头已写明这条限制）。批 5 的完成判据只到「端点/字段/文案对齐 + JVM 渲染级单测绿」，**真机验收单列**，不许拿结构门冒充真机通过 |

### 批次依赖一览

```
批 1（渲染层骨架）
   └─► 批 2（两档像素门）
   └─► 批 3（共享聚合 + GET /v1/tasks）
             └─► 批 4（四个指挥路由 + surface 注入）
                       └─► 批 5（端上界面）
```

批 2 只依赖批 1 的 DOM 形状；批 3 只依赖批 1 的「聚合函数在哪」；批 4 只依赖批 3 定死的 `task_sig` 编码与清单字段；批 5 只依赖批 4 定死的端点与字段。**没有一批依赖任何还没定义的东西。**

---

## 5. 风险与不做的事

### 5.1 风险（每条都有对应的缓解动作，不写「注意一下」）

| # | 风险 | 触发点 | 缓解（落到具体改动） |
|---|---|---|---|
| R-1 | 动了 DOM ⇒ 既有门禁的红不是产品坏了，是尺子要跟着换 | 删 `#cmd-review`、桶改 tab | 批 1 里**同批**改 `scripts/prove_command_task_control.js` 的 TC-30（只改一个 id 字符串）；不许把断言删掉换绿 |
| R-2 | 复制契约破防：新增 `data-i18n-*` 忘了补三语 ⇒ 界面直接显示键名 | 批 1 新增 5 个键 | 三个语言段**同一批**补（`index.html:19102` / `:20611` / `:22120`）；`prove_copy_contract.js` 的 CC-03/CC-05 会当场红 |
| R-3 | CSS 硬编码色值/行内字号把棘轮顶爆 | 批 1 新增 `.cmd-*` 类 | 新样式全进 `ui_chrome.css` 且只用 `var(--token)`；不写行内 `font-size`；`prove_ui_tokens.js` 的 T-1/T-2/T-3/T-4 全绿才算过 |
| R-4 | 指挥台变宽/变高 ⇒ 破 480×720 的窄窗合同 | 批 1 / 批 2 | 批 2 的新门直接断「无横向滚动 + 按钮可点」；`e2e_desktop_layout_target.mjs` 的 D-L-13 兜底 |
| R-5 | **门禁把工作树弄脏**：像素门往已跟踪文件里写图 | 批 2 | 基线写 `/tmp` 默认路径，**入仓必须显式** `BITBOT_TASK_AXIS_SHOT_COMMIT=1`（照抄 `e2e_desktop_layout_target.mjs:39-47` 的做法与它写的理由） |
| R-6 | 聚合逻辑两份实现 ⇒ 桌面与手机显示不同 | 批 3 | 聚合只留 `hosts/shared/task_view.js` 一份；渲染层改成委派；新门加一条「`index.html` 里不再出现 `function aggregateCommandTasks`」 |
| R-7 | 手机端「刹停」永远返回 `no_running_task` | 批 4 | 必须注入同一份 surface（`main.js:5128`）；批 4 的断言 ⑤ 专门钉这一条 |
| R-8 | 手机端「改向」只改了字、没真的重跑 | 批 4 | 改向要触发 `surface.orchestrateRoom({force:true})`；断言 ② 要求**真的多出一轮 `bot_reply`** |
| R-9 | 控制面鉴权被抄成 `/v1/turn` 那种「登记为空就回落 bearer」 | 批 4 | 控制类路由**只认设备签名**；断言 ⑥ 钉死 bearer 必 401 |
| R-10 | 端上抄的端点/字段漂移 | 批 5 | `scripts/prove_mobile_task_client.js` 把端点与字段**钉在服务端源码的字面量上**（与 `prove_mobile_approval_client.js` 同形） |
| R-11 | 真机不可验证被当成「已通过」 | 批 5 | 批 5 的完成判据只到结构门 + JVM 单测；真机验收单列残留 |
| R-12 | `data/desktop/tasks.json` 里 46 条全是 `done`，「在跑」没有实体状态 | 批 1 / 批 3 | UI 文案继续按「从转录推」说（`index.html:26416`）；**这一轮不新增 `running` 态的写入方**（那是另一件事，别混进来） |

### 5.2 这一轮明确不做的事

| 不做 | 为什么 |
|---|---|
| **不抄 Marketplace / 不做模板市场的任务化改版** | 这一轮的主键是「真实用户旅程」，任务轴；Marketplace 是另一条产品线，动它会污染本轮的验收口径 |
| **不做 Hosted Server / 不做云端常驻机器** | 与 ADR 0014 不变量 I6 冲突（云只见元数据与密文、不落内容）；`docs/design/desktop-target/cross-end-roadmap-a.md` §0 明确把「Grok 那种云端电脑」列为**不在计划内**，且要求先立一份新 ADR 才能开工 |
| **不做多人付费 / 不做团队席位 / 不做计费** | 账号 = 设备密钥对（`docs/next-target-requirements.md` §1「引入 SaaS 账号体系」是明令不做项） |
| **不做邮箱 / 手机号注册、不做账号密码** | 同上；配对 = 设备密钥对（`cn_inbound_server.js:1314-1341`） |
| **不新增第二份任务数据源**（不建新的 tasks 存储、不建独立的任务库） | Task 实体只有 `data/desktop/tasks.json` 一份（`product_surface.js:324`）；本轮只允许改**读它的顺序**和**画它的方式** |
| **不改聊天流的布局与信息密度** | 聊天是任务的**一个视图**，不是主轴；这一轮不碰它，避免两处大改互相盖 |
| **不删插话 / 改向 / 刹停 / 换人里的任何一个** | 四个动作都在（`product_surface.js:2708/2743/2763/2618`），语义（`next_hop` 等）一个字不改 |
| **不改审批语义、不放宽审批作用域** | 「总是允许」是作用域规则（`scripts/prove_approval_scope.js`）；这一轮原样保留，批 4 顺带跑一次它的门 |
| **不改内核的机器表**（不把 seed 出来的固定花名册改成动态目录） | `box_host/machines.mbt` 的 seed 是内核既有事实；`machine_presence.js` 才是「谁真的在线」的唯一证据源 |
| **不新增 Task 实体的 `running` 状态写入方** | 会让「状态以 Task 实体为准」（`index.html:26409`）的判定口径变复杂；这一轮的口径是「在跑 = 从转录推」 |
| **不做多租户 / 不做「这台机器只给某个群看」** | 设备签名证明的是「你是登记过的设备」，不证明「你只该看这一个群」；如实登记为残留（与 `cross-end-roadmap-a.md` §6.1 的 R-A1-1 同源） |
| **不承诺真机通过** | 沙箱无 Swift/Kotlin 编译器、无真机（`prove_mobile_approval_client.js` 文件头） |
| **这一轮不改任何产品代码** | 本文档只出方案；落地是下一轮的事 |

---

## 附录 A · 新增 / 复用的键与选择器总表

**复用（零新增）**：`cmdNeedsYou` `cmdWorking` `cmdWaiting` `cmdClosed` `cmdDuty` `cmdDutyEmpty` `cmdDutyNext` `cmdDutyDone` `cmdDutyNever` `cmdDutyOff` `cmdDutyUnknownTime` `cmdSteer` `cmdReplan` `cmdCancel` `cmdSwap` `cmdOpenRoom` `cmdClose` `cmdRefresh` `cmdHint` `cmdEmpty` `cmdMembers` `cmdPartial` `cmdArchived` `cmdSteered` `cmdReplanned` `cmdStopped` `cmdSwapped` `cmdCmdEmpty` `cmdCmdFailed` `cmdStopFailed` `cmdSwapFailed` `cmdCmdPlaceholder` `cmdUnavailable`

**新增 5 个（三语各 1 条，共 15 条）**：`cmdActiveTitle` `cmdRunningTitle` `cmdDoneTitle` `cmdMoreCount` `cmdSteerScopeHint`

**保留不动的选择器**：`#command-panel` `#cmd-buckets` `#cmd-detail` `#cmd-duty` `#cmd-hint` `#cmd-refresh-btn` `#cmd-panel-close` `#cmd-open-btn` `.cmd-input` `.cmd-step` `.cmd-step-name` `.cmd-step-text` `.cmd-step-bad` `.cmd-tag` `.cmd-actions` `.cmd-command` `.cmd-room` `.cmd-line` `.cmd-sub` `.cmd-note` `.cmd-note-box` `.cmd-sec-title` `.cmd-duty-row` `.cmd-review-row` `[data-cmd-task]` `[data-cmd-steer]` `[data-cmd-replan]` `[data-cmd-cancel]` `[data-cmd-swap]` `[data-cmd-swap-task]` `[data-cmd-swap-room]` `[data-cmd-open-room]`

**新增选择器**：`.cmd-panel` `.cmd-tabs` `.cmd-tab` `.cmd-tab-label` `.cmd-tab-count` `.cmd-active` `.cmd-sections` `.cmd-section` `.cmd-list` `.cmd-card` `.cmd-card-title` `.cmd-state` `.cmd-fold` `.cmd-fold-summary` `.cmd-fold-count` `#cmd-active` `#cmd-active-list` `#cmd-done` `#cmd-done-list` `#cmd-done-count` `#cmd-duty-list` `#cmd-duty-count` `[data-cmd-tab]` `[data-cmd-state]` `[data-cmd-step]` `[data-bucket]` `[data-task-sig]`

**删除**：`#cmd-review`（容器）· `cmdRenderReview`（函数）· `#command-panel` 的行内 `style` 属性
