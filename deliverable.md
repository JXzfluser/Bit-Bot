# 交付 · P1 任务轴 + 手机可指挥 方案（T4-P1）

> 本轮**只出文档**，没有改任何产品代码。方案落地是下一轮。
> 仓库：`/workspace/src/Bit-Bot-cursor-desktop-layout-target-v2`（物理路径 `/run/csi/mount-root/nas/eab0d61a99b6696edb3d2aff87b585e8/src/Bit-Bot-cursor-desktop-layout-target-v2`，同一目录）
> 分支：`team/t4-p1-plan`（新建，**未 push**）

## 文档路径

- 方案正文：`docs/design/p1-task-axis-and-mobile-command.md`（仓库内，55 KB+）
- 本文件：`deliverable.md`（仓库根）与 `/workspace/output/t4-p1-task-axis-mobile-plan.md`（两份内容相同）

## 方案要点摘要

### 1. UI 形态重构（任务为主轴）

**现状（证据）**：指挥台在 `hosts/desktop/index.html:2772-2783`，四块 DOM —— `#cmd-buckets`（四个状态桶**只渲染计数**，`index.html:26519-26534`）、`#cmd-detail`（**平铺**的任务列表，`index.html:26536-26588`）、`#cmd-duty`（值班）、`#cmd-review`（复盘）。Task 实体落 `data/desktop/tasks.json`（实测 46 条，`state` 全为 `done`），**唯一同步点** `syncTaskFromTranscript` 在 `hosts/desktop/product_surface.js:2499`，挂在 `appendRoomTranscript`（`:2532`）内部。

**要做的**：把四个状态桶从「只计数」改成**可点的 tab**；在桶之前加**行动区**（只放 `bucket==="needs_you"`，最多 3 条）；列表按桶分栏；**复盘区并进已完区**（同源，不新增数据源）；值班区降为折叠区；删掉 `#command-panel` 的行内 `style`。DOM 清单共 15 条（D-1..D-15），逐条写到选择器级。**不删**任何 `data-cmd-*` 动作属性、`.cmd-input`、`.cmd-step*`、`.cmd-tag`、`#cmd-detail` 这个 id。

**用户动线**：打开 → 首屏是「要你拍板」那件事 → 点 tab「在跑」找到在跑的那件 → 同一张卡的输入框写一句 → 插话（下一棒看见）/ 改向（立刻重跑）/ 刹停（精准命中一个 task_sig）/ 换人（读同一张卡的输入框当新人选）。

**门禁合规**：新增 5 个 i18n 键（`cmdActiveTitle` / `cmdRunningTitle` / `cmdDoneTitle` / `cmdMoreCount` / `cmdSteerScopeHint`），**zh-CN / zh-TW / en 三份同时补**（插值用 `t(key, params)`，不用「中文前缀 + 变量」）；新 CSS 全走 `var(--token)`、不写行内 `font-size`、不写 `!important`、不用 `[style*=`；`prove_copy_contract.js` / `prove_ui_tokens.js` / `prove_i18n_render.js` / `prove_command_panel.js` / `prove_command_task_control.js` / `prove_ui_simplicity.js` / `e2e_desktop_layout_target.mjs` 全绿才算过；1440×900 与 480×720 两档像素回归由**新增门** `scripts/prove_task_axis_pixels.mjs` 承担（基线是新文件，不覆盖既有 `live-*.png`）。

### 2. 手机端「能指挥」

**现状（证据）**：入站 HTTP 面已有 `/v1/turn`（`hosts/shared/cn_inbound_server.js:1376`）、`/v1/events`（`:1514`）、`/v1/approvals` + `/v1/approvals/<id>/decide`（`:1040` / `:1067`）、`/v1/pair/redeem`（`:1280`，带 `device_public_key` 就登记设备）。手机侧已有设备签名（`hosts/android/.../DeviceIdentity.kt`、`hosts/ios/.../DeviceIdentity.swift`）与审批客户端（`ApprovalClient.kt:71-129` / `ApprovalClient.swift`）。跨机执行靠 `box_host/machines.mbt` 的机器表 + `hosts/shared/machine_presence.js` 的真实在线证据。

**要做的**：新增 `GET /v1/tasks` 与 `POST /v1/tasks/<sig>/{steer,replan,cancel,swap}` 五条路由（`task_sig` 含 `|` ⇒ 强制 `encodeURIComponent`）；**控制面只认设备签名**，bearer 一律 401；把 `hosts/shared/task_view.js` 抽出来做**唯一一份**聚合逻辑，桌面渲染层与 HTTP 面共用（不许两份实现）；`hosts/desktop/main.js:5128` 把主进程那份 surface **注入**入站服务，解决「另一个实例的 `_taskScopes` 是空的 ⇒ 刹停永远 `no_running_task`」这个坑；改向必须**真的触发** `surface.orchestrateRoom({force:true})`，否则界面会说谎。

**安全边界**：账号 = 设备密钥对；审批「总是允许」是**作用域规则**不是万能钥匙（`scripts/prove_approval_scope.js`）；所有写操作落**可审计**的 `task_state/*` 转录行；诚实登记残留 —— 设备签名只证明「你是登记过的设备」，**不证明**你只该看某一个群（单机单账号，不是多租户）。

### 3. 落地顺序（5 个可独立验收的批次）

批 1 指挥台骨架（只改渲染层）→ 批 2 两档像素回归门 → 批 3 抽共享聚合 + 手机端「看」→ 批 4 手机端「指挥」+ surface 注入 → 批 5 端上界面（Android/iOS）。每批给出「改哪些文件 + 怎么验收 + 验收命令」，批与批之间只依赖已定义好的接口。

### 4. 不做的事

不抄 Marketplace、不做 Hosted Server、不做多人付费、不做邮箱/手机号账号体系、**不新增第二份任务数据源**、不改聊天流布局、不删四个指挥动作、不改审批语义、不改内核机器表、不新增 `running` 态写入方、不做多租户。

## 每条能力：已有 / 需新增

| 能力 | 判定 | 证据来源 / 缺口 |
|---|---|---|
| Task 实体（跨会话任务状态） | **已有** | `hosts/desktop/product_surface.js:324-370`；`data/desktop/tasks.json` |
| Task 状态唯一同步点 | **已有** | `hosts/desktop/product_surface.js:2499-2530`（挂在 `appendRoomTranscript` `:2543`） |
| 插话（下一棒看见） | **已有**（仅桌面） | `product_surface.js:2743-2757`；`preload.js:154`；`main.js:3128` |
| 改向（换目标并重跑） | **已有**（仅桌面） | `product_surface.js:2763-2779`；`main.js:3136-3149` |
| 刹停（精准命中 task_sig） | **已有**（仅桌面） | `product_surface.js:2567,2618-2636`；`main.js:3152-3170` |
| 换人（下一棒生效） | **已有**（仅桌面） | `product_surface.js:2708-2736`；`preload.js:156` |
| 共享板（插话落点，跨进程可见） | **已有** | `hosts/desktop/room_orchestrator.js:61-64` → `data/agents/sections/` |
| 手机看任务列表 | **需新增** | `GET /v1/tasks`；入站面 0 条 task 路由（`cn_inbound_server.js` 全文实测） |
| 手机插话 / 改向 / 换人 | **需新增** | 三条 `POST /v1/tasks/<sig>/*`；这四个函数今天只挂在 Electron IPC 上 |
| 手机刹停 | **需新增（且不能照搬）** | 需要 `POST /v1/tasks/<sig>/cancel` **加**跨实例取消通道：`_taskScopes` 是工厂内内存 Map（`product_surface.js:2567`），HTTP 侧是另一个实例（`hosts/shared/product_surface_ref.js:31-37`） |
| 手机批审批 | **已有** | `cn_inbound_server.js:1021-1110`；`ApprovalClient.kt` / `ApprovalClient.swift` |
| 手机看这一轮实时进度 | **已有** | `cn_inbound_server.js:1514-1660`；Android `EventStreamClient.kt` |
| 手机发新一轮指令 | **已有** | `cn_inbound_server.js:1376` |
| 手机端选「哪台机器/哪个人」 | **不做（登记为残留）** | 内核机器表是 seed 出来的固定花名册（`box_host/machines.mbt`） |
| 桌面四桶 → 可点 tab + 行动区 + 分栏 | **需新增**（本轮方案） | 现状 `#cmd-buckets` 只出数字（`index.html:26519-26534`）、列表平铺（`:26536-26588`） |
| 复盘区并进已完区 | **需新增**（本轮方案） | 两者同源：Task 实体 `state==="done"`（`index.html:26492-26498` 与 `:26411`） |
| 三语文案（新增 5 键 × 3 语） | **需新增** | `index.html:19102` / `:20611` / `:22120` 三段同批补 |
| 1440×900 / 480×720 像素回归门 | **需新增** | 新脚本 `scripts/prove_task_axis_pixels.mjs`；既有 `scripts/e2e_desktop_layout_target.mjs:306,480-570` 只覆盖窄窗几何 |
| 真机端上点通 | **不做（诚实残留）** | 沙箱无 Swift/Kotlin 编译器、无真机（`scripts/prove_mobile_approval_client.js` 文件头已写明这条限制） |

## 诚实声明

- 本轮**没有改任何产品代码**，只新增了 `docs/design/p1-task-axis-and-mobile-command.md` 与本交付文件。
- 方案里凡是需要改的地方，都写到了「文件 + 行号 + 改成什么」；凡是没证据的，写的是「需要新增」。
- 方案对任务描述里的「四桶(Task / 转录 / 值班 / 复盘)」做了**口径更正**：代码里的实际形态是「4 个状态计数桶 + 一张平铺任务列表 + 值班区 + 复盘区」，方案按代码事实写。
- 落地是下一轮的事；本文件不代表任何能力已经实现。
