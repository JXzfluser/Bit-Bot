# Agent Core & 多智能体路线图

> 状态：draft · 2026-10-25（按最新工作树复核 + 本次纠错）<br>
> 范围：Kernel agent runtime + Host 群 Bot 多智能体；不含 UI 像素对齐、垂直 skills、商店上架。<br>
> 证据口径：以当前工作树代码为准；本文件内的 `file:line` 以**基线 commit `244515b`** 为准（并行改动会让行号漂移，引用时以函数名/文件为主）。<br>
> 一句话：`CM-*` 234/234 与 385 tests 证明“能力合同/产品面”很完整；Agent Loop 已接到产品 Chat，但生产 provider live 与 AR 升裁未完成；群 Bot 仍是“并行多 Bot 应答”。发布面的单实例锁与自动更新本提交已落地，但更新源/签名/升级回滚仍未做。

## 0. TL;DR

- **已经有的**：Turn 生命周期、Host FFI、审批门、per-bot persona/session、群 Bot 并行扇出、部分聚合、会话隔离、记忆分槽、Routines、Skills、桌面打包、单实例锁、electron-updater 自动更新（更新源仍是占位地址）、MCP stdio 客户端（Host 侧是符合 2024-11-05 的真 client，但服务端硬编码）。
- **新接上的**：默认 Desktop/cmd Chat 走 Kernel `AgentLoop::run`；Host 只做 `llm_chat` / `exec_tool` / `request_approval` / `deliver`；Read/Shell 由模型选，工具观察回注，64 步上限，GUI 可取消。
- **仍未关闭**：通用 ToolSpec/工具目录（21 个内置工具只有 3 个到模型）、memory 注入 provider prompt、反思（reflection）、MCP 通用化（可插拔 server / discovery / auth / 工具权限）、群消息幂等去重（同一句永不重跑）、内核 `room_turn` 那条静默失效路径。
- **本轮新接上的**：会话上下文 + token 预算 + 压缩（`runtime/agent_context.mbt`）、TodoWrite 进 loop、失败分类 + 重试上限、群编排（拆解/分工/综合/任务板/团队预算/取消传播）、handoff 真执行、工具 schema 单一源（内核当真源）、内核编译进 bundle + 数据目录迁 userData、AE 行为评测套件（26 门禁全绿）。
- **安全**：P0 入站认证、默认 loopback、审批不可伪造、shell 沙箱、webhook 签名、body limit 已落；P0-3 仍是内核 U，按现有升裁口径 **AR-15 未关**。
- **当前定位**：Agent core 在默认 Chat 路径上到 **L2**（模型选工具 + 观察回注）；没有规划/长任务，未到 L3。Group bot 仍是 **并行多 Bot 应答**，不是协作多智能体。
- **优先级**：`P0 安全收口` → `P1 群聊真实性 + Agent Loop 产品级验收` → `P1 上下文/记忆` → `P1 群编排` → `P2 工具/MCP/评测` → `P3 发布/运维`。
- **两条主线并行**：Kernel 负责 loop/tool/context；Host 负责 group/orchestrator/security。不要合成一个巨型 PR。

## 0.1 最新核对（2026-10-25）

| 门 | 最新结果 | 结论 |
|---|---|---|
| `bash scripts/prove_agent_loop_product_wire.sh` | `pass=49 fail=0`；`moon test -p runtime` 54/54；parser 3/3 | 默认 Desktop/cmd Chat 进 Kernel AgentLoop；Read/Shell、观察回注、max steps、取消、审批边界已立。**provider 是 prompt 匹配桩**（`scripts/prove_agent_loop_product_wire.js:62-86` `classify()` 按 `blob.includes("WP1-READ")` 之类匹配），只证接线不变量，**不证模型会不会选工具** |
| `bash scripts/prove_agent_loop_electron_midrun.sh` | `pass=62 fail=0` | 真实 Electron composer mid-run 投影 `AgentLoop::run`；取消停在内核 `Cancelled`。**provider 同为 stub**（`scripts/prove_agent_loop_electron_midrun.mjs:80` `classify()`），同样不证模型行为 |
| `bash scripts/prove_host_approval_ui.sh` | `pass=69 fail=0` | 审批卡 Allow/Deny、runAllowed 一次性、`args.approved` 不可伪造 |
| `bash scripts/prove_p0_inbound_security.sh` | `pass=8 fail=0`；host-checks 11/0 | 401/401/413、默认 loopback、入站不固定 `approved:true`、shell 最小 env |
| `bash scripts/prove_sandbox_secrets.sh` | `pass=8 fail=0` | SK1–SK8；cwd、env、artifact、scrub、timeout/buffer |
| `bash scripts/prove_production_provider.sh` | `NEEDS_LIVE`（exit 2）；PP6 子进程 exit 2/3 | 无生产密钥，PP1–PP4 未跑 live；不抄成 PASS |
| `node scripts/prove_agent_loop_a7_a8.js` | `pass=23 fail=0` | 流式/非流式 `tool_calls` 解析与拆分保留 |
| `node scripts/prove_room_context.js` | `pass=15 fail=0` | AR-07：最近转录、预算、脱敏、失败只带状态、DM null |
| `node scripts/prove_room_discretion.js` | `pass=15 fail=0` | AR-08：YES/NO 解析、prompt、接线、打包、skipped/fail-open UI |
| `node scripts/e2e_desktop_room_orchestration.mjs` | `PASS=53 FAIL=0 SKIP=0` | 真 Electron + 真内核；第二轮 provider 载荷含上一轮群转录 |
| `node scripts/e2e_desktop_single_instance.mjs` | `PASS=6 FAIL=0` | 单实例锁已落：S-01 不同 UD 各起一个；S-02 同 UD 第二个实例主动退出；S-03 `second-instance` 把已有窗口唤到前台 |

> 本轮审计发现一个 macOS 真实路径问题：`/var` 是 `/private/var` 的符号链接，旧 `cwdAllowed` 先做词法前缀检查，导致临时根下的合法 cwd 被误拒。已改为只比较 canonical path；P0 host-checks 从 9/2 恢复到 11/0，SK 从 2/7 恢复到 8/0。产品仓库在 `/Users` 下不受影响，但这是跨平台正确性修复。

## 1. 口径先钉住

### 1.1 “多 Agent”至少有三层

| 层级 | 定义 | 当前 BitBot |
|---|---|---|
| 并行多 Bot | 同一个任务广播给多个独立 Bot，各自回答，最后聚合 | **已实现**，真实并行、真隔离、真部分失败 |
| 协作多 Agent | 有分工、共享上下文、互相消息、handoff、汇总/复核 | **部分**：最近 N 条群转录已进 responder prompt；handoff 仍只写 inbox，不执行；无共享任务板/汇总者 |
| 多 Agent Runtime | 调度、隔离、预算、取消、工具循环、追踪、评测 | **未实现**：内核无 `Orchestrate`，Host 是产品层编排 |

### 1.2 Agent 自主性分级

| 级别 | 能力 | 当前 |
|---|---|---|
| L0 | 单轮聊天，模型只回文本 | 已超过 |
| L1 | 预定义单步工具/效果，模型不选工具 | 旧 Chat / 非 Chat 路径仍可能在此 |
| L2 | 模型选工具，工具结果回注，可多步 | **默认 Chat 已到**；只 Read/Shell，64 步，无规划 |
| L3 | 多步循环 + 规划 + 失败恢复 | 目标 V1 |
| L4 | 长任务 + 记忆 + 多 Agent + 评测 | 目标 V2 |
| L5 | 团队运行时：任务分解 → 编排者 → 交接真执行 → 共享工作区 → 预算/取消治理 → 记忆闭环 → 工具生态（MCP/插件） | 未到。判定标志：**一个团队完成一件事**，且有可复现的群协作评测 |
| L6 | 自治团队：常驻/事件驱动运行 → 跨会话长程任务 → 跨 Agent/跨端（Desktop·iOS·Android）共享状态 → 成本与时延可治理 → 可回放 → 干净机器可装可升级 | 未到。判定标志：**无人值守可交付** |

> 阶梯口径：仓库原有阶梯到 **L4**；**L5/L6 是本次新增定义（2026-10-25）**。这两个定义按仓库自身词汇推得——§1.1 的三层多 Agent（并行多 Bot / 协作多 Agent / 多 Agent Runtime）、§5 的 Wave 0–7、以及 §3 的主流对比——**不是外部标准**，也不与任何公开的 agent 分级体系对齐。

> 结论（2026-10-25 更新）：默认 Chat 的 agent runtime 已从 L1 走到 **L3**——会话上下文 + token 预算 + 压缩、TodoWrite 规划、失败分类与重试上限都已接上（`runtime/agent_context.mbt` + `runtime/agent_loop.mbt`），到模型的工具是 Read/Shell/TodoWrite 三个。**群侧已从「并行广播」走到「真编排」**（拆解 / 确定性分工 / lead 综合 / 共享任务板 / 团队预算 / 取消传播 / handoff 真执行），对应 L4 的大部分。`CM-*` PASS 仍不能当作 agent 能力评测；**AE 行为评测 26/26 全绿**（`docs/qa/agent-eval.md`）是新增的行为证据，但它和 WP/EG 的接线证据**不能互相替代**。仍未升裁 AR-01/02/03：生产 provider live 未跑、AR-15 仍开。

### 1.3 为什么群 Bot 现在还不算“协作多智能体”

> 2026-10-25 更新：下面 1/2/3/5/6 已由 `hosts/desktop/room_orchestrator.js` 落地（拆解 + 确定性分工 + lead 综合 + 共享任务板 + 团队预算 + 取消传播 + handoff 真执行，`prove_room_orchestrator` 69/0）。**仍然成立**的是 4 与 7，以及「同轮并行成员之间看不到彼此本轮输出」。

1. ~~**同一任务广播**~~ **已修**：`orchestrateRoom` 现在先拆解再分工（模型只**建议**拆解，**分配由宿主确定性轮转**——安全与预算不交给模型决定）。
2. ~~**只能看见已落盘的历史**~~ **已修（部分）**：`buildRoomContext` 带最近 N 条转录；**共享任务板已接**（`data/agents/sections/<room>.json`，选择回合与成员回合都能读到）。**但同轮并行成员之间仍看不到本轮刚生成的回复**（bot_reply 在 `Promise.allSettled` 之后才落盘）。
3. ~~**没有汇总者**~~ **已修**：`final_report` 分成「成员结果」与「lead 综合」两层；部分失败仍出综合并标 `gaps`。
4. **无 @ 的选择仍是独立判断，不是团队协商**：`bot_discretion` 逐 Bot 跑 YES/NO，**只扇出选中者**，全员弃权落 `skipped`。每个 Bot 只看任务 + 已有转录 + 共享板，**没有互相提名**。**本轮修掉的是成本面**：selector 整体失败现在**不扇出**（如实失败，零模型调用），单个失败按 `maxFailOpen` 有界降级且被跳过者记为「失败」而不是「参与」。
5. ~~**handoff 不执行**~~ **已修**：`handoffTaskAsync` 让目标 Bot 真的跑一轮，回复落进群转录；生产 effect 路径也接上了。
6. **responder 可走 AgentLoop，但群编排仍是 Host 单轮扇出**：群回合**已有**共享任务板与团队预算，也**已有**取消传播到内核；**仍缺**本轮实时跨成员观察（同轮并行互不可见）。`approved:false` 仍意味着群内 Shell 不能绕过审批——这是**故意**的。
7. **群 composer 绕过内核**：主路径仍是 `rooms.orchestrate`（Host 产品路径）；内核 `Orchestrate` / `final_report` 没有做（AR-17）。这条**没变**。

## 2. 现有能力清单

### 2.1 真实现的能力

| 能力 | 证据 | 边界 |
|---|---|---|
| Turn 生命周期 | `runtime/turn.mbt`；`runtime/agent_loop.mbt`；`cmd/desktop_turn/agent_loop_product_native.mbt` | `open_turn → AgentLoop::run`；64 步上限；取消/最大步数可停 |
| Host effect 执行 | `hosts/shared/host_ffi.js`；`hosts/shared/run_moon_turn.js` | 一次回合 spawn `moon`；FFI 逐行 pump；Host 只做四个单次操作 |
| 审批门 | `runtime` ApprovalGate；Desktop `approvals:runAllowed` | 入站不再固定 `approved:true`；审批卡授权一次性；P0-3 仍 U |
| per-bot persona | `host_ffi.js llmSystemPrompt(botId)` | 只注入名字/职责/简介 |
| per-bot session | `room-<roomId>-<botId>` | 群回合不写 DM |
| 群 Bot 并行 | `product_surface.js orchestrateRoom` + `Promise.allSettled` | 最多 6，per-responder timeout |
| 群定向路由 | `product_surface.js roomTurn` + `main.js selectRoomResponders` | `@A` / `@A @B` 真定向；`@everyone` 全员；无 @ 的 responders 是候选池，逐 Bot YES/NO 选择 |
| 部分失败聚合 | `final_report.partial` / `returned/total` | 诚实，但不综合 |
| 群转录隔离/脱敏 | `product_surface.js` room transcript | 有长度/字符清洗 |
| 群共享转录 | `room_context.js buildRoomContext`；`host_ffi.js llmRoomContextBlock` | 最近 N 条 `user`/`bot_reply`/`final_report`；失败只带状态；预算/截断/脱敏；同轮并行不可见 |
| 记忆分槽 | `host_ffi.js memorySeedArgs(botId)` | kernel seed；provider prompt 不带 memory |
| Routines | `agents/routines` + Host durable store | 非长驻 daemon |
| Skills | `skills/` catalog + load | 模型不能自主选 |
| MCP（stdio） | `mcp_discover` / `mcp_call`；`scripts/host_h4_mcp_client.py:45` `mcp_session` | **Host 侧是符合 MCP 协议 2024-11-05 的真 client**（initialize + notifications/initialized 握手、Content-Length 分帧：`:17` `_encode` / `:22` `_read_one`；`host_ffi.js:9040` `tools/list`、`:14424-14428` `tools/call`）。缺的是**服务端通用化**：server 硬编码（`host_ffi.js:292` 固定指向 `host_h4_mcp_stdio.py`）+ 只有 5 个工具（`host_h4_mcp_stdio.py:38` TOOLS） |
| Subagent worker | `host_ffi.js:18667` `runWorkerMoonTurn` → `:18680-18690` 起真内核回合 `cmd/desktop_turn` | 一次性，prompt 截 800。**工具观察在 worker 回合内部是回注的**（Chat 意图走 `cmd/desktop_turn/agent_loop_product_native.mbt:215-216` → `:158` `AgentLoop::run`）；没回注的是**父会话**——父侧只拿 `assistant` + `effects`（`host_ffi.js:18709-18719`） |
| 桌面打包 | `scripts/pack-desktop.sh` / electron-builder | 内核未进 bundle，见发布项 |
| 发布面（单实例 + 自动更新） | `hosts/desktop/main.js:25` `requestSingleInstanceLock()`；`:113`/`:2568`/`:2603`/`:2607` electron-updater | 单实例锁**已落**（`scripts/e2e_desktop_single_instance.mjs` 6/0）；自动更新**已落**真实 electron-updater（不是假桩），但更新源是 env/占位地址，签名/公证/升级回滚 smoke 未做 |
| 模型工具调用 | `host_ffi.js` SSE/非 SSE 保留 `tool_calls`；A7/A8 23/0 | 仅 Read/Shell；`tools/types.mbt:63` `BuiltinTool::all()` 有 **21** 个内置工具，但模型只够得着 **2** 个（Read/Shell）；通用工具目录未做 |
| 真实 web 检索 | `hosts/shared/host_ffi.js:5522` `webSearch`（Tavily/Brave） | 真实检索在 Host JS；`tools/web.mbt:49` `WebHost::mock()` 只是内存假实现，**不能把整条 web 能力归为“全是 mock”** |
| observation 回注 | `runtime/agent_loop.mbt`：tool 结果 fence 后进下一次 `llm_chat` | 只在本回合内；不持久化 |
| 群 responder 的 AgentLoop | `runRoomResponderTurn → runner.runTurn` | intent=Chat 时可走内核 loop；最近转录已进 prompt；群预算/任务板仍不共享 |

### 2.2 已接线但未升裁 / 仍是壳的能力

| 能力 | 现状 | 缺什么 |
|---|---|---|
| `AgentLoop` | 产品默认 Chat 已走 `runtime/agent_loop.mbt`；Read/Shell、observation、64 步、取消、审批边界已通 | 无会话历史/压缩、无规划/反思、通用 ToolRegistry 弱 |
| `ToolRegistry` | `product_tool_registry`（`cmd/desktop_turn/agent_loop_product_native.mbt:61-76`）注册 Read/Shell。**产品路径上不存在 `{}` schema**——`{}` 只在 `runtime/types.mbt:20` `ToolRegistry::seed_builtins()`，而该函数只被 `runtime/pipeline_test.mbt:28`、`runtime/types_test.mbt:3` 引用；真实 boot 走 `cmd/main/main.mbt:3-5` → `bitbot.mbt:21` `ToolRegistry::empty()` | **schema 单一源已做**（2026-10-25）：内核 registry 的 `input_schema_json` 现在是完整 JSON Schema，并由 `product_tool_schema_json()` 随每次 `llm_chat` FFI 请求发给 Host（`cmd/desktop_turn/agent_loop_product_native.mbt`）；Host 优先用内核那份（`hosts/shared/host_ffi.js` 流式/非流式两处），`agentLoopToolSchema()` 降级为兜底。**仍缺**：注册/发现/权限/通用 schema；21 个内置工具里只有 Read/Shell/TodoWrite 到模型——其余的 Host 侧根本执行不了（`hosts/shared/agent_loop_product_wire.js:42-69` 只实现了 Shell/Read），暴露它们只会让模型选到必然失败的工具 |
| `ToolCallTrace` | `runtime/transcript.mbt:28`，只有 `tool_name`/`args_json`/`result_snippet` 三个字段；承载它的 `TranscriptStore`（`:78`）**是死代码**——全仓无外部引用，只被 `runtime/acceptance_cm2150_test.mbt` 调用 | 持久化 `AgentStep` trace：model/tool/args/result/**duration/error/时间戳**。**新 `AgentContext` 已经能记这些**（`runtime/agent_context.mbt` `AgentToolTrace` + `record_trace`，含 duration/error/时间戳，L3-9 有测试），但**旧的 `TranscriptStore` 仍是死代码**——两套 trace 并存，落地时要合并 |
| `RoomOrchestrator` | **已接**（2026-10-25）：`hosts/desktop/room_orchestrator.js` 落地拆解（`decomposeTask` / `normalizeSubtaskProposal`）、确定性分工（`assignSubtasks`，轮转分配、模型无权指定）、lead 综合（`buildSynthesisPrompt`）、共享任务板（`createRoomBoard`，**有读回 prompt 的路径**）、团队预算（`createTeamBudget`：轮次/时间/token）、取消作用域（`createCancelScope`）、重复劳动率（`duplicateWorkRate`）。`prove_room_orchestrator` 69/0 | 编排仍全在 Host 侧，Kernel `Orchestrate` 未做（AR-17）；模型拆解建议默认关闭（`BITBOT_ROOM_DECOMPOSE=1` 才开，因为它是**预算外**的额外模型调用） |
| `spawn_parallel_executors` | `agents/task/parallel_spawn.mbt` 内存 handle | 无真实调度/隔离 |
| Cloud lifecycle | `agents/cloud/lifecycle.mbt` fake bc | 无真实远端生命周期 |
| Teammates | `agents/teammates/create_agent.mbt` 内存 | 无真实 agent runtime |
| MCP（内核侧） | `tools/mcp_host_file.mbt:3` 自述 "mocks the host-side contract only" | 内核侧只有 mock；Host 侧已是真 client（§2.1），缺的是可插拔 server / discovery / auth / 工具权限，以及服务端硬编码 + 5 个工具 |

### 2.2.1 已存在但未接线的原语

> 下面这些模块**有 CM 合同、有测试、产品 Chat 路径零调用**（下表「接线状态」已逐个 grep 复核）。结论：**到 L3/L4 的主要工作量是接线，不是从零造**——规划、并行工具、自主性判定、诚实门、任务恢复、动态工具目录都已经在仓里躺着。

| 原语 | 位置 | 做什么 | 接线状态 |
|---|---|---|---|
| 规划/待办 | `runtime/todo_write.mbt:18-60` `TurnContext::todo_write` / `visible_todos` / `mark_todo_done` / `done_todo_count` | 回合内结构化 todo 清单（≥1 项、标 done） | 内核**只有** `runtime/acceptance_cm0112_test.mbt` 调用；产品侧另有 intent `todo_write`（`cmd/desktop_turn/turn_json.mbt:188,4921`）走 Host durable store，**不是** AgentLoop 的 todo，模型选不到 |
| 并行工具发射规划 | `runtime/parallel_tools.mbt:56,66,104,113` | 只读工具同轮并行发射规划 + mutability 分类 | 全仓无外部引用（只有自身定义） |
| 自主性判定 | `runtime/autonomy.mbt:52` `decide_autonomy` | 可逆 / 不可逆 / 越界 → 要不要问人 | 只有 `runtime/acceptance_cm2138_2140_test.mbt` 调用 |
| 审批重试指纹 | `runtime/smart_mode.mbt:17,22,38` | 同一动作重试时复用上次的审批结论 | 只有 `runtime/acceptance_cm1502_1503_test.mbt`、`runtime/smart_mode_test.mbt` 调用 |
| 诚实门 | `runtime/honesty.mbt:36,73` | 缺数据时不编造、拒绝编造答案 | 只有 `runtime/acceptance_cm2138_2140_test.mbt` 调用 |
| 工具 trace | `runtime/transcript.mbt:78` `TranscriptStore` | 记录工具调用供回读 | 死代码（见 §2.2 `ToolCallTrace` 行） |
| 任务恢复 | `agents/task/handle.mbt:519` `TaskResumeRegistry` | 任务结束后按 id 恢复、保留上下文 | 只有 `agents/task/acceptance_cm2136_test.mbt` 调用；模块内自用，产品路径无入口 |
| 动态工具目录 | `tools/dynamic.mbt:19` `DynamicCatalog` | MCP 动态工具目录 / 发现 | `cmd/desktop_turn/turn_json.mbt:2740,2778` 只用 `seed_example()`（写死示例目录），**没有**接进 `AgentLoop` 的 registry |

### 2.3 关键缺口（AR = Agent Runtime）

| ID | 缺口 | 当前状态 | 证据/口径 | 优先级 |
|---|---|---|---|---|
| AR-01 | 模型驱动 tool loop | **部分/门禁绿，未升裁** | `AgentLoop::run` 已跑 model→tool→observe→repeat；WP 49/0；PP live 未跑。**WP 的 provider 是 prompt 匹配桩**（§0.1、AR-14），所以“模型会不会自己选对工具”这件事目前**没有任何证据** | P1 |
| AR-02 | ToolSpec 弱，`tool_calls` 被忽略 | **部分/本轮改善** | `tool_calls` 流式/非流式都保留；**工具 schema 已单一源**（内核当真源，随 `llm_chat` 请求下发，Host 两处分支都用它；§2.2）。**C-1 能力层已落地第一批产品工具**：`describe_schedule` / `create_teammate` / `create_routine` 三个工具到模型（PT 门禁证明 provider 真收到它们的 schema），内核自己 dispatch（不经 Host 的 `exec refused`），中文排程说法由内核确定性解析（ADR 0010）。仍缺：通用注册/发现/权限；到模型的工具仍只有 6 个（Read/Shell/TodoWrite + 三个产品工具），内核 70 个 `TurnIntent` 里的其余能力未暴露 | P1 |
| AR-03 | 工具结果不回注 | **部分/已实现（回合内）** | `agent_loop.mbt` 把结果 fence 后回注下一轮——**回合内**已实现。**跨回合还没接**：`runtime/agent_context.mbt` 的 `AgentContext` 持有会话历史（`append_user` / `append_assistant` / `append_tool` / `append_observation`）且可 `encode` / `decode`，`AgentLoop::run_with` 接受外部 context——**但产品路径 `cmd/desktop_turn/agent_loop_product_native.mbt:193` 调的是 `.run(ctx, host)`，每回合新建一个空 context**；且内核是**每回合新起进程**（`hosts/shared/run_moon_turn.js:87,143` `spawn`），进程一死 context 就没了。**结论：能力齐了，线没接**（L3-5 测的是同一进程内跨 turn 续 context，不是跨进程） | P1 |
| AR-04 | 无会话历史/上下文预算 | **部分/能力齐但未接线** | `runtime/agent_context.mbt`：`AgentContext`（历史 + `estimate_tokens` 估算预算 + 压缩 + `plan_block` / `lead_block` + `wire_messages` 投影成 provider 消息）。token 数是**估算**（字符数/4），不是真 tokenizer。停止条件有两个：步数 + 预算（L3-2）。**但产品路径没用持久化**：内核每回合新起进程，`AgentContext::encode` / `decode` 目前只有内核自己的测试在调（`runtime/agent_context.mbt:572,630`），**产品路径一次都没调** ⇒ **用户仍然感觉不到「多轮不失忆」**。缺的是 Host 侧把 encode 的结果落盘、下回合 decode 回来 | P1 |
| AR-05 | memory 不注入 provider prompt | **未做** | 记忆仍是 kernel seed，provider prompt 不可见 | P2 |
| AR-06 | 无规划/反思/任务分解 | **部分/本轮改善** | **规划已接**：`TodoWrite` 进 `product_tool_registry`（`agent_loop_product_native.mbt`），内核自己处理该工具（不发给 Host 执行），todo 清单进下一轮上下文，模型看得见自己的计划与进度（L3-6/L3-7）。**反思（reflection）仍未做**；任务分解在**群编排层**已做（`room_orchestrator.decomposeTask`），**单 Bot loop 内仍无分解** | P2 |
| AR-07 | 群无共享上下文 | **部分/本轮改善** | `buildRoomContext` 带最近 N 条转录（`prove_room_context` 15/0）；**共享任务板已接**（`room_orchestrator.createRoomBoard` → `data/agents/sections/<room>.json`，有读回 prompt 的路径，选择回合与成员回合都能看到）。同轮并行成员之间**仍看不到彼此本轮输出**（bot_reply 在 `Promise.allSettled` 之后才落盘） | P1 |
| AR-08 | 群路由语义不真实 | **已实现** | `@` 真定向、`@everyone` 全员、无 @ 逐 Bot YES/NO 真选择；全员弃权落 `skipped`；selector 失败 fail-open 并标 `fail_open`，UI 明示 | P1 |
| AR-09 | handoff 不执行 | **已实现** | `product_surface.js` 新增 `handoffTaskAsync`：目标 Bot **真的跑一轮**（`executeHandoff` → `runResponderTurn`），回复落进群转录，失败如实标。生产 effect 路径也接上了（`host_ffi.js` 的 `handoff_task` effect 优先调 `handoffTaskAsync`）。`pretend_transferred` 的诚实语义保留。AE-21 门禁守着这条 | P1 |
| AR-10 | 无 orchestrator/synthesis | **已实现** | `room_orchestrator.js` 落地：模型只**建议**拆解、**分工由宿主确定性轮转**（安全/预算不交给模型）；`final_report` 分成「成员结果 sections」+「lead 综合 synthesis」两层，不混为一谈；部分失败仍出综合并标 `gaps`。`prove_room_orchestrator` 69/0 | P1 |
| AR-11 | 无共享工作区/task board | **已实现** | `room_orchestrator.createRoomBoard` → `data/agents/sections/<room>.json`（**key 用 room id**，不是 kernel group_id），有 `section_add` / `section_post` / 快照读回。产物（artifacts）仍只在 `final_report` 里，没有独立的共享产物库 | P2 |
| AR-12 | 无团队预算/取消/loop guard | **已实现** | 团队预算（`createTeamBudget`：轮次/时间/token 估算）由宿主裁决，超了停并如实说明；**取消已真正到达内核**（`main.js` 群 responder turn 现在传 `cancelPromise`，`run_moon_turn.js` 支持它）；`AgentLoop` 侧步数上限可下调但硬顶 64 不可破（`effective_max_steps`）。仍缺**真成本**口径（token 是估算） | P1 |
| AR-13 | MCP 未通用化 | **部分** | Host 侧已是符合 MCP 2024-11-05 的真 client（`scripts/host_h4_mcp_client.py:45` 标准握手 + Content-Length 分帧；`hosts/shared/host_ffi.js:9040` `tools/list`、`:14424-14428` `tools/call`）。真缺口是**服务端硬编码**（`host_ffi.js:292` 固定 `host_h4_mcp_stdio.py`）+ **只有 5 个工具**（`host_h4_mcp_stdio.py:38` TOOLS）+ 无 discovery/auth/工具权限；内核侧 `tools/mcp_host_file.mbt:3` 仍自述 mock | P2 |
| AR-14 | 无 trace/eval | **部分/本轮改善** | **已建 AE 行为评测**（`scripts/eval/`，29 场景：26 门禁全绿 + 3 live 待密钥；见 `docs/qa/agent-eval.md`），断言对象是**行为**（选对工具/观察回注/失败收敛/预算内停下），不是接线。**WP/EG 的 provider 仍是 prompt 匹配桩**（`prove_agent_loop_product_wire.js:62-86`），两者不能互相替代；内核 `TranscriptStore` 仍是死代码；**无回放能力** | P2 |
| AR-15 | 安全 P0 | **部分/未关** | P0 入站/auth/sandbox/SK 绿；P0-3 仍 U；文档明确不关 AR-15 | **P0** |
| AR-16 | 打包/运维缺口 | **部分/本轮改善** | **内核已进 bundle**：`moon build --target native` 出独立可执行文件，`scripts/pack-desktop.sh` 打包前构建 + 冒烟 + 落到 `hosts/desktop/resources/kernel/bin/`，`package.json` `extraResources` 随包分发，Host 直接跑它（不再需要目标机器装 MoonBit 工具链或源码树）。**等价性有门禁**：`scripts/prove_kernel_binary.sh`（KB）证明二进制与 `moon run` 输出逐字段一致，KB1 证明它不依赖源码树。**数据目录已迁 userData**（`hosts/desktop/paths.js`：packaged → `<userData>/data`，dev 仍是 `<repo>/data`）。**顺带修了一个真 bug**：原 `resolveRepoRoot()` 探的是 `moon.mod.json`，而真实模块文件是 `moon.mod` ⇒ 打包后必然找不到内核；现已改为探 `moon.mod` 并删掉硬编码的 `/Users/zfl/Downloads/bitbot`。自动更新已实现，公证钩子已接。仍缺：签名/公证**真跑**、更新源**真地址**、升级/回滚 smoke | P3 |
| AR-17 | Kernel/Host 双路径漂移 | **部分** | Chat 已单一路径；群编排仍 Host 产品路径 | P1 |

### 2.3.1 文档未记录但影响 L4+ 的行为

> 这四条原文完全没有提，但它们直接卡住 L4/L5/L6：前两条让“可续跑 / 可重试”类评估根本测不到 agent，第三、四条让成本与故障面比账面看起来大得多。

1. ~~**timeout ≠ 取消**~~ **本轮已修**：`main.js` 的群 responder turn 现在把编排层的取消作用域（`cancelPromise` / `isCancelled`）传进内核回合（`run_moon_turn.js` 支持 `ctx.cancelPromise`），编排层超时/取消会真的让内核回合停下。**注意**：这是「取消信号到达执行层」，不是「已跑的 provider 请求被撤回」——上游 HTTP 请求本身无法撤销。

2. **同一句话重复问永不重跑**：`product_surface.js:1773` 用 `taskSig = room.id + "|" + task.toLowerCase()`，命中历史 `final_report` 就直接返回旧报告（`:1778-1786`，`deduped:true`），而 `main.js:1796` 的 `orchestrateRoom` 调用**从不传 `force`**。UI 有对应提示卡（`hosts/desktop/index.html:6885-6887`）。任何“可续跑 / 可重试 / 幂等恢复”类评估都必须先处理这条，否则测的是缓存不是 agent。

3. ~~**fail-open 同时是成本放大器**~~ **本轮已修（有界降级）**：selector 整体失败时**不扇出**（如实失败，一个模型调用都不发生）；单个候选失败时按 `maxFailOpen`（默认 2）有界降级，被跳过的人在 `sections` 里记为**失败**而不是「参与」，降级原因写进群转录。`prove_room_orchestrator` 里对应门禁全绿。

4. **群路径有一条静默失效的分支**：只有 Desktop IPC `bitbot:rooms:orchestrate`（`main.js:1780`）会真起 LLM 回合；内核 `room_turn` effect（`hosts/shared/host_ffi.js:24673-24717`）只做路由 + 写 transcript，**不驱动任何 responder 回合** ⇒ CLI / 移动端 / MCP 发的 `room <id> :: <text>` 在群里“没人回”且**不报错**。

## 3. 与主流对比

> 工程判断，不是厂商 benchmark；主流指 Claude Code / Codex / Cursor Agent / OpenHands 这类公开行为。

| 维度 | 主流 agent | BitBot 现在 | 差距 |
|---|---|---|---|
| 自主性 | 计划→执行→观察→继续 | 默认 Chat 已 think→call→observe→continue；非 Chat 仍单轮 | 无 plan/cross-turn 状态 |
| 工具选择 | 模型从 schema 选 | 模型从 Read/Shell schema 选（`tools/types.mbt:63` 的 21 个内置工具里只有 2 个到得了模型） | 工具目录窄，通用 ToolRegistry 未做 |
| 观察回注 | 工具结果进入下一轮 | 结果 fence 后回注本回合下一轮 | 不持久化，不跨回合 |
| 上下文 | 会话历史 + 压缩 | 当前 user + persona + 最近群转录（仅群） | 无 DM 历史/压缩 |
| 记忆 | 自动检索/写入 | 显式短语 + 分槽 | 不自动、不注入 provider |
| 规划 | plan/reflection/todo | 无 | 复杂任务弱 |
| 多 Agent | 角色/委派/共享状态 | 并行 persona 应答；定向 @ 已真；最近转录已接 | 无拆解/共享任务板/综合 |
| 交接 | 目标 agent 真执行 | 写 inbox | 不执行 |
| 共享工作区 | 文件/任务板/产物 | 群 transcript/最近上下文有，工作区/任务板无 | 无团队状态 |
| 安全 | 认证/沙箱/审批 | P0 入站/auth/sandbox 已硬化；P0-3 U | AR-15 未关 |
| 可观测 | trace/eval/回放 | QA gates + `BITBOT_LOOP` trace | 无 agent eval suite |
| 扩展 | 通用 MCP/插件 | Host 侧已是真 MCP client，但服务端硬编码 + 只有 5 个工具 | 生态弱 |
| 发布 | 签名/公证 + 自动更新 | 单实例锁 + electron-updater 自动更新已落；公证钩子已接 | 签名/公证未真跑、更新源是占位地址、升级/回滚 smoke 未做；内核未进 bundle、数据目录仍写 repo |

## 4. 优先级

### 4.1 原则

1. **P0 只给安全**：能远程 RCE 的系统不讨论 agent 体验。
2. **P1 给“真假”**：群聊语义、handoff、Agent Loop、上下文，决定我们是不是 agent。
3. **P1 给“能协作”**：orchestrator + 分工 + 汇总，决定群 Bot 是不是团队。
4. **P2 给“能扩展/能证明”**：MCP、评测、观测。
5. **P3 给“能交付”**：打包、签名、更新、数据目录。

### 4.2 优先级总表

| 优先级 | 事项 | 当前状态 | 规模 | 依赖 |
|---|---|---|---|---|
| **P0** | 远程 turn 认证、默认 loopback、去掉 fixed `approved:true`、shell 沙箱、webhook 签名、body limit、env 清洗 | **Host 面完成**；P0-3 仍内核 U，AR-15 未关 | S | 无 |
| **P1** | 群聊真实性：无 @ 语义、mention 名单、最近转录、handoff 真执行 | **部分**：定向 @ 已真；无 @ 已真选择；最近转录已接；handoff 未做 | M | 无 |
| **P1** | Agent Loop MVP：ToolSpec、`tool_calls`、host 执行、observation 回注、max steps、approval、trace | **默认 Chat 已接**；PP live、通用工具、AR 升裁未完成 | L | 安全 P0 建议先合 |
| **P1** | 上下文与记忆：transcript、token budget、压缩、memory 注入、resume | **未开始**；AgentLoop 仍只带当前 user | L | Agent Loop |
| **P1** | 群编排：orchestrator、任务分解、分工、共享 room state、synthesis、预算/取消 | **未开始**；当前是 Host 并行扇出 + 拼接 | L | Agent Loop + 上下文 |
| **P2** | 共享工作区/task board | **未开始** | M | 群编排 |
| **P2** | MCP 通用化 + 工具权限 | **部分**：Host 侧已是真 client；缺服务端可插拔、discovery/auth、工具权限、通用 schema 映射 | L | Tool contract |
| **P2** | Trace/Eval/回放 | **部分**：有 QA gates/loop trace，无 eval suite | M | Loop + 群编排 |
| **P2** | 规划/反思 | **未开始** | M | Loop + 上下文 |
| **P3** | 打包/签名/更新/数据目录 | **部分**：单实例锁 + electron-updater 自动更新已落；内核未进 bundle、数据目录仍写 repo、签名/公证未真跑、更新源是占位地址、升级/回滚 smoke 未做 | M | 安全/发布 |

## 5. 波次计划

> 状态总览（2026-10-25）

| Wave | 状态 | 证据/口径 |
|---|---|---|
| 0 安全止血 | **Host 面完成；AR-15 未关** | P0 8/0、host 11/0、SK 8/0；P0-3 仍 U |
| 1 群聊真实性 | **已做** | 定向 @ 已真；无 @ 逐 Bot YES/NO 真选择；最近 N 条转录已进 responder prompt；**handoff 已真执行**（AE-21 门禁） |
| 2 Agent Loop MVP | **默认 Chat 已接；未升裁** | WP 49/0、EG 62/0、AU 69/0、A7/A8 23/0；PP `NEEDS_LIVE`；**AE 26/26**（行为门禁）。**WP/EG 的 provider 是 prompt 匹配桩**，只证接线不证模型行为（§0.1、AR-14） |
| 3 上下文与记忆 | **部分** | **会话历史 + token 预算 + 压缩已做**（`runtime/agent_context.mbt`，L3-2/L3-5）。**memory 注入 provider prompt 仍未做** |
| 4 真群编排 | **已做** | `room_orchestrator.js`：拆解 / 确定性分工 / lead 综合 / 共享任务板 / 团队预算 / 取消传播 / 重复劳动率；`prove_room_orchestrator` 69/0；AE-17~AE-21 |
| 5 工具/MCP | **部分** | Read/Shell 已接；Host 侧 MCP client 已是真协议（2024-11-05）；服务端硬编码 + 5 工具、通用 MCP 未做 |
| 6 观测/评测 | **部分** | **AE 行为评测已建**（`scripts/eval/`，26 门禁全绿 + 3 live 待密钥，见 `docs/qa/agent-eval.md`）；QA gates/loop trace 仍在。**无回放**，trace 未落盘 |
| 7 发布/运维 | **部分/本轮改善** | 单实例锁已落（e2e 6/0）；electron-updater 自动更新已落；公证钩子已接但缺凭据会跳过。**内核已进 bundle**（编译成独立二进制 + `extraResources` + KB 等价性门禁），**数据目录已迁 userData**，**`resolveRepoRoot` 探错文件名导致打包必然失效的 bug 已修**。仍缺：**更新源仍是 env/占位地址**、签名/公证未真跑、升级/回滚 smoke 未做 |

### Wave 0 — 止血（P0）

> 当前状态：Host 面已完成并有回归；P0-3 仍是内核 U，按现有口径不关 AR-15。


**目标**：在继续做 agent 之前，先把远程攻击面关掉。

**改动**
- `/v1/turn` 加 bearer token / signed nonce；移动端配 token。
- Desktop 默认 bind `127.0.0.1`；LAN 模式显式开启并告警。
- 删除固定 `approved:true`；审批必须来自当前回合的真实用户动作。
- Shell：最小 env、cwd allowlist、超时/输出上限；不可逆动作仍走审批。
- CN webhook：签名必填 + 常量时间比较；`readBody` 上限。
- 日志/错误/子进程环境清洗 `BITBOT_LLM_API_KEY` 等 secret。
- 补安全回归：未认证 401、坏签名 401、超限 413、shell 无审批拒绝。

**验收**
- 远程无 token 调 `/v1/turn` 返回 401。
- 伪造 origin / 无审批 shell 不执行。
- 现有 smoke + 安全用例全绿。
- 移动端连接文档更新。

**非目标**：不在这一波重写审批 UI。

### Wave 1 — 群聊真实性（P1）

**目标**：先让群聊“说真话”，再谈编排。

**改动**
- **已接**：无 @ 的 `bot_discretion` 逐 Bot 跑 YES/NO，只扇出选中者；全员弃权落 `skipped`；失败 fail-open 且留 `fail_open` 标记。
- `mentioned_names` 只传真正被 @ 的人；无 @ 时为 `[]`；`unknown_mentions` 保持可见。
- **已接**：`buildRoomContext` 增加最近 N 条转录（有预算、脱敏、无密钥；失败只带状态）。
- `handoffTask` 触发目标 Bot 一轮；失败要可见，不能只写 inbox。
- 群 transcript 记录 handoff 请求 + 目标回复；部分失败继续诚实。
- 清理旧 `gp-room-send` 与主 composer 的双路径，或明确 legacy 标记。

**验收**
- `@A` 只跑 A；`@everyone` 跑全员；无 @ 行为与 UI 文案一致。
- Bot 能引用上一轮群消息（同一轮并行 responder 之间仍不保证）；handoff 后目标 Bot 真的产出。
- 群内不出现“已交接但没人执行”。

**非目标**：不在这一波做 lead agent / 任务分解。

### Wave 2 — Agent Loop MVP（P1）

> 当前状态：默认 Desktop/cmd Chat 已接 `AgentLoop::run`，WP/EG/AU 门禁绿；生产 provider live 未跑，AR-01/02/03 未升裁，不宣称 MVP。
>
> ⚠️ WP/EG 的 provider 是 **prompt 匹配桩**（`scripts/prove_agent_loop_product_wire.js:62-86` `classify()`、`scripts/prove_agent_loop_electron_midrun.mjs:80` `classify()`），按 prompt 字符串决定这轮返回什么工具；断言的是接线不变量（`:233` `trace.kernel_ops === trace.node_ops`），**不是“模型会不会正确选工具”**。这两条门禁不能当模型行为证据用。

**目标**：让模型真的能“选工具 → 执行 → 看结果 → 继续”。

**改动**
- 定义 `ToolSpec`：name、description、JSON schema、approval、timeout、untrusted。
- LLM request 带 `tools`；解析 `tool_calls`（流式 + 非流式）。
- Host 执行工具，结果作为 observation 回注下一轮。
- `AgentLoop` 状态机：`think → call → observe → think`，`max_steps`、取消、错误重试。
- 工具结果 fence/untrusted 标记；审批在工具调用边界。
- 记录 `AgentStep` trace：model、tool、args、result、duration、error。
- 至少接 2 个工具：`fs_read`、`shell`（或 `web_search`）。

**验收**
- 固定场景：读文件 → 根据内容再读一个文件 → 汇总；3 步内完成。
- 无 `tool_calls` 时正常 final；未知工具/坏参数有可读错误。
- 超过 max steps / 用户取消能停；无无限循环。
- 现有 `moon test` + Host smoke 不回归。

**非目标**：不在 MVP 做多 Agent 调度。

### Wave 3 — 上下文与记忆（P1）

**目标**：多轮不失忆，长任务不爆上下文。

**改动**
- 会话 transcript 持久化：user/assistant/tool/observation。
- token budget：保留最近轮 + 摘要 + 关键工具结果；超限压缩。
- memory recall 注入 provider prompt（带来源/时间/置信度）。
- 写入策略：显式 remember + 受控自动抽取；敏感信息脱敏。
- session resume：重启后恢复 transcript 与 todo。
- 上下文隔离：DM/群/不同 Bot 不串。

**验收**
- 20 轮对话后仍能引用早期约束。
- 重启后恢复最近上下文。
- 压缩后总 token 在预算内，关键事实不丢。
- 记忆命中可解释；A Bot 的记忆不出现在 B Bot。

### Wave 4 — 真群编排（P1）

**目标**：从“多 Bot 同时回答”变成“一个团队完成任务”。

**改动**
- 增加 orchestrator（Host 确定性调度 + 可选 lead Bot 汇总）：
  - 理解任务
  - 拆子任务
  - 分配成员
  - 收集结果
  - 去重/补漏/综合
- 每成员收到：自己的子目标 + 共享上下文摘要 + 自己的 persona/记忆/工具。
- 共享 room state：任务板、产物、handoff、状态。
- 预算：最大轮次、最大成员、token/时间/成本；取消传播。
- `final_report` 分成“成员结果”和“lead 综合答案”，不混为一谈。
- 群级 trace：谁做了什么、交接给谁、失败在哪。

**验收**
- “调研 A 和 B 并比较”被拆成两个子任务，两个成员执行，lead 汇总。
- 重复劳动率可测；无“全员重复同一答案”。
- 部分失败仍给出可用的综合结果，并标注缺口。
- 超过预算/取消时所有成员停止。

### Wave 5 — 工具/MCP 扩展（P2）

**目标**：工具生态可用，而不是测试桩。

**改动**
- 通用 MCP client：stdio/HTTP、discovery、auth、tool schema 映射。
- 工具权限：按 agent/room/工具粒度；不可逆动作审批。
- 工具结果 untrusted fence；大小/超时/错误上限。
- MCP server 生命周期、健康检查、失败降级。
- 插件安装/卸载与工具目录同步。

**验收**
- 接一个外部 MCP server，模型能发现并调用工具。
- 未授权工具拒绝；审批记录可追溯。
- 工具输出不能直接变成指令（fence 测试）。

### Wave 6 — 观测与评测（P2）

**目标**：能证明 agent 变好，而不是靠感觉。

**改动**
- Trace：turn → step → tool → observation → approval → result。
- 指标：任务成功率、工具成功率、步数、token、时延、成本、handoff 完成率、重复劳动率。
- Eval suite：至少 20 个固定场景（单工具、多步、失败恢复、群协作、安全拒绝）。
- CI 门槛：核心场景全绿；性能/成本回归可见。
- 回放：按 trace 重现失败。

**验收**
- 每次 PR 有 agent eval 结果。
- 失败可定位到 step/tool。
- 安全用例 100% 通过。

### Wave 7 — 发布/运维（P3）

> ⚠️ **本节的残项正在被并行修**：工作树里已经出现 `hosts/desktop/paths.js`（新模块，替换内联 `resolveRepoRoot()`）、`hosts/desktop/main.js` 的路径解析改动，以及 `scripts/pack-desktop.sh` 的「内核编译进 bundle」改动。下文“内核未进 bundle / `resolveRepoRoot()` 硬编码 / `moon.mod.json` 探测”是按**基线 `244515b`** 记的；那批改动落地后，本节与 §2.3 AR-16、§3 发布行都要重新核对，不能直接把本节当现状读。

**目标**：干净机器能装、能升级、数据不丢。

**改动**
- 内核二进制/`cmd/` 进入 bundle；去掉 `resolveRepoRoot()` 硬编码（`hosts/desktop/main.js:137-161` 仍探 `/Users/zfl/Downloads/bitbot`；`:126,146` 探的是 `moon.mod.json`，而 MoonBit 的模块文件是 `moon.mod`）。
- 数据目录移到 `app.getPath("userData")`；不写 app bundle（当前仍写 `<REPO_ROOT>/data`，`main.js:180,199`）。
- **已接（不再是待做）**：单实例锁——`main.js:25` `app.requestSingleInstanceLock()`，`:23-24` `BITBOT_DISABLE_SINGLE_INSTANCE` 负向对照，`:29-35` `second-instance` 把已有窗口唤到前台；门禁 `scripts/e2e_desktop_single_instance.mjs` 6/0。
- **已接（不再是待做）**：自动更新——`main.js:113` 载入 electron-updater，`:2568` 注释 "P4 auto-update — real electron-updater"，`:2603` `setFeedURL`，`:2607` `checkForUpdates()`，`:2640` `downloadUpdate()`，`:2650` `quitAndInstall(false,true)`；`hosts/desktop/package.json:98` 依赖 `electron-updater ^6.3.9`，`:48` publish generic provider。公证钩子也已接：`package.json:47` `afterSign: build/notarize.js` → `hosts/desktop/build/notarize.js:28-34` 调 `@electron/notarize`，缺 `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` 时诚实跳过（不假装已公证）。
- **仍未做**：签名/公证**真跑**一次；更新源换成**真地址**（当前是 `BITBOT_UPDATE_FEED_URL` 环境变量 + `package.json:51` 占位 `https://updates.bitbot.local/desktop`）；升级/回滚 smoke。
- CSP、日志轮转、崩溃恢复。
- vault key 接 OS Keychain。
- 安装/升级/回滚 smoke。

**验收**
- 无 repo 的干净机器安装后可启动、可 turn。
- 升级不丢 sessions/rooms/memory。
- 卸载/重装可恢复用户数据（按产品策略）。

## 6. 文档清单

> 这是“文档清单 + 优先级”，不是要求一次写完全部。P0/P1 文档先落，P2/P3 随实现补。<br>
> 新建文档先用 backtick 标记，避免未创建文件的死链。<br>
> 状态按 2026-10-25 工作树核对；“部分”通常表示内容已有但分散，或代码已实现而文档未合并。

| ID | 文档 | 类型 | 状态 | 动作 | 优先级 | 必须回答 |
|---|---|---|---|---|---|---|
| D01 | `docs/agent-core/README.md` | explanation | **已建/已更新** | 维护 | P0 | 现状/缺口/优先级/波次/文档索引 |
| D02 | `docs/agent-core/01-agent-loop.md` | reference | **部分**：拆在 `01-agent-loop-product-path.md`、`...production-provider.md`、`...electron-midrun.md` | 合并/补状态机总览 | P1 | 状态机、tool loop、max steps、取消、错误、审批、trace |
| D03 | `docs/agent-core/02-tool-calling.md` | reference | **部分**：schema 在代码，无契约文档 | 新建 | P1 | ToolSpec schema、`tool_calls`、observation、untrusted、错误模型 |
| D04 | `docs/agent-core/03-context-and-memory.md` | reference | **未建** | 新建 | P1 | transcript、token budget、压缩、memory 注入、隐私、resume |
| D05 | `docs/agent-core/04-multi-agent.md` | reference | **未建** | 新建 | P1 | 角色、路由、共享上下文、handoff、orchestrator、synthesis、预算 |
| D06 | `docs/agent-core/05-security.md` | reference | **已建**（+2 子文档） | 随 P0-3 补 | **P0** | 威胁模型、认证、bind、沙箱、审批、secret、webhook、CSRF |
| D07 | `docs/agent-core/06-observability-eval.md` | reference | **部分**：QA gates / `BITBOT_LOOP` trace | 新建汇总 | P2 | trace、metrics、eval 场景、CI 门槛、回放 |
| D08 | `docs/agent-core/07-release-ops.md` | reference | **未建** | 新建 | P3 | bundle、data dir、签名、更新、单实例、CSP、回滚 |
| D09 | `docs/agent-core/08-acceptance.md` | reference | **部分**：WP/EG/PP/AU/SK/P0 gates 已有 | 合并为统一 AR 验收 | P1 | 每个 AR 的验收用例/命令/期望 |
| D10 | `docs/04-interface-contracts.md` | reference | **已有/需更新** | 补 AgentLoop 类型 | P1 | `ToolSpec`/`ToolCall`/`ToolResult`/`AgentStep`/`RoomPlan` |
| D11 | `docs/05-runtime-turn-lifecycle.md` | explanation | **部分**：已补 AgentLoop 主路径 | 补取消/审批细节 | P1 | 单轮 → loop；observation 回注；取消/审批边界 |
| D12 | `docs/02-module-map.md` | reference | **已有/需更新** | 补新模块边界 | P2 | 新模块（agent loop/context/multiagent）边界 |
| D13 | `docs/ROADMAP.md` | explanation | **已更新** | 维护 | P1 | 增加 M8 Agent Core / M9 Multi-Agent |
| D14 | `docs/capability-matrix.md` | reference | **已有/需更新** | 补 CM≠AR 口径（不改矩阵，AU 会校验） | P1 | 注明 `CM-* PASS ≠ AR-*`；不要混用口径 |
| D15 | `docs/qa/acceptance-plan.md` | reference | **已有/需更新** | 补 agent-core 验收 | P1 | agent-core 验收计划 |
| D16 | `docs/qa/gaps.md` | reference | **已有/需更新** | 补 AR residual | P1 | AR residual / 证据 / 升裁 |
| D17 | `docs/design/desktop-target/report.md` | explanation | **部分**：§8.7 已加链接 | 维护 | P1 | §8 加本路线图链接；保持 Host 路径口径 |
| D18 | `docs/host-integration-interface-gaps.md` | reference | **已有/需更新** | 补 MCP residual | P2 | 真实 MCP/FFI 的剩余缺口 |
| D19 | `docs/grok-desktop-parity/gaps.md` | reference | **已有/需更新** | 补上下文/记忆 residual | P2 | 记忆自动抽取/上下文残留 |
| D20 | `docs/adr/0006-agent-loop-and-tool-calling.md` | ADR | **未建**；边界暂由 D02 承担 | 新建/可选合并 | P1 | 为什么 loop 在 Kernel、执行在 Host |
| D21 | `docs/adr/0007-group-orchestrator-and-handoff.md` | ADR | **未建** | 新建 | P1 | orchestrator 归属、handoff 执行语义、预算 |
| D22 | `docs/adr/0008-remote-turn-auth-and-sandbox.md` | ADR | **已建** | 维护 | **P0** | `/v1/turn` 认证、bind、shell 沙箱、审批不可伪造 |
| D23 | `docs/adr/0009-kernel-host-single-path.md` | ADR | **未建** | 新建 | P1 | 群 composer 单一路径；Kernel 合同 vs Host 产品路径 |

### 6.1 文档写作顺序

1. **D06 + D22（P0 安全）已完成**；剩余是 P0-3 内核 U 与 AR-15 升裁，不在文档层假装关闭。
2. **D02/D03/D10/D11（Agent Loop）**：代码已到 L2，下一步把分散证据合并成状态机/工具契约，并更新接口与生命周期文档。
3. **D05 + D21 + D09（群编排）**：orchestrator/handoff/共享上下文语义先定，再动 Host 代码。
4. **D04（上下文/记忆）**、**D15/D16（验收）** 随实现补齐。
5. **D07/D08（P2/P3）** 在对应波次前写，不提前写空文档。
6. **D20/D23** 可在群编排与单一路径落地时一起写，避免 ADR 先于决策。

## 7. 需要拍板的产品决策

| # | 决策 | 建议默认 | 理由 |
|---|---|---|---|
| 1 | 群聊无 @ 默认谁回答 | 有 orchestrator 时由 orchestrator 决定；无 orchestrator 时明确“全员响应”并显示 | 不能标签 `bot_discretion` 行为全员 |
| 2 | orchestrator 归属 | Host 确定性调度 + 可选 lead Bot 只做汇总 | 安全/预算不能交给模型自由决定 |
| 3 | 群记忆边界 | room 共享上下文 + per-agent 私有记忆；不自动跨 Bot 泄漏 | 协作需要共享，隐私需要隔离 |
| 4 | handoff 语义 | 目标 Bot 真执行一轮；不可执行时显示 pending，不假装完成 | 交接单 ≠ 执行 |
| 5 | Kernel/Host 单一路径 | Kernel 拥有 intent/contracts；Host 拥有执行/编排；只保留一条群路径 | 避免双实现漂移 |
| 6 | 工具审批粒度 | 不可逆动作 per-agent 审批；共享动作 room 级审批 | 安全与协作平衡 |

## 8. 风险登记

| 风险 | 触发 | 缓解 |
|---|---|---|
| 远程 RCE | `/v1/turn` 无认证 + LAN + shell | Host 面已落认证/loopback/沙箱/审批；P0-3 仍内核 U，AR-15 未关 |
| Host/Kernel 漂移 | 群 composer 走 Host，内核另有 `RoomTurn` | ADR 0009；一条路径；合同测试 |
| 成本爆炸 | 群全员 + 多步 loop + 无预算 | max agents/rounds/tokens/time；取消传播 |
| 上下文泄漏 | 群共享 transcript / memory 注入 | 脱敏、作用域、来源标注、最小注入 |
| 评测盲区 | 只有 smoke，没有 agent eval | 20 场景 + CI 门槛 |
| 装不上 | bundle 缺内核/硬编码路径 | Wave 7；干净机器 smoke |
| 群扇出不可取消 | `withTimeout` 只 reject 外层 promise + 群 responder turn 不传 `cancelPromise` | 把 timeout 升级成真取消；先立 token/时间预算（§2.3.1） |
| 同一句群消息永不重跑 | `taskSig` 幂等命中即返回旧 `final_report`，调用点从不传 `force` | 显式 `force`/续跑语义；评测脚本必须绕开缓存（§2.3.1） |

## 9. 非目标

- 不在本路线图做 UI 像素对齐/主题细节。
- 不在群共享上下文/路由真实性/handoff 执行落前，继续加更多群 Bot。
- 不把 `CM-*` 234/234 当作 agent runtime 已对标。
- 不扩展 Python LocalBrain。
- 不让模型决定认证、审批、沙箱策略。
- 不为了“多 Agent”而让多个 Bot 重复做同一件事。

## 10. 验收指标

| 指标 | 目标 | 说明 |
|---|---|---|
| Agent 场景通过率 | 先建基线；P1 固定 5 场景全绿；P2 扩到 20 | 不虚报百分比 |
| 工具调用成功率 | 按工具分别统计 | 失败要可归因 |
| 平均步数/任务 | 有上限，异常可告警 | 防死循环 |
| 上下文 token | 在预算内；压缩后关键事实不丢 | 可回放 |
| 群重复劳动率 | 逐波下降 | 衡量“分工”是否真实 |
| handoff 完成率 | 请求→执行→回复闭环 | 不把写 inbox 算完成 |
| 安全用例 | 100% 通过 | 未认证/坏签名/无审批/超限 |
| 成本/时延 | 每任务可见，有预算 | 群/长任务重点 |
| 取消/超时传播 | 超时后模型调用真的停止 | 现在 timeout≠取消，超时后仍烧 token（§2.3.1） |
| 重跑/续跑 | 同一任务能显式重跑并出新报告 | 现在被 `taskSig` 幂等去重挡住（§2.3.1） |

## 11. 证据索引

| 证据 | 证明 |
|---|---|
| `runtime/agent_loop.mbt` `AgentLoop::run` | 内核拥有 model→tool→observe→repeat；64 步、取消、未知工具/坏参数、审批 allow/deny/cancel、untrusted fence |
| `cmd/desktop_turn/agent_loop_product_native.mbt` | 默认 Desktop/cmd Chat：`open_turn` + `AgentLoop::run`；默认 Read/Shell registry；legacy `--legacy-chat-effect` 才退回旧路径 |
| `hosts/shared/agent_loop_product_wire.js` | Host 四操作映射；`llm_chat` / `exec_tool` / `request_approval` / `deliver`；Read/Shell 参数与审批动作规范化 |
| `hosts/shared/host_ffi.js` `agentLoopToolSchema` | provider 请求带 Read/Shell 完整 JSON Schema（`:5576-5603`）；**非空 schema 不是旧 `{}`**——但它与内核侧那份是分离的（见下两行） |
| `cmd/desktop_turn/agent_loop_product_native.mbt` `product_tool_registry` | 内核侧工具 schema 只有 `{"required":["path"]}` / `{"required":["command"]}`（`:67,74`，无 type/properties）——**加工具要同时改内核 + Host 两处** |
| `runtime/types.mbt` `ToolRegistry::seed_builtins` | `{}` schema 只出现在这里（`:20`），且只被 `runtime/pipeline_test.mbt:28`、`runtime/types_test.mbt:3` 引用；产品路径走 `bitbot.mbt:21` `ToolRegistry::empty()`（`cmd/main/main.mbt:3-5` 启动） |
| `runtime/transcript.mbt` `TranscriptStore` / `ToolCallTrace` | `TranscriptStore`（`:78`）无外部引用，是死代码；`ToolCallTrace`（`:28`）只有 `tool_name`/`args_json`/`result_snippet`，无 duration/error/时间戳 |
| `scripts/host_h4_mcp_client.py` `mcp_session` | Host 侧真 MCP client：initialize + notifications/initialized 握手、Content-Length 分帧（`:17` `_encode` / `:22` `_read_one`） |
| `scripts/host_h4_mcp_stdio.py` `TOOLS` | 服务端硬编码 + 只有 5 个工具（`:38`）；`hosts/shared/host_ffi.js:292` 固定指向它——真缺口在服务端不在 client |
| `hosts/desktop/main.js` `requestSingleInstanceLock` | 单实例锁已落（`:25`；负向对照 `:23-24`；`second-instance` 聚焦 `:29-35`）；门禁 `scripts/e2e_desktop_single_instance.mjs` 6/0 |
| `hosts/desktop/main.js` electron-updater / `hosts/desktop/package.json` | 自动更新已落（`:113,2568,2603,2607,2640,2650`；`package.json:98` 依赖、`:48` publish generic）；公证钩子 `package.json:47` → `hosts/desktop/build/notarize.js:28-34`（缺凭据诚实跳过） |
| `hosts/desktop/product_surface.js` `orchestrateRoom` | 幂等去重 `taskSig`（`:1773`、`:1778-1786`）+ `withTimeout` 不终止正在跑的回合（`:1803-1809`） |
| `hosts/desktop/main.js` `selectRoomResponders` | fail-open：失败/超时 ⇒ `respond:true, fail_open:true`（`:1756-1770`）；群 responder turn 不传 `cancelPromise`（`:1637`），DM 路径才传（`:2921`） |
| `hosts/shared/host_ffi.js` `room_turn` effect | 只路由 + 写 transcript，不驱动 responder 回合（`:24673-24717`）；只有 Desktop IPC `main.js:1780` 会真起 LLM 回合 |
| `hosts/shared/host_ffi.js` `webSearch` | 真实 web 检索在 Host JS（Tavily/Brave，`:5522`）；`tools/web.mbt:49` `WebHost::mock()` 只是内存假实现 |
| `tools/types.mbt` `BuiltinTool::all()` | 21 个内置工具（`:63`），但模型只够得着 Read/Shell 两个 |
| `hosts/shared/host_ffi.js` `consumeSseDataLine` / `httpJsonStream` | 流式与非流式都保留 `delta.content` + `tool_calls`（A7/A8） |
| `hosts/shared/run_moon_turn.js` `pumpMoonFfi` | 内核每行 FFI 请求只回一行 JSON；Node 不 own loop；`kernel_ops`/`node_ops` 可对账 |
| `hosts/shared/run_moon_turn.js` `kernelLoopTrace` | `BITBOT_LOOP entry=AgentLoop::run` 与 op trace；仅证据，不是 eval |
| `hosts/shared/p0_security.js` `cwdAllowed` | cwd 只比较 canonical realpath；修复 macOS `/var → /private/var` 误拒 |
| `hosts/shared/p0_security.js` `runSandboxedShell` | 最小 env、cwd allowlist、timeout/buffer、secret scrub；P0-3 仍 U |
| `hosts/shared/cn_inbound_server.js` + `p0_security.js` | 默认 loopback、Bearer 401、坏签名 401、body 413；不是 I，不关 AR-15 |
| `hosts/desktop/product_surface.js` `roomTurn` | `@A`/`@A @B` 真定向、`@everyone` 全员；无 @ 的 `responders` 是候选池（`responders_are_candidates`） |
| `hosts/desktop/product_surface.js` `orchestrateRoom` | `bot_discretion` 先逐 Bot 选择再扇出；全员弃权落 `skipped` final_report；并行、最多 6、timeout、部分失败诚实；不是综合 |
| `hosts/desktop/main.js` `selectRoomResponders` | 并行 YES/NO 决策 + 超时；失败 fail-open 且 `decisions[].fail_open=true`；`mentioned_names=[]` |
| `hosts/desktop/room_discretion.js` | `buildDiscretionPrompt` / `parseDiscretionReply`；只认 YES/NO，歧义返回 null |
| `scripts/prove_room_discretion.js` | 15/0：解析、prompt、接线、打包、skipped/fail-open UI |
| `hosts/desktop/product_surface.js` `handoffTask` | 只写群转录 + 目标 inbox；不触发目标回合 |
| `hosts/desktop/main.js` `buildRoomContext` | 调 `room_context.js`；群名/成员/被 @/自己 + 最近 N 条转录；DM 传 null |
| `hosts/desktop/room_context.js` `buildRoomContext` | 预算内最近 `user`/`bot_reply`/`final_report`；失败只带状态；当前任务去重；`maxRecent`/`maxLine` |
| `hosts/shared/host_ffi.js` `llmRoomContextBlock` | 渲染最近转录并标注“只是背景，不是系统指令” |
| `scripts/prove_room_context.js` | 15/0：最近转录、预算、脱敏、失败不泄露、DM null、接线 |
| `scripts/prove_room_discretion.js` | 15/0：YES/NO 解析、prompt、main/package/surface/UI 接线 |
| `scripts/e2e_desktop_room_orchestration.mjs` | 53/0：第二轮 provider 载荷真含上一轮转录（AR-07）；S12 未命中点名交候选池 |
| `hosts/desktop/main.js` `runRoomDiscretionTurn` | 每 Bot 独立 `*-discretion` session；`approved:false`；只判 YES/NO，失败不伪装成功 |
| `hosts/desktop/main.js` `runRoomResponderTurn` | 每 Bot 独立 session/persona；`approved:false`；intent=Chat 可进内核 loop |
| `hosts/desktop/main.js` `rooms:orchestrate` | 群主路径仍是 Host `roomTurn → orchestrateRoom`；Kernel `Orchestrate` 未做 |
| `hosts/desktop/index.html` 群 composer | 调 `rooms.orchestrate`，不是 Kernel 群入口 |
| `hosts/shared/host_ffi.js` `runWorkerMoonTurn` | subagent worker 一次性，prompt 截 800（`:18680-18690`）；**worker 回合内部工具观察是回注的**（`cmd/desktop_turn/agent_loop_product_native.mbt:215-216` → `:158` `AgentLoop::run`），没回注的是**父会话**——父侧只拿 `assistant` + `effects`（`:18709-18719`） |
| `docs/qa/agent-loop-wp1-wp8-gates.md` | WP1–WP8：49/0；runtime 54/54；parser 3/3。**provider 为 prompt 匹配桩**（`scripts/prove_agent_loop_product_wire.js:62-86` `classify()` 按 `blob.includes("WP1-READ")` 之类匹配），只证明接线（`:233` `trace.kernel_ops === trace.node_ops`），**不证明模型行为** |
| `docs/qa/electron-chat-agent-loop-gates.md` | EG1–EG6：62/0；Electron mid-run/取消。**provider 同为 stub**（`scripts/prove_agent_loop_electron_midrun.mjs:80` `classify()`），同样只证明接线、不证明模型行为 |
| `docs/qa/host-approval-ui-gates.md` | AU1–AU7：69/0；审批卡/一次性 runAllowed |
| `docs/qa/agent-loop-a1-a8-gates.md` | A1–A8；A7/A8 23/0 |
| `docs/qa/production-provider-gates.md` | PP1–PP7；当前 `NEEDS_LIVE`，PP1–PP4 未跑 live |
| `docs/qa/p0-security-gates.md` | P0 curl 8/0、host-checks 11/0；P0-3 U |
| `docs/agent-core/05-security-sandbox-secrets.md` | SK1–SK8：8/0；不是 P0，不关 AR-15，不升 I |
| `docs/capability-matrix.md` | 234 CM / I-PASS；合同面，不是 AR eval |
| `docs/qa/gaps.md` | 验收与 residual 口径 |

## 12. 变更记录

- 2026-10-24：初版。基于 agent core 审计、群 Bot 路径追踪、P0 安全审计、打包/数据审计整理。
- 2026-10-24：入站重新接上 `p0_security`（Bearer 401、坏签名 401、body 413、默认 loopback、入站不固定 `approved:true`、shell 最小 env）。P0-3 维持内核 U，不升 I。AR-15 不关。不宣称 MVP。
- 2026-10-24：SK1–SK8 沙箱与密钥立证（allowlist env、审批不放开密钥、cwd、超时/缓冲、scrub、手机不持模型密钥）。不是 P0，不是 AU。P0 host-checks 不算本 residual 已关。不关 AR-15，不升 I，不宣称 MVP。
- 2026-10-24：`prove_sandbox_secrets` 的 `ok SK1`…`ok SK8` 改与 `05-security-sandbox-secrets.md` §4 逐字同构。SK3 是产物，SK4 是 cwd，SK5 是 scrub，SK6 是超时加缓冲，SK7 是 health/401/413 响应体不泄漏 turn token 与 LLM API key，SK8 是 P0 绿、P0-3 仍 U、AU 不倒裁。phone host 不是 SK7。danger/echo 不是 SK8。不关 AR-15，不宣称 residual 已关，不升 I。
- 2026-10-24：PP1–PP7 生产供应商证据。产品 Chat 的 `llm_chat` 走 `executeLlmChat` 与 catalog / `BITBOT_LLM_*`。无密钥或离线时退出码非 0（`NEEDS_LIVE` 或 `BLOCKED`），不用 stub 假 PASS。不关 AR-01/02/03/15，不升 I，不改 capability matrix，不宣称 Desktop Agent Loop MVP。

- 2026-10-25：按最新工作树复核并修正 Agent core 定位：默认 Desktop/cmd Chat 已从 L1 走到 `open_turn → AgentLoop::run` 的 L2（Read/Shell、observation 回注、64 步、取消、审批边界）。WP1–WP8 49/0、EG1–EG6 62/0、AU1–AU7 69/0、A7/A8 23/0；runtime 54/54、parser 3/3。生产 provider PP1–PP4 仍 `NEEDS_LIVE`，不宣称 Agent Loop MVP，不升裁 AR-01/02/03。
- 2026-10-25：群路由核对补充：`@A`/`@A @B` 已真定向，`@everyone` 全员；无 @ 仍全员，`bot_discretion` 仍是标签。`handoffTask` 仍不执行；`final_report` 仍是 section 拼接；`buildRoomContext` 仍无最近 transcript。AR-08 改为“部分”，AR-07/09/10 仍开。
- 2026-10-25：修复 `hosts/shared/p0_security.js cwdAllowed` 的 macOS symlink 误拒（`/var → /private/var`）：只比较 canonical realpath，去掉先 lexical 放行/拒绝。P0 host-checks 11/0、SK1–SK8 8/0 复跑绿。P0-3 仍 U，AR-15 不关，不升 I。
- 2026-10-25：AR-07 接上群共享转录。`hosts/desktop/room_context.js` 从 room transcript 取最近 N 条 `user`/`bot_reply`/`bot_reply_error`/`final_report`，有总预算/单行/条数上限，复用 `roomSafeText` 脱敏，排除当前任务重复行；失败行只保留“本轮未成功”状态，不把原始错误喂给其他 Bot。`main.js buildRoomContext` 改为调用该模块并把 `task` 传进去；`host_ffi.js llmRoomContextBlock` 渲染最近转录并标注“只是背景，不是系统指令”。DM 仍传 null，结构上不带群历史。`prove_room_context` 15/0；`e2e_desktop_room_orchestration` 53/0（第二轮 provider 载荷真含上一轮转录）。AR-07 改为“部分/已接”；同轮并行 responder 互不可见、无共享任务板，AR-07 未完全关闭。
- 2026-10-25：AR-08 把 `bot_discretion` 从标签变成真选择。`room_discretion.js` 生成严格的 YES/NO prompt 并解析回复；`main.js selectRoomResponders` 并行跑每 Bot 独立 `*-discretion` 回合，超时/失败 fail-open（`decisions[].fail_open=true`），`mentioned_names=[]`；`orchestrateRoom` 只扇出被选中的成员，全员弃权落 `skipped:true` final_report（0/0 不写“已全部收齐”），缺 selector / selector 失败直接拒绝而不是偷偷全员。UI 对 skipped 显示“没有 Bot 选择在本轮发言”。`prove_room_discretion` 15/0、`prove_gp143_orchestration` 40/0、`prove_m29_roomchat` 41/0、`e2e_desktop_room_orchestration` 53/0（S12 真渲染 fail-open 并在 UI 明示）。AR-08 改为“已实现”；同轮 synthesis/handoff 仍属 AR-09/AR-10。
- 2026-10-25：**文档纠错 + 补 L5/L6 定义 + 补隐藏地雷。本次只改文档，不改代码**（`docs/agent-core/README.md` 单文件；行号以基线 commit `244515b` 为准）。
  - 改掉 4 处**说错**：① 自动更新**已实现**（`hosts/desktop/main.js:113,2568,2603,2607,2640,2650` + `hosts/desktop/package.json:98,48`；公证钩子 `package.json:47` → `hosts/desktop/build/notarize.js:28-34`），§3 发布行 / §4.2 P3 / §5 Wave 7 改为“已落自动更新 + 单实例锁，剩签名/公证真跑、更新源真地址、升级/回滚 smoke”；② 单实例锁**已落**（`main.js:25`、`:23-24`、`:29-35`；`scripts/e2e_desktop_single_instance.mjs` 6/0），从 Wave 7 待做清单删除；③ “boot registry 仍把 schema 写成 `{}`”打偏了——`{}` 只在 `runtime/types.mbt:20` `seed_builtins()`（只被两个测试引用），真实 boot 走 `bitbot.mbt:21` `ToolRegistry::empty()`；改为新增真问题“**两份 schema 分离**”（内核 `agent_loop_product_native.mbt:67,74` vs Host `host_ffi.js:5576-5603`）；④ MCP 现状描述不准——Host 侧是符合 2024-11-05 的**真 client**（`scripts/host_h4_mcp_client.py:45`），真缺口是服务端硬编码 + 5 个工具（`host_ffi.js:292`、`host_h4_mcp_stdio.py:38`）。
  - 改掉 2 处**说得太乐观**：⑤ `TranscriptStore`（`runtime/transcript.mbt:78`）是死代码，`ToolCallTrace`（`:28`）只有 3 个字段、无 duration/error/时间戳；⑥ WP 49/0 / EG 62/0 的 provider 是 **prompt 匹配桩**（`scripts/prove_agent_loop_product_wire.js:62-86`、`scripts/prove_agent_loop_electron_midrun.mjs:80`），只证接线不证模型行为——这是 AR-01/02/03 迟迟不升裁的根子，已在 §0.1 / §2.3 AR-01/AR-14 / §5 Wave 2 / §11 逐处标注。
  - 新增：§1.2 的 **L5（团队运行时）/ L6（自治团队）** 两级定义（仓库原有阶梯到 L4，L5/L6 按仓库自身词汇推得，不是外部标准）；§2.2.1「已存在但未接线的原语」（todo_write / 并行工具 / 自主性判定 / 审批重试指纹 / 诚实门 / 工具 trace / 任务恢复 / 动态工具目录，**到 L3/L4 的主要工作量是接线不是从零造**）；§2.3.1「文档未记录但影响 L4+ 的行为」四条地雷（timeout≠取消且群扇出不可取消、同一句群消息永不重跑、fail-open 同时是成本放大器、群路径的静默失效分支）。
  - 补两条正面事实：Host 侧工具 schema 其实是完整的、内核侧才是极简的，且 21 个内置工具里只有 2 个到得了模型；真实 web 检索在 Host JS（`host_ffi.js:5522`），`tools/web.mbt:49` `WebHost::mock()` 只是内存假实现。
  - 修正一条不准确表述：Subagent worker **不是**“不回注工具结果”——worker 起的是真内核回合（`host_ffi.js:18680-18690`），工具观察在 worker 回合内部是回注的（`agent_loop_product_native.mbt:215-216` → `:158`）；没回注的是父会话（父侧只拿 `assistant` + `effects`，`host_ffi.js:18709-18719`）。

- 2026-10-26：**L3→L6 第一轮落地**（代码 + 文档同步）。基线 `244515b`，本轮改 `runtime/`、`cmd/desktop_turn/`、`hosts/`、`scripts/`、`docs/`。
  - **L3（内核）**：`runtime/agent_context.mbt` 新增 `AgentContext`——会话历史、token 预算（**估算**，字符数/4）、压缩、`plan_block` / `lead_block`、`wire_messages` 投影成 provider 消息；`runtime/agent_loop.mbt` 重写状态机：失败分类（`LoopFailureKind`）、重试上限、两个停止条件（步数 + 预算）、步数上限可下调但**硬顶 64 不可破**（`effective_max_steps`）。`TodoWrite` 进 registry，内核自己处理，todo 清单进下一轮上下文。`runtime` 71/71、全仓 `moon test` 418/418。
  - **L4（群编排）**：`hosts/desktop/room_orchestrator.js` 新增——`decomposeTask` / `normalizeSubtaskProposal`（模型只建议）/ `assignSubtasks`（宿主确定性轮转）/ `buildSynthesisPrompt`（lead 综合）/ `createRoomBoard`（共享任务板，**有读回 prompt 的路径**）/ `createTeamBudget`（轮次+时间+token）/ `createCancelScope` / `duplicateWorkRate`（重复劳动率）。`product_surface.js` 新增 `handoffTaskAsync`（handoff 真执行）、`setRoomRuntimeDeps`、综合/拆解/预算 deps。`hosts/shared/host_ffi.js` 的 `handoff_task` effect 优先走执行路径。`scripts/prove_room_orchestrator.js` 69/0。
  - **L5（工具生态）**：**工具 schema 单一源**——内核 registry 的 `input_schema_json` 升级为完整 JSON Schema，由 `product_tool_schema_json()` 随 `llm_chat` FFI 请求下发，Host 流式/非流式两处都优先用内核那份。**没有**把 21 个内置工具全暴露给模型：Host 侧 `execProductTool` 只实现 Shell/Read，暴露其余只会让模型选到必然失败的工具——这是有意留下的诚实边界。
  - **L6（可交付）**：**内核编译进 bundle**（`moon build --target native` → 独立可执行文件 → `hosts/desktop/resources/kernel/bin/` → electron-builder `extraResources`），目标机器不再需要 MoonBit 工具链或源码树；**数据目录迁 `app.getPath("userData")`**（`hosts/desktop/paths.js`，dev 仍是 `<repo>/data`）；**修掉一个真 bug**——原 `resolveRepoRoot()` 探 `moon.mod.json`（真实模块文件是 `moon.mod`）导致打包后必然找不到内核，还硬编码了 `/Users/zfl/Downloads/bitbot`；`scripts/prove_kernel_binary.sh`（KB 门禁）证明二进制与 `moon run` 逐字段一致、且不依赖源码树。
  - **评测**：新增 `scripts/eval/`（AE 行为评测，29 场景：26 门禁全绿 + 3 live 待密钥）、`docs/qa/agent-eval.md`、`.github/workflows/agent-eval.yml`。**口径纪律**：AE 绿 = 行为达标，WP/EG 绿 = 接线达标，两者不能互相替代；AE 绿**也不关** AR-01/02/03（生产 provider live + P0-3 内核 U 仍开）。
  - **契约变更（明示）**：`AgentLoop.max_steps` 由「强制 64、caller 不可改」改为「caller 可下调，硬顶 64 不可破」。原 A1 / HABI-6 两条测试断言的是旧语义，已改为新契约并补上「抬不高」的验证（L3-1 覆盖 raise→64）。理由：不可下调的预算等于没有预算；真正兜住成本的是那个硬顶。
  - **本轮没关的**：AR-15 / P0-3 内核 U；生产 provider live（PP1–PP4 `NEEDS_LIVE`）；群消息幂等去重（同一句永不重跑）；内核 `room_turn` 那条静默失效路径；同轮并行成员互不可见；MCP 服务端通用化；真成本口径（token 仍是估算）。
