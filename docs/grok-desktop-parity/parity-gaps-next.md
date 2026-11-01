# Grok Bot 桌面端复刻 — 剩余功能清单与规范（Wave G 后续）

> 依据：官方规格 `/app/grokspec/grok-bot-spec.md`（17 页全文，抓取 2026-10-19）逐节交叉比对现有 `spec.md`（GP-01..133）与 `gaps.md`（Wave M4..M45）逐条状态 + `docs/capability-matrix.md`（234 CM）。
> 分支：`cursor/desktop-layout-target-v1`。判定口径沿用仓库三态：**已实现 / 残留（诚实，不 pretend）/ 未做**。
> 本文只列**尚未闭合**的功能，不重复已绿项。每项给「官方行为 §→ 落点 → 可证伪验收」，编号顺延 GP-134 起。

## 结论速览

Grok 桌面复刻的主体功能面已经打满：Bot 生命周期、Composer、审批/Auto-review、Computer/Take over、草稿、群聊、语音、Settings、通知、文件/交付、密钥不进上下文、Untrusted fence、隐私模式、先读后执行、跨会话记忆、主窗口结构、Usage、附件预览、消息反应——均有 GP 行且有 `smoke_grok_desktop_parity.sh`（当前 PASS=313 FAIL=0）+ 真 Electron/Playwright 门覆盖。

**真正还差的，集中在六类**：自动化（事件触发 / 最小间隔 / Teach a task）、Skills 来源分类呈现、Cloud Agent 结果闭环、共享 Computer 模型的跨 Bot 可见性 + 关窗不中断、Auto-review「独立评审通道」可证伪化、附件损坏/加密不可读诚实拒绝。另有两项**明确延期**（跨平台安装包、移动端同步），属发布工程与平台范围，不是行为对等缺口。

---

## 〇、核心叙事：多 Bot 协作编排回路（本次梳理的正主）

Grok 桌面的内核不是"建一个 Bot"，而是**多个不同职责的 Bot 在群里被派活、各自用自身能力真干活、最后汇总出一份可交付的汇报**。本波一切缺口都围绕这条主线组织——**内核原语已备齐，缺的是把它们在桌面上缝成一个闭环，而不是把调试台按钮搬到产品里**。

### 主线八步 × 内核原语映射

| 步 | 主线动作 | 内核已有原语（散点） | 桌面现状 | 归属 |
|----|----------|----------------------|----------|------|
| 1 | 各 Bot 带自身职责（job/description + 自己的工具/Computer/连接器/记忆） | `bots.json` + 每 Bot 记忆槽 + 各 effect kind | ✅ 已实现 | GP-01/03/120、GP-111/112 |
| 2 | 拉群（2–6 Bot，命名/成员） | `GroupChat(bots_csv,title)` + rooms store | ✅ 已实现 | GP-50/119a |
| 3 | 群里 `@` 派活（明确谁干什么） | `RoomTurn` @-路由（mentioned_only/all/discretion） | ✅ 已实现（仅路由） | GP-51 |
| 4 | **被点名的 Bot 各自按职责真正执行并产出** | `HandoffTask`/`SendToAgent`/`AddSection`/`SectionPost`/`SpawnSubagent`/`LaunchCloudAgent` + 各成员 effect | ✅ **Host 产品路径已闭环**（每 responder 真回合 + persona/记忆注入 + `speaker=bot_id` 落 transcript）；内核 `Orchestrate` 意图等价**未做** | **GP-143（已实现）/GP-146** |
| 5 | 多路任务并行、互不串（每路一个分区） | `AddSection`/`SectionPost`（CM-1403 分区隔离）内核 Ready | ✅ 已实现（并行 fan-out + 每路独立 `bot_reply` 分区，互不串 persona）；内核 `AddSection` 复用未做 | **并入 GP-143/144（已实现）** |
| 6 | 敏感动作逐个走审批/草稿门（购买/外发/删除；记忆不授权） | `gate_consequential` + `DraftOnly` + `memory_grants_send=false` | ✅ 已实现，并已套用到每个成员动作（群回合固定 `approved:false`，编排不额外放行） | GP-20–42、GP-108–110/115 |
| 7 | **编排者（主 Bot）收齐各成员产出 → 汇总最终汇报**（引用各成员结论 + 产物文件卡） | `WakeParent`（CM-1208）+ `DeliverCloudArtifact`（CM-2148） | ✅ 已实现（`orchestrateRoom` 收齐 → `kind:"final_report"` + N/总 + partial 如实）；cloud/subagent 回流仍依赖 GP-136 | **GP-144（已实现）+ GP-136** |
| 8 | 全程进度可视 + 最终报告可存/可全屏 | `turn_progress` + artifact 链 | ✅ 已实现 | GP-90/92/96–98 |

### 关键纪律（回应"别搬调试台"）

- 调试台里 `connect-finance` / `x post` / `job search` / `mcp call` 等是**成员 Bot 在第 4 步干活时可被调用的手段**，不是产品入口。它们**保持 `data-lab` 隐藏**；当某成员 Bot 在其职责范围内、经审批门真需要时才调用，结果作为该成员产出汇入第 7 步的汇报——**不为它们新建任何产品级按钮/面板**。
- 第 4/5/7 步是"组织核心"：把 `room_turn → per-responder 真回合 →（可并行 sections / 可派 subagent / 可起 cloud agent）→ 收齐 → final_report 卡` 缝成一条**用户可感知、可验收**的回路，而不是并列地把内核每个能力都做成 UI。

### 由此确定的本波核心工作包（取代按"暴露能力"排期）

- **GP-143（先做）**：`room <id> :: @BotX …` 从"记一条路由"升级为"对每个 responder 各起一个真回合"，注入该 Bot 的 `job/description` + 记忆槽作上下文，经审批门用其自身工具产出，各写一条 `speaker=bot_id` 的 transcript 回复；并行子任务用 `AddSection` 分区，长任务可 `SpawnSubagent`/`LaunchCloudAgent`。
- **GP-144（后做，依赖 143）**：编排者收齐 responder 产出（含 cloud/subagent 经 GP-136 回流的产物），跑一次汇总回合，写群内 `kind:"final_report"` 卡 + 附产物文件卡；未收齐如实显示 N/总，不假装有报告。
- 其余 A/B/C 类（事件触发、Skills 来源、共享登录态、附件不可读等）是**支撑主线的边角**，优先级让位于 GP-143/144，按原 Wave M47+ 排。

---

## 一、分类清单

### ★ 核心工作包（第 4 / 5 / 7 步；优先级最高，M46）

| ID | 主线 | 缺口 | 现状证据 |
|----|------|------|----------|
| GP-143 | 步 4/5 | **被 @ 的 responder 各起真回合** | `product_surface.js:1253 roomTurn()` 仅算 `responders`/`responder_policy`（all/mentioned_only/bot_discretion）写一条路由；`host_ffi.js:10704` room_turn 走 fanout 到各成员 inbox、`pretend_private_dm:false`，**不驱动 responder 的 LLM 回合**。全仓无 `Orchestrate`/`final_report` 意图。 |
| GP-144 | 步 7 | **编排者收齐 → 汇总 final_report** | 依赖 GP-143；`WakeParent`(CM-1208) 可唤醒、`DeliverCloudArtifact`(CM-2148) 可落产物，但无「收齐各 responder 产出 + 跑一次汇总回合 + 写 `kind:"final_report"` 卡」的意图与门。 |
| GP-145 | 步 3/4 用户面 | **Bot 私聊与群协作上下文不串** | DM 保持 `activeBotId` 的 job/description/记忆，群回合不得污染 DM 会话；审批/密钥请求留在归属 Bot 的 DM。 |
| GP-146 | 步 4/7 用户面 | **群 transcript 按条目渲染 + 运行中状态** | `index.html` 把 `rooms.json` 行拼成一段纯文本，用户看不出谁在说话、谁在跑、报告是否收齐；无 per-Bot「工作中」态，失败无 `bot_reply_error` 呈现。 |

> **实施状态（M49 · GP-143/144/145/146/147 用户级闭环 + 诚实性细节波，Host 产品路径，已验证）**：
> - **真回合接线**：`main.js` `runRoomResponderTurn` 在 `runner.runTurn(text,{botId,…})` 上跑每个 responder 的独立回合（该 Bot 的 job/description/记忆槽/工具，persona 由 `host_ffi.llmSystemPrompt(botId)` 在 provider 边界现读注入）；群 composer 走专用 IPC `bitbot:rooms:orchestrate` = `roomTurn`（路由 + 落 user 行，单一写入点）→ `orchestrateRoom({room,task,to:responders,deps:{runResponderTurn}})`，`preload` 暴露 `rooms.orchestrate`。`@A @B`→只跑点名者、`@everyone`→全员、无 `@`→`bot_discretion`；成员/预算 ≤6/递归/幂等/超时护栏保持。
> - **诚实口径**：这是 **Host 产品路径**闭环，内核 `Orchestrate`/`final_report` 意图等价**未做**，不声称与内核原语同构。
> - **门（本沙箱实跑，细节波后复跑）**：真渲染 `scripts/e2e_desktop_room_orchestration.mjs` **PASS=51 FAIL=0 SKIP=0**（真 Electron + 真 `moon` + 本地 OpenAI 兼容 provider；S1–S9 含 2 responder 成功、故意失败 1 个 → `1/2 未收齐（部分完成）`、`@` 点名、`@everyone`、递归、幂等、非成员、超时、reopen 后 DOM↔`rooms.json` 逐类相等、旧无 `kind` 行不崩、转录卫生、DM persona 归属、`sessions.json` 无群行；S10–S14 为细节波新增：持久面有界、幂等不闪运行态、未命中点名如实告知、坏 `rooms.json` 读侧如实 + 写侧拒绝 + 恢复后画面与崩溃前一致、群被移出目录自动退出）；`prove_gp143_orchestration` **PASS=36 FAIL=0**、`prove_m29_roomchat` **PASS=40 FAIL=0**、`e2e_grok_desktop_boot` **PASS=127 FAIL=0**、`smoke_grok_desktop_parity` **PASS=321 FAIL=0**、D-C-03 三语 **502** 键。
> - **同轮细节波（GP-147）修掉 5 个会让人误判事实的缺陷**：拒绝/幂等说明卡被整表重绘吃掉（一闪就没）、未真扇出就闪「工作中」、共享转录逐字段无界、失败原因把协议码/上游原文摊到产品面、**坏 `rooms.json` 被演成「历史没了」且会被下一次写原子覆盖成空目录**（现：读侧 `roomsStoreStatus` 如实报 `unreadable`、写侧 `requireWritableRooms` fail closed 拒绝落盘、`rooms:list`/`rooms-changed` 带 `ok`、渲染层区分「空群」与「读不到」、群被移出目录自动退出、内核 effect 层 try-catch 不炸批）。
> - **顺带修掉两个真产品缺陷**：① 群 composer 不独占——点 Bot 私聊/切会话后仍把消息发进群（现 `selectBotForChat` 与会话行点击均 `exitRoomChat()`）；② 群聊卡片色写死十六进制，破 `prove_ui_tokens` T-2 ratchet 且暗色不正确（改 `--danger/--danger-ink/--warn/--warn-line/--warn-ink`）。
> - **残留（如实，不伪造）**：① 内核 `Orchestrate` 意图 + `moon test` 等价未做；② `pending-approvals.jsonl` 行不带 `bot_id`，因此「审批只出现在归属 Bot 的 DM」尚未成立——现由「群回合固定 `approved:false`、不新增自动放行」保证不被编排放行，路由归属待审批行加 `bot_id`；③ cloud/subagent 回流产物进汇报仍依赖 GP-136；④ 真实外部 provider/云 VM/Cookie 仍为既有残留。

### A. 内核已有、桌面复刻层未接线（补 UI + 验收即闭合）

| ID | 官方 § | 缺口 | 现状证据 |
|----|--------|------|----------|
| GP-134 | 6.2 | **事件触发 Routine 桌面接线** | 内核有 `Trigger::Event/Interval`（`routines/types.mbt:2-6`）+ CM-0406~0409/2106 全 PASS，但桌面回合 `CreateRoutine(id, cron, prompt)` **仅 cron**（`turn_json.mbt:79`、`parity_intents.mbt:1798`），renderer 创建例程只出 cron 字段。 |
| GP-135 | 6.3 | **Skill 三来源在 `/` 菜单与 Connect apps 的呈现** | 内核枚举 `SkillSource::{Managed,User,Plugin}` + `ManagedCatalog`（`skills/catalog.mbt:92-95`）、CM-0501/0506 PASS，但桌面 `/` 补全与 Connect apps「Manage plugins and skills」未按来源分组、无「缺 Skill→Connect apps」引导。 |
| GP-136 | 9.1 | **Cloud Agent 结果文件落 Computer + 附回对话** | CM-2131（cursor-agent 卡）/CM-2148（云产物 `/workspace/cloud-agent-artifacts/<bc>/` 路径约束）PASS，但桌面 GP 无「Bot 把云代理报告引用文件复制进 Computer 并附到回复」的回合与验收。 |

### B. 完全缺失（内核 + 桌面都无）

| ID | 官方 § | 缺口 |
|----|--------|------|
| GP-137 | 6.1 | **Teach a Task 跟练→Skill 草稿**：录制一次 Computer 工作流 → 生成**草稿态** Skill（需人工补决策规则/失败处理/审批边界）。全仓无 `teach` 意图；spec.md 仅在「诚实残留」里写过一句，无 GP 行、无门。 |
| GP-138 | 6.2 | **Routine 最小间隔 ≥5 分钟护栏**：官方「Routine 间隔至少 5 分钟」。桌面 create/schedule 路径未见校验，可接受 `cron=* * * * *` 逐分钟。 |
| GP-139 | 3.1 | **关闭应用/合盖不中断后台任务**的可证伪断言：`host_routine_daemon.sh` 实为分离进程，但没有一条门断言「Electron 退出后 due routine 仍触发」。 |

### C. 共享模型 / 深度（可做本地可证伪断言，真实环境标残留）

| ID | 官方 § | 缺口 | 本地可证 vs 残留 |
|----|--------|------|------------------|
| GP-140 | 3.1 | **跨 Bot 共享 Computer 浏览器会话/Cookie 可见性**（"一个 Bot 登录的网站对其他 Bot 可用"） | 可证：共享浏览器 profile 目录/登录态落同一 `computer.json` 且 Bot B 读到 Bot A 的登录标记；残留：真实云 VM microVM 与真 Cookie 沙箱不可达（同 `sandbox_screen` 口径）。 |
| GP-141 | 8.1 | **Auto-review「独立于 Bot」评审通道** + 团队「Enforce Auto-review」锁定优先级 | 可证：评审判定来源与 Bot 回复模型分离、团队规则优先于个人、Ask first > Allow automatically；残留：真实独立评审模型推理与企业强制下发属外部依赖。 |
| GP-142 | 5.5 | **加密/损坏附件不可读诚实拒绝**：官方验收「加密/损坏文件不可读」。附件校验链目前只卡数量/体积，未卡内容可解码性。 | 可证：给一个截断/加密 PDF → `unreadable` 诚实拒绝、不进上下文、不假装已读。 |

> **实施状态（M48，已验证）**：`product_surface.stageAttachments` 已在数量/体积后补内容可解码性探测——图片 magic-byte、PDF `%PDF-` 头 + `%%EOF` + 无 `/Encrypt`、文本族 NUL/无效 UTF-8 判定；命中返回 `ok:false, error:"unreadable", reason:<code>` 且不落盘不进上下文；未知二进制保守放行。`scripts/prove_gp142_unreadable.js` **PASS=10 FAIL=0**（合法 PNG/PDF/文本/`.docx` 通过；伪 PNG/伪 PDF/加密 PDF/截断 PDF/NUL 文本/坏 UTF-8 各自诚实拒绝）。真链非回归：Boot e2e 全跑 GP-11 附件检查 0 FAIL。

> **实施状态（M47/M48，已验证）**：
> - **GP-135 已完成（桌面层）**：Host `list_skills` 枚举 Managed/User/Plugin 三来源，按 `SkillSource` 优先级（User 3 > Plugin 2 > Managed 1）去重并记 `also_in`；插件技能带 `plugin_id`，输出版 `source_counts`。`/` 菜单按来源分组、无匹配给出「去连接应用安装带技能的插件」引导；Connect apps 新增「技能（按来源）」区。`scripts/prove_gp135_skill_sources.js` **PASS=14 FAIL=0**。残留：内核 `SkillSource` 枚举仍只存在于内核目录，Host 侧为镜像常量（`MANAGED_SKILLS`/`PLUGIN_SKILLS`），后续应改由内核 payload 直供。
> - **GP-138 已完成（Host 持久化点）**：`routine_schedule` 在落库前校验 cron 触发间隔；每小时都触发且相邻分钟间隔 <5 → `ok:false, error:"interval_too_short"`，写 `refuse-*.json` 审计，**不写** `host-routines.json`；`@now/@once/@hourly` 与 `*/5`、`0,5` 等放行。`scripts/prove_gp138_routine_interval.js` **PASS=15 FAIL=0**。残留：既有历史行不做回溯清理；内核 `CreateRoutine` 文案未同步提示 5 分钟下限（需 `moon`）。
> - **GP-140 已完成（本地可证部分）**：Computer 浏览器 profile 固定为同一持久 `data/connectors/identity/chrome-user-data`；Bot A 的登录标记写入 `computer.json.shared_browser.sites`，Bot B 读取 `visible_to_bots:"all"` 可见。Host 新增 `computer_shared_session`（`record|<bot>|<site>|<signed_in>|<detail>` / `read|<bot>`），缺站点 `site_required` 拒绝。`scripts/prove_gp140_shared_computer.js` **PASS=11 FAIL=0**。残留：真实 Cookie 内容、云 microVM 与真登录沙箱不可达（`pretend_cookies:false`, `real_cloud_vm:false`, `cookie_sandbox_residual:true`）；内核回合尚无对应意图（需 `moon`）。
> - **GP-139 未做（阻塞）**：断言脚本需真实 `moon run` 的 `routine_tick`；本沙箱无 MoonBit 工具链，不能伪造 PASS。

> **真渲染门修复（target-v2 对齐，已验证）**：e2e 原先直接点击 grok-ui 下**有意隐藏**的入口（header 的电脑/模型、footer 的市场/连接应用/设置、`#sb-more`），必然假失败。已改为真实用户路径——账户弹层（`#ap-market`/`#ap-connect`/`#ap-settings`）、Cmd/Ctrl+F 开 Computer 右栏、Cmd/Ctrl+K 开搜索。过程中修掉两处**真实缺陷**：① `#agents` 是 flex 列，子项默认 `flex-shrink:1`，Bot/会话多时列表被压成 0 高、行落在滚动区外不可点 → `body.grok-ui #agents > * { flex-shrink:0 }`；② Round 9 把搜索行设为 `display:none` 但 Ctrl+K/工具栏按钮仍承诺搜索 → `body.grok-ui.session-search-open` 显式揭示（无 `!important`）。`e2e_desktop_shell_v2` **PASS=89 FAIL=0**。
> **P2 第二切片（D-ST 计算样式门，已验证）**：五个 sheet 关闭钮由 5 套 per-id 规则（20 处 `!important`）合并为一条 `body.grok-ui .bb-sheet .bb-close` 基类；`body.grok-ui .bb-sheet button` 的 `font-size` 去掉 `!important`，改为在 `.bc-tpl-btn` 自身规则对齐 13px sheet 字阶。`!important` 409→**346**（第二/三切片：关闭钮合并、settings 导航去 important、sheet chrome/字阶去 important）；`scripts/e2e_modal_computed.mjs`（D-ST，**PASS=27**，覆盖五个 sheet 的关闭钮/容器/标题/说明 + settings 导航与五个 tab）在改动前后读取五个 sheet 的真实 computed style，快照**逐字段相同**；layout 12/0（并修 assistant 气泡 85% 在宽窗超过 760 的合同缺陷）、boot 124/0、shell-v2 89/0、smoke 313/0。

### D. 明确延期（不列入本轮功能复刻硬门）

| 官方 § | 项 | 定性 |
|--------|----|------|
| 10.1 | macOS/Windows/Linux 安装包 + 架构检测（`.deb`/`.rpm`/AppImage/`uname -m`） | 发布工程，非行为对等；NG-001 不做像素/打包皮肤。 |
| 10.2 | iOS/Android 与桌面同步 Bot/对话、移动端功能受限（Teach-by-demonstration 不可用） | desktop-first 明确排除（README：iOS/Android 仅 `MachineKind` 注册，不在本波）。 |

---

## 二、剩余项规范（GP-134 起，可证伪验收）

### G-A 自动化补全

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-134 | 事件触发 Routine（Slack/GitHub PR/CI/邮件 inbox 待支持），配置含匹配规则/响应动作/输入源/预期结果/审批边界，事件触发需窄匹配避免 "every new message" | 桌面 `CreateRoutine` 扩 `trigger~` 变体：`cron=` 或 `event=<slack|github_pr|github_ci|origin|teams|linear|sentry|pagerduty>` + `match=<规则>`；复用内核 `routines/events`/`connector_events`（CM-0406~0409 形状已 Ready）；renderer 例程创建面板加触发类型选择器 + 空 `match` 拒 | 回合 `create routine event=slack match="#escalations needs repro" …` → `intent=create_routine` 且 turn JSON 带 `trigger=event` 与 `match`；空 event_name 或 `match=.*`（泛匹配）→ 内核 `Invalid`（不注册）；Slack 未邀请频道回执含 `/invite` 提示；`moon test` 增断言复用 CM-0406 形状 |
| GP-138 | Routine 间隔至少 5 分钟 | `CreateRoutine` 解析阶段：`cron`/`interval` 换算下次触发，两次相邻触发 `<300s` → 拒绝 `interval_too_short`；`Interval(seconds)` 直接校验 `seconds>=300` | 造 `@every 2m` / `* * * * *` → Host 拒且 `pretend_scheduled:false`，store 不落该 routine；`@every 5m` 通过；断言进 smoke（复用 G-12 例程探针链） |
| GP-139 | 关闭应用/笔记本不中断后台任务 | 断言现有 `host_routine_daemon.sh` 独立进程模型：测试脚本 kill Electron 主进程后跑一次 daemon sweep，due routine 仍触发 | Electron 退出 → daemon sweep `fires.jsonl` 该 routine `fired:true`、`last_fired_at` 推进（不依赖窗口存活）；诚实标注：本机无真合盖事件，进程分离即规格的可执行等价 |

### G-B Skills 来源

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-135 | `/` 菜单列出所有可用 Skills（Managed/User/Plugin 三来源）；缺失 Skill 引导至 Connect apps → Your plugins → Manage plugins and skills | 内核 `SkillSource`/`ManagedCatalog` 已有；桌面 `skills:list` IPC 载荷加 `source` 字段（managed/user/plugin），renderer `/` 补全按来源分组渲染，`plugin` 项若未装显示「去 Connect apps 安装」；Connect apps 面板补「Manage plugins and skills」区 | `/` 打开出现三来源分组且项来自 `skills:list`（非写死数组）；把一个 `source=plugin` 且 `installed:false` 的技能显示为「未安装·去 Connect apps」；切换语言即时重绘分组标题 |

### G-C Cloud Agent 结果闭环

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-136 | Bot 将 Cloud Agent 最终报告引用的文件复制到 Computer，附加到回复；桌面端可全屏预览 | CM-2131 卡 + CM-2148 路径约束已有；桌面回合补 `cloud_agent_result` 后处理：把 `/workspace/cloud-agent-artifacts/<bc>/*` 引用的文件经 `copy_to_box` 落 Computer + 复用 GP-90 文件卡/全屏查看器附件到回复 | 一次云代理回合后 Computer 工作区出现被引用文件（`fs` 探针存在）、回复带真实文件卡、`grep` 无 `/opt/cursor/artifacts` 直附（CM-2148）；文件缺失时诚实 `artifact_unavailable` 不造卡 |

### G-D 共享 Computer 模型

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-140 | 每用户一台持久 Computer，所有 Bot 共享浏览器 Cookie/会话/文件/命令行凭证；一个 Bot 登录的网站对其他 Bot 可用；每 Bot 独立 screen、同 Bot 同时只一个 CU 任务 | GP-30 并发锁已有；补「共享登录态」本地可执行形式：`computer.json` 增 `auth_sessions`（Bot A 登录写入 `site=<host>` + `by=<bot>`），Bot B 的 `computer` 视图读取到该登录标记；真实 Cookie/云 VM 按 `sandbox_screen` 残留 | Bot A 回合写 `auth_sessions["example.com"]` 后，Bot B 读 `computer.auth_sessions` 命中同一 `site`（跨 Bot 可见，非隔离）；断言 `bot_screen` 仍各独立（登录共享 ≠ 屏幕共享）；真实 Cookie 有效性标注 residual |
| GP-141 | Auto-review 独立审查、在 Bot 操作前评估风险（允许/要求审批/拒绝），独立于 Bot 模型；团队规则优先于个人；Ask first > Allow automatically；管理员可 Enforce（Enterprise） | GP-24 五类门已有；显式化「评审来源」与回复模型分离：`security/autoreview` 结果记 `reviewer:"auto_review_gate"`（区别于 `model:"…"`）+ 可证 verdict；团队 locked 行已有 GP-73，补来源标记 `team_locked:true` | 伪造「模型自称已批准」的正文不改 verdict；`Ask first` 与 `Allow automatically` 冲突判 ask（GP-22 已在，扩 reviewer 字段断言）；`team_locked` 行删除 → `rule_locked` 拒；真实独立评审模型推理/企业下发标残留 |
| GP-142 | 附件支持多格式；加密/损坏文件不可读 | `stageAttachments`/读取链目前卡数量+体积；补内容可解码性探测：文本族无 NUL/有效 UTF-8、图片 magic-byte、PDF 有 `%PDF-` 头且非截断、加密 PDF 无有效 trailer → `unreadable` 诚实拒绝 | 截断 PNG / 随机字节伪装 .pdf / 加密 PDF → `ok:false, reason:unreadable`，不进 kernel 上下文、不假装已读；正常件通过；断言进附件 smoke（G-17 扩展） |

### G-E 编排核心（GP-143 / 144 / 145 / 146 / 147；对应第 4/5/7 步 + 用户面）

| ID | 主线行为 | 实现落点 | 可证伪验收 | 风险护栏（必须在验收里断言） |
|----|----------|----------|------------|------------------------------|
| GP-143 | `@BotX @BotY 各做…` 后被点名的每个 responder **各起一个真回合**，用**该 Bot 自己的** `job/description` + 记忆槽作上下文、经**各自审批门**用其自身工具产出，各写一条 `speaker=bot_id` 的 transcript 回复；并行用 `AddSection` 分区，长任务可 `SpawnSubagent`/`LaunchCloudAgent` | `roomTurn` 之后新增 fan-out：对每个 responder 复用单 Bot 回合通道（注入 bot 上下文），`kind:"bot_reply"`+`speaker=bot_id` 落 transcript；`mentioned_only` 只对点名者，`all` 对全员，`bot_discretion` 由该 Bot 判定是否应答 | 建 2–6 Bot 群，`@` 两个不同职责 Bot → transcript 出现 ≥2 条 `speaker=bot_id`、内容各由其模型/工具产出（非模板复读）；`bot_discretion` 下未被点名者**不**应答；断言进 `smoke_grok_desktop_parity.sh` + 真 Playwright 门（读 transcript 计数） | **(a) 审批不静默**：responder 回合的敏感动作仍走第 6 步门，群回合不因"编排"而 auto-approve（断言 consequential 动作产生 `needs_approval` 而非直接执行）；**(b) 递归/终止**：responder 回合内不得再次触发 room_turn fan-out（`depth>=1` 拒），防自激循环；**(c) 预算**：单次编排 ≤ 成员数上限 6，超出 `too_many_responders` 诚实拒绝 |
| GP-144 | 编排者**收齐** responder 产出（含 cloud/subagent 回流产物）→ 跑一次汇总回合 → 群内写 `kind:"final_report"` 卡 + 附产物文件卡；未收齐如实显示 N/总 | 新意图 `Orchestrate(room,task,members~,report~)`；collect 用 `WakeParent`(CM-1208) 事件驱动**等待**（非 busy-loop，CM-2133），协调者一次 `llm_chat` 汇总，产物经 GP-136 复制进 Computer + GP-90 文件卡 | `assign room <id> task=<t> to=<b1,b2>` → 两 responder 回来后 1 条 `kind:"final_report"`，正文引用两成员结论 + ≥1 文件卡；**故意让 b2 超时/失败** → final_report 仍产出但显式 `2/2`→`1/2 partial`，**不假装有完整报告** | **(a) 收齐判定**：完成/超时以 transcript 事件计数 + 时限，禁轮询空转；**(b) 依赖可降级**：无 cloud/subagent 时 GP-144 只跑「room 内 responder → 汇总」最小闭环，**不强绑 GP-136**（解除对 A 类的排序依赖）；**(c) 幂等**：同一 task 二次编排不重复落 final_report |
| GP-145 | DM 保持 `activeBotId` 的 `job/description` + 记忆槽；群回合不得往 DM 会话写行；对 Bot 资料的编辑下一次回合即生效（现读）；审批/密钥请求留在归属 Bot 的 DM | 回合上下文按 `activeBotId` 取，persona 在 provider 边界现读 `bots.json`；群 `final_report`/`bot_reply` 只落 `rooms.json`，不进 `sessions.json` | 真渲染实测：`你的职责是什么？` 回复含该 Bot 的 `名字：/简介：/职责：` 且不含他 Bot 字段；`sessions.json` 群行计数 0，reopen 后 DOM 与 `rooms.json` 逐类相等 | **残留**：`pending-approvals.jsonl` 行不带 `bot_id`，「审批只进归属 Bot 的 DM」尚未成立；本轮可证的是群回合固定 `approved:false`（编排不额外放行） |
| GP-146 | 群 transcript 按条目渲染（user 行 / `bot_reply` 带头像+名+正文+产物 / `final_report` 卡带 N/总、partial、分区、产物）；运行中每 responder 一张「工作中」卡；失败出 `bot_reply_error`；未收齐显式 `1/2 partial`，绝不显示「全部完成」；旧无 `kind` 行不崩 | renderer 逐行分派，不复用「拼一段纯文本」路径；全部文案 `t(key)` 三语 | 真渲染实测：`.room-user/.room-reply/.room-error/.room-report/.room-working` 五类计数与持久行一致，partial 卡含「未收齐」且不含「已全部收齐」，错误卡点名失败 Bot | 不新增调试面板；DM 面残留的既有协议码（`CM-0205`、boot banner）不属本包范围 |
| GP-147（细节波，同轮二次审计） | 群聊产品面的**诚实性收口**：拒绝/幂等说明卡必须在整表重绘后仍可见；「工作中」态只在真扇出时出现；共享转录逐字段有界；失败原因说人话（协议码只进 dev-mode）；点名未命中不装成功；**`rooms.json` 故障不得演成「历史没了」，也不得被一次写入覆盖** | `sendRoomTurn` 说明卡延后落位；`orchestrateRoom` 的 `deps.onFanout` 拥有运行态；`clipRoomText` + `*_truncated`；`roomFailReason`/`roomOpFailReason`；`unknown_mentions`；`roomsStoreStatus()`（读侧）+ `requireWritableRooms()`（写侧 fail closed，6 个写入点）+ `rooms:list`/`rooms-changed` 带 `ok` + `rooms.onRoomsChanged` 自动退出 + `host_ffi` effect 层 try/catch | 真渲染 S10–S14（有界 / 幂等不闪态 / 未命中点名 / 坏 JSON 如实报「读不到」且恢复后按原文件重建 / 群被移出目录自动退出）+ `prove_gp143` Q 块（坏存储读写面）+ `prove_m29` 静态面 + smoke G-29 新增一条 | 不声称内核 `Orchestrate` 等价；坏存储时**拒绝写**而非重建空目录，用户历史优先于「功能可用」；说明卡用本地化文案，内部路径/协议码不进产品面 |

### G-F 转交凭据的下游（§8.30 修完状态诚实性之后暴露的两条真缺口）

| ID | 主线行为 | 现状（不是「已实现」） | 可证伪验收 | 风险护栏 |
|----|----------|----------------------|------------|----------|
| GP-166 | 承接方这轮没答上（没密钥 / provider 挂 / 超时 / 无 runner）时，转交凭据已在 `data/agents/inbox/<bot>.jsonl` 与 `data/agents/handoffs/handoff-<bot>-<ts>.json` 落盘（§8.30 已做到，因果锚点钉死「写行 ⇒ 排队 ⇒ 存根」）。**缺口：没有任何东西把它捡起来** —— 下一轮 / 定时唤醒时不读 inbox、不重跑、不提醒，博主会以为「已转交」等于「有人在做了」 | **残留（半闭环）**：`AGENT_INBOX_DIR` 全仓 3 处写、0 处读；回包形状已有 `pending:true` / `execution:"queued"` / `reply_error`，但没有消费者 | 建群转交给一个 provider 会失败的 Bot → 屏幕上出「受理并排队」（已绿）→ **再发一句无关群消息，该 pending 任务必须被自动捡起并产出 `bot_reply`**，或至少产出一条可见提醒（「还挂着 N 笔没跑」）；跑完 inbox 那笔要么被消费要么带 `attempts` 计数；`prove_room_orchestrator` + smoke G-14 各加一条「捡起后不重复执行」的断言 | **(a) 幂等键**：捡起必须带去重键（`handoff-<to>-<ts>` 即凭据 id），重跑不得让同一任务产出两条 `bot_reply` 或两次外发动作——对「发文 / 推邮箱」这类后果性动作，没幂等键就不许自动跑；**(b) 审批不因为重跑而绕过**：捡起的一轮仍走第 6 步门（`approved:false`）；**(c) 有界重试**：`attempts` 上限 + 到上限如实标 `handoff_stuck` 并点名原因，不许无限自激 |
| GP-167 | 群里触发的敏感动作（外发 / 购买 / 删除）产生的审批请求只进归属 Bot 的私聊，不进群转录 | **残留（承诺悬空）**：旧 `roomTurn` 里那句 `escalations:"dm-only"` 字段在群路径重写进 `hosts/shared/room_*` 后整条链都不再产生、也不再被消费；smoke GP-53 已从「grep 那个字面量」改为**量行为**（Host 结果与群转录里都不许出现审批卡），但这条取证目前是靠「新路径压根不产生审批卡」成立的 | 群回合里让某 Bot 执行一个 consequential 动作 → 断言：① 群转录 / `host_results` 里 `kind` 无 approval；② 审批请求出现在该 Bot 的私聊 DM 且带 room 溯源；③ 批准后动作真执行并回写群 `bot_reply`；任一环节缺失都必须红，不许用「没有东西可漏」蒙过 | 不实现 ② 之前，验收只能证「没漏进群」，**不能声称 dm-only 已交付**；接通后立刻把这条从「残留」升级为硬门，并复用 §8.30 的 `room_approval_leak` 与注入对照（防恒真） |

### G-F.1 GP-166 状态更新（本轮：从「残留（半闭环）」升级为「已实现（Host + 渲染双证）」）

上表的现状列写的还是「没有任何东西把它捡起来」——那句在本轮之后不再成立，但**不删原行**，
在这里改口径，历史可读。

| 项 | 现在的实现 | 取证（实测数字，不是设计意图） |
|----|------------|--------------------------------|
| 捡起入口 | `hosts/shared/room_dispatch.js` 在群回合扇出之后调 `surface.retryPendingHandoffs({room, deps})`，结果带在回包的**可选字段** `handoff_retry` 上；桌面 IPC 与 CLI / 移动端共用这一个入口 | `prove_room_orchestrator` R-01 / R-01b / R-01c 绿（M5 把入口摘掉立刻红 90/3）；矩阵 G-55 接线锚 + 注入对照 |
| 幂等键 | 存根文件名 `handoff-<to>-<ts>` 即凭据 id；`answered` / `stuck` 一律不再调模型 | R-02（答案不出现第二条、本轮只多新消息那一次调用）；R-03d（stuck 不自激）；M1（摘掉终态跳过）→ R-02 / R-03d / R-09 翻红 |
| 审批不绕过 | 捡起的一轮复用 `executeHandoff`：`ctx.role="handoff_target"`、取消通道在、**不带 `approved`** | R-04 绿 |
| 有界重试 | 上限 3（`HANDOFF_MAX_ATTEMPTS`），`attempts` 只在真跑一轮时 +1；到上限写 `state:"stuck"` + 一条 `bot_reply_error`（`handoff_stuck:<原因>（第 3/3 次）`），每轮最多捡 5 笔 | R-03a/b/c/d 绿；M3+M4 / M6 → R-03 链翻红；渲染层真 Electron 三语「这件事已停下（不再自动重试），需要有人来看」，且 `handoff_stuck` / `provider down` 不摊到产品面 |
| 并发与崩溃回收 | 跑之前写 `state:"running" + claimed_at`；新鲜 claim 跳过，超 10 分钟才允许接手且次数累加 | R-09 / R-10 绿 |
| 不删用户数据 | 坏 JSON 存根原样留在原地只计数；`rooms.json` 读不动时整轮返回 `rooms_store_unreadable` 而不把凭据演成终态 | R-06 / R-06b 绿（断言字节不变） |
| 群之间不串 | 只处理 `stub.room === 本群` 的凭据 | R-08 绿；M2 → 立刻翻红 |

**GP-166 的新残留（原「残留（半闭环）」里那条 0 处读已闭合，换这几条顶上）**：

- 捡起只搭「下一次群回合」这班车；routines / 定时唤醒那条路不走 `dispatchRoomTurn`，因此还没接
  `retryPendingHandoffs`——「定时发文失败了，等到有人再发一句话才醒」这件事仍然存在。
- 端到端用注入 runner 取证；真 provider 挂掉 → 下一轮自动捡起 → 屏幕出现答案这一整链
  要在装了真 key 的机器 / 真机上再验一次。
- 上限 3 / 每轮 5 笔 / claim 10 分钟是写死的默认值，没有可配项，也没做设备侧验证。
- inbox JSONL 仍只是账本：捡起终态只回写在存根上，没有「还挂着 N 笔」的统一查询面。
- `e2e_desktop_room_orchestration.mjs` 仍未接进聚合门（本轮只把 `prove_room_orchestrator.js` 接进 G-55）。

### G-F.2 GP-168 / GP-169（本轮：捡起搭上定时唤醒那班车；顺手发现 Box 打包清单缺一块）

G-F.1 的新残留里第一条「捡起只搭『下一次群回合』这班车」在本轮闭合。**不删原行，历史可读**，
口径改在这里。

| ID | 主线行为 | 现状 | 取证（实测，不是设计意图） | 新残留 |
|----|----------|------|--------------------------|---------|
| GP-168 | 定时发文内部转交给审核 Bot、provider 挂了 → 凭据落盘；一整天群里没人再发消息，第二天定时 sweep 必须把它叫醒并重跑 | **已实现（Host + CLI 生产入口 + 真 Electron 三证）**：`retryPendingHandoffs` 开可选入参 `all_rooms`，回包加可选字段 `scope`；`routine_tick` / `routine_wake` 在 `executeHostEffects` 收口处顺路捡一轮，效果行与 stdout 都带 `handoff_retry` | 新门 `prove_gp168_handoff_wake.js` 8/10 红 → **18/0**；矩阵 **G-56** 11 条（合同门 + 8 条 W 锚点 + 真生产入口探针 + 三处各摘各的都翻红的注入对照）；`e2e_desktop_user_journeys` 里两条真 Electron 取证（摘掉班车 69/2 → **71/0**）；七组变异 M1…M7 全部有归属 | 桌面 App 自己不起定时器（只有 daemon / Box 的 sweep 会捡）；单轮上限 5 笔、上限 3 次都写死且界面上没有「还剩几笔」 |
| GP-169 | 手机连上我这台电脑：Box 打包出来要能起来，到点扫、待批清单、批准留痕、同一笔不能再批第二次 | **已实现（HEAD 上是断的）**：`pack-box.sh` 的 shared 清单漏了 `desktop_pairing.js` / `lan_candidates.js` / `machine_presence.js` 三个 require，Box 一启动就 `MODULE_NOT_FOUND`；补齐 20 → 23 | `prove_box_routine_sweep.js` 在 HEAD 树复跑 **0/2**（SW-1 stderr `MODULE_NOT_FOUND`，其余 16 条没机会执行）→ 修复后 **18/0**；新门 `prove_box_pack_closure.js` **3/2 → 5/0**；矩阵 **G-57** 7 条（闭包门 + 4 条 P 锚点 + 清单副本注入对照 + 真 Box 取证） | 只验到同一台机器的 loopback；真手机跨机器连接与配对码流程仍未验。闭包门只覆盖三个入口的相对 `require("./x")`，动态拼路径抓不到 |

本轮另外记下的两条事实（不属于功能，但属于同一套纪律）：

- `runHandoffTurn` 在 `nested_skipped` 时把「内核被跳过」演成「目标 Bot 答上了」，捡起路径正好走它。
  已按 responder 闭包的同一口径改成失败。变异对照显示这一处宽松会连带把 W-02 / W-03 / W-03b / W-05 /
  W-07b 五条一起演绿 —— 「一处假交付」不是本地问题。
- 「门存在但没人跑」第二次撞上：`prove_box_routine_sweep.js` 从来没被任何聚合门引用，
  所以 Box 断在启动第一步而矩阵照旧全绿。G-57 把它接进矩阵（同 G-55 对 `prove_room_orchestrator.js` 的做法）。

### G-F.3 GP-170（本轮：装好的 App 自己就是唤醒源）

| ID | 主线行为 | 现状 | 取证（实测，不是设计意图） | 新残留 |
|----|----------|------|--------------------------|---------|
| GP-170 | 自媒体博主装好桌面端、电脑一直开着、群里没人说话：08:00 定时发文 / 交稿转审核 / 晚上推邮箱必须照常发生 | **已实现**：`hosts/desktop/main.js` 在主进程里跑 `routine_tick`（默认 60s，`BITBOT_DESKTOP_SWEEP_MS` 可调），single-flight，`data/routines/desktop-sweep.jsonl` 记每轮与 `handoff_retry`；`syncWakeSource()` 保证 shell daemon 真在跑时让位；quit 停表 | 新门 `e2e_desktop_sweep_timer.mjs` 在 daemon 关闭（= 装机布局）下真 Electron **0/5 → 6/0**；矩阵 **G-59** 9 条（断点自证 + 门 + 6 锚点 + 四路注入对照）；tick payload 只加可选 `desktop_sweep` / `note` / `at` | 见下两条纪律事实与 `report.md` §8.34 ⑨ |

本轮另外记下的三条事实：

- 唤醒的断点不是「没有定时器」，而是「唯一会醒的进程不在包里」：`package.json` 的 `build.files`
  不含 `scripts/`，`ensureRoutineDaemon()` 却依赖 `scripts/host_routine_daemon.sh`；Windows 也没有
  `/bin/bash`。所有 Electron 门禁又统一关掉 daemon，所以这条路从来没被跑过。G-59 用「断点自证」+
  「daemon 关闭下 App 自己扫」两段把它钉住。
- 又一次「能被两处喂饱的尺子不算尺子」：只摘 `whenReady` 里的 `syncWakeSource()`，门仍 6/0 全绿
  （`bitbot:daemon:ensure` 的 IPC 里还有一处）。必须两处全摘才 5 红。
- S-06 是粗尺：进程退出本身就会让定时器消失，所以「退出后不再有新 tick」即使漏掉 `clearInterval`
  也会绿。已在 §8.34 ⑨.1 如实记为残留，不把它当「停表已验」。

### G-F.4 GP-171（本轮：远端提交里未解完的冲突标记）

| ID | 主线行为 | 现状 | 取证（实测，不是设计意图） | 新残留 |
|----|----------|------|--------------------------|---------|
| GP-171 | 拉最新代码后，桌面端与门禁必须真的能跑：提交进分支的源码先得是能解析的源码 | **事故 + 修复**：远端 `a0ec929` 在 `hosts/desktop/product_surface.js`（2 组标记）与 `scripts/prove_room_orchestrator.js`（1 组标记 + 重复 `noRunner` 夹具）里提交了未解完的冲突；桌面 App 一 require 就 SyntaxError | `git show a0ec929:<file> \| node --check` 逐字报 `SyntaxError: Unexpected token '<<'`；新门 `prove_repo_integrity.mjs` **pass=4 fail=0**（174 个源文件全部可解析）；编排门 SyntaxError → **pass=97 fail=0**；矩阵 **G-60** 6 条（门 + 4 锚点 + 注入对照） | 完整性门只到语法层：同名 `function`/`var` 的语义重复抓不到；`index.html` 内联脚本/JSON/`.mbt` 不在 I-02 内；CI 仍不跑这份矩阵 |

本轮记下的一条根因：

- 以前的盲区写作「门存在但没人跑」；这次是**门跑在坏源码的下游** —— 所有门都要先解析源码，
  源码坏了它们连第一行都到不了，于是矩阵照样全绿。G-60 把「先能解析」变成一条独立的门，
  并放在矩阵末尾，任何一次提交把标记带上来都会被点名。
- 这道门自己也翻车一次：全量矩阵里 I-01 把 §8.35 为留证而**逐字引用**在代码围栏里的
  `<<<<<<< HEAD` 判成了未解冲突（`pass=3 fail=1`）。修法是收窄口径而不是删证据：
  代码/配置必抓，`.md` 围栏内的引用放行，围栏外照抓；I-03 从两向扩成三向
  （`markerCaught/quoteExempt/bareCaught`），两向变异分别把「证据误判」和「整份 .md 放行」
  各打红一次。记一条：**会把证据判成事故的尺子，会训练人删证据**。

---

### G-F.5 GP-172（本轮：装出来的 App 第一次启动就崩）

| ID | 主线行为 | 现状 | 取证（实测，不是设计意图） | 新残留 |
|----|----------|------|--------------------------|---------|
| GP-172 | 自媒体博主下载安装包、双击图标 → 窗口出现 → 开机就一直按点敲钟 | **事故 + 修复**：`dist/linux-unpacked` 真启动时主进程在 require 阶段抛 `ENOENT desktop/.env.local ... app.asar`，窗口根本没出现。两条缺陷叠加：① `.env.local` 写在 `__dirname`（装机后是只读 asar）；② App 自己的 `BITBOT_CONTENT_MODERATION=1` 默认值在同步密钥之前就填好，被当成「云端注入的密钥」触发落盘 | 新门 `scripts/e2e_desktop_packaged.mjs` 只认打包产物：修复前 **3/4**（P-01 未捕获异常、P-02 零轮、P-03 没写），修复后 **7/0**（19 轮 sweep、`.env.local` 0600 落在 userData、asar 字节不变）；假产物对照 2/5（P-00/P-02/P-03/P-04 翻红）；`pack-desktop.sh` 打完包自动跑本门 | 只验 Linux+xvfb；mac/win 真机安装未验；不验窗口与首启引导；自启 `Exec=` 的修复无门禁 |

根因一句话：**门禁一直跑在源码树里，用户拿到的是只读的包** —— 所有绿灯都覆盖不到「双击图标」这条路径。

顺带记一个**未修**的稳定性事实：三次全量矩阵里两次在 `e2e_grok_desktop_boot` 的
「回合落盘」断言上偶发红（GP-112 recall 超时 / GP-128 探针会话未进 store，连带
G-27 三条 grep 锚点），单跑与最终矩阵均 128/0 / 441/0。结论只到「墙钟等待与固定
端口 stub 在长矩阵里偶发超时」，根因未定位前按未修对待。

---

### G-F.6 GP-173（本轮：填个 key 就静默关掉内容审核门）

| ID | 主线行为 | 现状 | 取证（实测，不是设计意图） | 新残留 |
|----|----------|------|--------------------------|---------|
| GP-173 | 博主在凭证页填 LLM key 并「保存并热加载」后，默认开启的内容审核门必须还是开的 | **事故 + 修复**：`bitbot:secrets:status` 的 `value` 正则漏了 `_MODERATION$` → 渲染层不回填复选框 → 复选框从「未勾选」开始 → 保存无条件提交 `0`。一次普通保存静默关掉安全默认值；同 handler 的 `path` 还硬编码 dev 路径 | 装机包 P-06 走真实 UI（账户胶囊→设置→凭证→填 key→保存）：修复前 **7/1**（`实际 0`、`勾选前=false`、`status.path=hosts/desktop/.env.local`），修复后 **8/0**（审核门=1、复选框勾选、path=userData）；`pack-desktop.sh` 端到端 8/0 | 只验 Linux+xvfb；dev 树无对应锚点（保存会写用户真 `.env.local`）；CI 不跑打包门 |

记下的一条尺子事故：`DISPLAY=:1` 设着但 Xvfb 早退，`pack-desktop.sh` 于是跳过
`xvfb-run`，Chromium 报 `Missing X server or $DISPLAY` 后 SIGSEGV，门 4/4 红，
看起来像「刚修好的产物又崩」。修法是先探活再决定是否自套 `xvfb-run`
（`displayUsable()` + `BITBOT_XVFB_WRAPPED`），并且崩溃时把进程输出尾部带进断言。
另一条环境教训：手工复现留下的 packaged app 占着 `127.0.0.1:18765`，让 `G-47`
判了 5 红（AR-06/AR-11）；杀掉后单跑 20/0 —— 固定端口的门禁不会自己发现上个实例。

---

### G-F.7 GP-174 / GP-175（本轮：把两处偶发红变成可定位/可复现）

| ID | 主线行为 | 现状 | 取证（实测，不是设计意图） | 新残留 |
|----|----------|------|--------------------------|---------|
| GP-174 | 同一份代码跑全量矩阵，不能因为机器忙就偶发红 | **尺子修复（已定位）**：`GP-128` 在发消息后死等 800ms、只读一次 `sessions.json`，落盘晚于该窗口就判「会话没进 store」并连带 G-27 三条锚点红。改成轮询到出现（20s 兜底）；stub 端口从固定 8796 改为空闲端口；失败时带现场（store 条数/最近标题/stub 尾部/主进程尾部） | 旧脚本 + `BITBOT_STUB_LATENCY_MS=3000`（确定性复现）→ **121/1**，报错原文与矩阵里一模一样；新脚本 + 3s → **128/0**；新脚本 + 40s（>20s 兜底，负向对照）→ **118/4** 且带现场；正常时序 ×2 → **128/0** | GP-112 的偶发红仍未定位，只补了现场（新出现的 recall 文件 + 主进程尾部）；boot 门里 4 个固定端口 stub 见 GP-177 |
| GP-175 | 环境里残留一个旧实例时，手机配对门不能假红 | **尺子修复**：`AR-06` 拿到 `401 invalid_token`、`AR-11` 没有局域网地址，真因是手工复现留下的 packaged app 占着 `127.0.0.1:18765`（门里入站 `EADDRINUSE`）。门禁启动时挑一个空闲端口并用 `BITBOT_CN_INBOUND_PORT` 固定（不用 `0`：LAN 开关会重启服务，端口一变「旧地址不该还能用」的断言就被掏空） | 18765 被一个返回 401 的假实例占着：旧门 **13/5**（AR-06/07/08/09/11），新门 **20/0**；无占位时新门 **20/0** | 同类固定端口在本轮 GP-177 里清完（boot 门四处）；其它门的固定端口没有全量扫描；这是环境自愈问题，不是产品行为 |
| GP-176 | 「退出后不再 tick」不能把退出过程中的最后一轮算成违规 | **尺子修复**：S-06 在发 quit **之前**拍快照，IPC 跨过一个 250ms 周期时，退出中正常开跑的一轮被算成「退出后还在 tick」 | 旧逻辑 + 400ms 人为延迟 → **5/1**（`rows 6→8`，与矩阵里 `6→7` 同一形态）；新逻辑 + 同样延迟 → **6/0**；正常时序 ×2 → **6/0**；修复后全量矩阵 **441/0** | 「先拍快照再触发异步动作」的模式未全量排查；目前只修有证据的这一处 |

### G-F.8 GP-177（本轮：boot 门里四个写死的 stub 端口）

| ID | 主线行为 | 现状 | 取证（实测，不是设计意图） | 新残留 |
|----|----------|------|--------------------------|---------|
| GP-177 | boot 门不能因为 8793/8794/8795/8799 被占就假红 | **尺子修复**：GP-14 / G19 / M28 / M29 四处 stub 端口写死，stub bind 不上 → 就绪超时 → 整段异常；GP-143 的回合甚至真打到陌生进程上 | 用 500 回包占住四口：旧代码 **99/6**（exit=1，六条红）；同一批占位不撤、新代码 **128/0**（exit=0，占位服务命中数停在 4 —— 绿跑一次没碰旧端口）；修复后全量矩阵 **441/0** | 四处改 `pickFreePort()` 后门里无写死端口；全仓库没做静态扫描，新写的门仍可能再犯 |

### G-F.9 GP-179 / GP-180（本轮：GP-112 从「偶发」到按 id 判定；顺手修好头像条切换）

| ID | 主线行为 | 现状 | 取证（实测，不是设计意图） | 新残留 |
|----|----------|------|--------------------------|---------|
| GP-179 | 切 Bot 没确认落地时，红不能伪装成「上下文串了」 | **诊断修复 → 顺藤抓到真因**：先只把 `switch_landed` / `pill` / 该 key 的 recall 行写进失败信息（放在 `bad()` 200 字截断之前）；下一次运行就拿到真红：胶囊说切到 B、回合却跑在 A 上。真因有两层：判定用「名字」（同名 Bot 有几十个），以及 Bot 列表每次重绘都把胶囊拉回主 Bot（点开 A、侧栏一刷标题变回 B）——两层都改成按 id，重绘时保留已选中的 Bot | 注入「永不匹配 + 强制失败分支」→ **127/1**，红行开头即 `switch_landed=false pill=«Bit Bot» rows=[…]`；随后一次真跑 **127/1**（`switch_landed=true` 但 recall 落在另一个 Bot）；改按 id 判定后单跑 **130/0**；两层都修后全量矩阵 **441/0**（修前 439/2：G-16 里那条 + G-20 静态签名） | 偶发红只在一轮里再现过一次，样本小；仍不写「已彻底消除」 |
| GP-180 | 点头像条里的 Bot 要真的切过去 | **产品缺陷（已修）**：头像条 chip 的点击回调传的是 `b.id`（字符串），`selectBotForChat` 读 `b.id / b.name` → `activeBotId = undefined`、胶囊退回默认文案、会话多一条 `undefined · DM` | 旧代码 + 新断言 **129/1**（`stale pill=agent-bit/«Bit Bot»`）；改传对象后 **130/0** | 头像条仍无键盘可达性（无 aria-label / focus 样式），无障碍打磨未做 |

六条里只有 GP-180 动到了产品（点头像条切不过去），其余都只动尺子；它们共同决定矩阵的红色还能不能信。
本轮纪律照旧：GP-174 用「慢 3s 必红」证明根因，用「慢 40s 仍红」证明断言没被放空；
GP-175 用同一个占位进程做 A/B，而不是杀掉残留后说一句「重跑就好了」；
GP-176 用「放大到 400ms 必红」锁住同一形态，再把快照移到进程退出之后；
GP-177 用「占住四个旧端口」做 A/B，绿跑时占位服务一次都没被点到；
GP-179 先改现场、再等真红，不拿「看起来像」当结论；GP-180 的红是新断言打在旧 handler 上的 1/1。

### G-F.10 GP-185（本轮：多端通用逻辑收口 —— .env 解析 / 残差词表 / 机器 id）

| ID | 主线行为 | 现状 | 取证（实测，不是设计意图） | 新残留 |
|----|----------|------|--------------------------|---------|
| GP-185 | 同一件事只写一份：`.env.local` 解析、42 个 `*_residual` 词表、机器 id 默认值 | **已实现**：新增 `hosts/shared/host_env.js` 与 `hosts/shared/delivery_mirror.js`；桌面 / mobile_host / 入站 onTurn 共用解析器；SendToUser chip 与手机镜像共用词表；`seedMachineId` 与 agent context 改读 `machine_identity.DEFAULTS`；`pack-box.sh` 清单补 `host_env.js` | 改前 `prove_multihost_common` **pass=3 fail=5**（MC-00/01/02/03/04 逐条指名重复文件）；改后 **9/0**；注入对照两条（塞回 `.env` 解析 → MC-01 红；写回 `phone-android` → MC-04 红，恢复后 `cmp` 仍绿）；MC-08 用 fixture 钉住 .env 语义、镜像 58 字段顺序、chip 同源；真链 CLI/mobile `ListMachines` 200/ok 并落 58 字段镜像；全量矩阵 **PASS=467 FAIL=0** | 展示层仍各写（chip/iOS/Android STU/HTML）；无 Android/iOS 真机样本；`pack-box.sh` 清单仍人工维护（`check_box_requires` 只能查「打进去的指不到」，查不出「该打忘打」） |

这一条不是产品新功能，是把「改一端、另一端静默没改」变成门禁能抓住的事实。
它和 GP-184 的教训互补：那次是「一条 require 打死整个桌面端」，这次是「三份相同逻辑
各自演化」；前者靠打包自检，后者靠词表唯一来源 + 行为等价 fixture。


### G-F.11 GP-186（本轮：把 GP-185 的四条残留处理掉 —— 原生壳 / 旧 smoke / 打包闭包）

| ID | 主线行为 | 现状 | 取证（实测，不是设计意图） | 新残留 |
|----|----------|------|--------------------------|---------|
| GP-186 | GP-185 留的四条：展示层各写、原生壳薄、`pack-box.sh` 清单人工、旧 smoke 不在矩阵 | **已处理**：①两个原生壳的 42 个残差键按 `RESIDUAL_KEYS` 同序，新增 MC-09 钉住；②两个壳各补 154 条 `commandTemplates`（点击只填输入框，不直接发半句话），并把 gate 的 mobile kind 检查改到共享事实源；③`pack-box` P-01 实测能抓漏拷，文档更正；④旧 `smoke_desktop_turn.sh` 接入矩阵 G-64 | MC-09 改后 **10/0**；注入对照删 iOS 一枚键 → MC-09 翻红指到 iOS，恢复 `cmp` 仍绿；`verify_native_shells.sh` 从 HEAD 的 stale red 修到 **OK**（163 needle）；Android **126/0**（STU 7/0）；legacy smoke **0 断言失败 / 2 条显式 SKIP**（headless 无 WM、gh 未登录）；全量矩阵 **PASS=474 FAIL=0**（G-63 MC-09、G-64 在矩阵内） | iOS/Android 仍无真机样本（iOS 无编译器，模板 UI 未真机点过）；headless 下 native OS act 只能 SKIP；gh 未登录时 remote PR live view 不可达；`pack-box.sh` 清单仍人工维护 |

这一轮的三个「假红」值得单独记住，因为它们都在 HEAD 上就红：

1. `verify_native_shells.sh` 仍要求两个聊天壳逐字包含 163 条桌面快捷指令，但 `7789966`
   重写壳时已把矩阵删掉；本轮用**可编辑模板**把词表补回产品面，而不是删 gate。
2. GP-185 把 mobile Host kind 与 `receipt_path` / `skill_path` 收进
   `hosts/shared/delivery_mirror.js`，gate 却继续去 `mobile_host/run.js` 找；
   本轮改断言唯一事实源，并要求 mobile_host 仍 wire 共享模块。
3. `list models` 的真实 Host 路径已是 `llm_list_models`，gate 只认 `settings_open`；
   本轮两路都认且都不许 pretend。

产品 bug 一条（非断言问题）：kernel 给 Host 的 `code_changes` 目标是 box 虚拟路径
`/workspace/README.mbt.md`，Host 用 `path.isAbsolute` 当宿主绝对路径，导致
`exists=false / applied=false`，`code_apply_residual` 永远关不上。改为把
`/workspace/`、`/home/box/` 映射到 `REPO_ROOT` 后，apply / commit mock / push mock
三段全绿，且 commit SHA 来自 mock，不伪造。

---

## 三、门禁与交付要求（沿用现有纪律）

1. **每新增 GP 必须打真链**：验收落到 `smoke_grok_desktop_parity.sh` 新场景 + 真 Electron/Playwright 门（`e2e_grok_desktop_*.mjs` 同族），renderer 不伪造状态；`moon test` 覆盖内核意图分类。
2. **三态诚实**：外部不可达项（真 Cookie/独立模型推理/企业下发/云 VM 推流/合盖事件）一律 `residual:true` + 不 `pretend`，与既有残留口径一致。
3. **回归不破**：现有 parity 断言 + boot + layout + shell-v2 全绿不回退；D-C-03 三语键齐平，新文案走 `t(key)`。
   > M49 实测基线（真 Electron + xvfb + 真 `moon`，无外部服务；细节波复跑后）：`smoke_grok_desktop_parity` **PASS=321 FAIL=0**、`e2e_grok_desktop_boot` **PASS=127 FAIL=0**（含群协作真链段）、`e2e_desktop_layout_target` **PASS=12 FAIL=0**（D-C-03 三语 **502** 键一致）、`e2e_desktop_shell_v2` **PASS=89 FAIL=0**、`e2e_desktop_room_orchestration` **PASS=51 FAIL=0 SKIP=0**（S1–S14）、`prove_gp143_orchestration` **36/0**、`prove_m29_roomchat` **40/0**、`prove_ui_tokens` **8/0**。
   > 诚实校正（2026-10-22）：`e2e_desktop_layout_target` 的 D-L-* 几何 12 项在 UI 统一波次后已全绿。D-D-03（调试面 dev-mode 揭示）曾因 `grok-ui` 把 `#devmode-badge`/`#tools-toggle-btn` 一并 `display:none !important` 而在 HEAD 基线即红——这是真实的**产品缺陷**（`--bitbot-devmode` / `settings.dev_mode` 在产品态成为 no-op），不是过期门。已补 `body.grok-ui[data-devmode="on"]` 显式揭示（badge + 能力入口，仍不含 `#sb-more`），gate **PASS=12 FAIL=0**。`shell-v2` 的 S-MODEL 已改为真实入口（账户弹层 → 设置 → 凭证），与本轮同测 **PASS=89 FAIL=0**。
4. **禁词门**：产品态 forbidden-token 扫描（`entry=`/`account=`/`*_masked`/`data/`/`.json`/`× N`/`unavailable`/`disabled_by_default`/`training=`/`key=`/`secret=`）继续对新增 UI 生效。
5. **文档**：本文随实现同步进 `spec.md`（正式行）与 `gaps.md`（逐条状态），并在 `docs/design/desktop-target/report.md` 记录命令与实测结果。

## 四、建议波次顺序（已按「核心叙事」校正：编排回路优先）

> 〇 节已裁定"核心是把内核原语缝成群聊编排闭环"，故波次以 GP-143/144 领起；A/B/C 是支撑主线或独立边角，后置。

- **Wave M46（核心）→ M49 已交付（含同轮细节波 GP-147）**：**GP-143 先做 → GP-144 后做** 的切片计划已按序走完（M46 引擎切片 → M49 真回合 + UI + 私聊上下文 + 真渲染门）。M49 首版**不强绑 GP-136**（见 G-E 风险 b），因此 cloud/subagent 回流产物仍是 GP-144 的后续增量，不计入本轮已完成范围。
- **Wave M47（A 类接线，支撑主线）**：GP-134 事件触发、GP-135 Skills 来源、GP-136 Cloud Agent 结果闭环（GP-136 完成后回灌 GP-144 的 cloud/subagent 回流）。
- **Wave M48**：C 类共享模型（GP-140 共享登录态、GP-141 reviewer 显式化、GP-142 不可读拒绝）+ B 类护栏（GP-138 最小间隔、GP-139 关窗不中断）。
- **Wave M49**：GP-137 Teach a Task（体量最大：录制采集 + 草稿 Skill 生成 + 人工确认闭环，真录屏按残留）。
- **不做（延期）**：§10.1 打包/架构、§10.2 移动端同步——发布工程与平台范围，另立计划。

---

## 五、移动端远程控制（用户拿截图问「有这种成熟度吗」之后的分档）

口径先说清：**能力（pairing-v1）早就真跑过，缺的是那一屏**。用户看到的差距是入口与状态，
不是协议；所以按 S / M / L 三档拆，S 档本轮做完，M、L 档各立一行，不许用文案假装完成。

| ID | 档位 | 主线行为 | 现状 | 取证（实测，不是设计意图） | 残留 |
|----|------|----------|------|--------------------------|------|
| GP-191 | S（已交付） | 账户菜单有「移动端远程控制」独立弹窗：状态点如实（未放开=off）、配对码在本屏生成/刷新/作废并与 Host 每步一致、复制配对链接当场回显、弹窗内零令牌控件、Esc/遮罩可关且焦点归还、Bot Channel 一列只列钉钉/飞书/企业微信且「去配置」真跳转、480 宽不破版；旧设置卡保留手动兜底并写明主路 | `hosts/desktop/index.html` `#mobile-control-modal` + `#ap-remote` + `ui_chrome.css` `.mc-*`；状态源仍是 `window.bitbot.pairing.state()`，不新增协议面 | `scripts/e2e_desktop_mobile_control.mjs` MC-01..11：断言先写时 **0/10**，弹窗做完 **9/2**（窄屏挖出 GP-192 那条），修完 **11/0**；已接进 `smoke_grok_desktop_parity.sh` **G-67**（含红→绿与残留三行 echo） | 只有弹窗没有扫码；文案与状态点在 scope≠private 时给的是「这地址大概率连不通」的实话，不是「已就绪」的空头承诺 |
| GP-192 | M（未做） | 桌面渲染二维码（内容只允许 `base_url` + 一次性短码，禁 64 位令牌）+ 手机端解码；短码保留为无摄像头兜底；不得出现「扫开一个 404」的假链接 | **未做**：`hosts/desktop/node_modules` 里没有 QR 编码器，需先定 vendored 纯 JS 编码器还是新增依赖，并决定是否配一个 `/pair` 只读页 | 本轮**顺带修掉的不是 QR**：480×693 下 `#account-popup` 向上开，量到 `y=-167 h=309`、`ap-remote y=-97`、`elementFromPoint=null` —— 窄窗口里账户菜单每一项都点不到（不只新入口）。横带内改 `position:fixed` 向下开、层号 57 < composer 58 < 菜单 59 < modal 60；`MC-11` 钉住「每一项在视口内且命中自己」 | QR 那条仍未做；依赖选型（vendored 纯 JS 编码器 vs 新增依赖）与是否配 `/pair` 只读页没定 |
| GP-193 | L（未做，需设计评审） | 手机上继续指挥桌面的当前工作区（会话/面板/审批的远程镜像与回写） | **未做**：桌面只暴露 `/v1/turn`、`/v1/pair/discover`、`/v1/pair/redeem`（+`/health`），没有工作区镜像或远程 UI 控制协议；`hosts/mobile_host` 只有 README+run.js，`hosts/ios` 是 stub | 无可证伪验收，因此不写「已完成」；docs/qa/product-readiness.md 的口径（不许把内核接线改写成用户可达）在这里同样适用 | 需要先出协议设计（含鉴权、快照粒度、断线恢复），再谈 UI |

| GP-194 | 真缺陷（本轮顺带挖出并修掉） | 窄窗口（≤900 的 140px 横带）里账户菜单每一项都要点得到，不只新入口 | `#account-popup` 在横带内改 `position:fixed` 贴横带下缘向下开，层号 57 < composer 58 < 菜单 59 < modal 60 | 修前 `MC-11` 红：**9/2**，现场 `ap-usage y=-161 / ap-remote y=-97 / ap-connect y=1`、`elementFromPoint=null`；修后 **11/0**，并写进 layout-contract.md §3.1 窄视口表 | 横带本身要不要改成抽屉仍是 §8.51 残留；≤768 折叠时入口仍需先 Ctrl/Cmd+B 展开侧栏 |
