# Agent Core & 多智能体路线图

> 状态：draft · 2026-10-25（按最新工作树复核）<br>
> 范围：Kernel agent runtime + Host 群 Bot 多智能体；不含 UI 像素对齐、垂直 skills、商店上架。<br>
> 证据口径：以当前工作树代码为准；`file:line` 会漂移，引用时以函数名/文件为主。<br>
> 一句话：`CM-*` 234/234 与 385 tests 证明“能力合同/产品面”很完整；Agent Loop 已接到产品 Chat，但生产 provider live 与 AR 升裁未完成；群 Bot 仍是“并行多 Bot 应答”。

## 0. TL;DR

- **已经有的**：Turn 生命周期、Host FFI、审批门、per-bot persona/session、群 Bot 并行扇出、部分聚合、会话隔离、记忆分槽、Routines、Skills、有限 stdio MCP、桌面打包。
- **新接上的**：默认 Desktop/cmd Chat 走 Kernel `AgentLoop::run`；Host 只做 `llm_chat` / `exec_tool` / `request_approval` / `deliver`；Read/Shell 由模型选，工具观察回注，64 步上限，GUI 可取消。
- **仍未关闭**：通用 ToolSpec/工具目录、会话上下文与压缩、memory 注入、规划/反思、群共享任务板/跨成员中间状态、群路由真实性、handoff 执行、orchestrator/汇总、团队预算、真实 MCP client、agent eval。
- **安全**：P0 入站认证、默认 loopback、审批不可伪造、shell 沙箱、webhook 签名、body limit 已落；P0-3 仍是内核 U，按现有升裁口径 **AR-15 未关**。
- **当前定位**：Agent core 在默认 Chat 路径上到 **L2**（模型选工具 + 观察回注）；没有规划/长任务，未到 L3。Group bot 仍是 **并行多 Bot 应答**，不是协作多智能体。
- **优先级**：`P0 安全收口` → `P1 群聊真实性 + Agent Loop 产品级验收` → `P1 上下文/记忆` → `P1 群编排` → `P2 工具/MCP/评测` → `P3 发布/运维`。
- **两条主线并行**：Kernel 负责 loop/tool/context；Host 负责 group/orchestrator/security。不要合成一个巨型 PR。

## 0.1 最新核对（2026-10-25）

| 门 | 最新结果 | 结论 |
|---|---|---|
| `bash scripts/prove_agent_loop_product_wire.sh` | `pass=49 fail=0`；`moon test -p runtime` 54/54；parser 3/3 | 默认 Desktop/cmd Chat 进 Kernel AgentLoop；Read/Shell、观察回注、max steps、取消、审批边界已立 |
| `bash scripts/prove_agent_loop_electron_midrun.sh` | `pass=62 fail=0` | 真实 Electron composer mid-run 投影 `AgentLoop::run`；取消停在内核 `Cancelled` |
| `bash scripts/prove_host_approval_ui.sh` | `pass=69 fail=0` | 审批卡 Allow/Deny、runAllowed 一次性、`args.approved` 不可伪造 |
| `bash scripts/prove_p0_inbound_security.sh` | `pass=8 fail=0`；host-checks 11/0 | 401/401/413、默认 loopback、入站不固定 `approved:true`、shell 最小 env |
| `bash scripts/prove_sandbox_secrets.sh` | `pass=8 fail=0` | SK1–SK8；cwd、env、artifact、scrub、timeout/buffer |
| `bash scripts/prove_production_provider.sh` | `NEEDS_LIVE`（exit 2）；PP6 子进程 exit 2/3 | 无生产密钥，PP1–PP4 未跑 live；不抄成 PASS |
| `node scripts/prove_agent_loop_a7_a8.js` | `pass=23 fail=0` | 流式/非流式 `tool_calls` 解析与拆分保留 |
| `node scripts/prove_room_context.js` | `pass=15 fail=0` | AR-07：最近转录、预算、脱敏、失败只带状态、DM null |
| `node scripts/prove_room_discretion.js` | `pass=15 fail=0` | AR-08：YES/NO 解析、prompt、接线、打包、skipped/fail-open UI |
| `node scripts/e2e_desktop_room_orchestration.mjs` | `PASS=53 FAIL=0 SKIP=0` | 真 Electron + 真内核；第二轮 provider 载荷含上一轮群转录 |

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

> 结论：默认 Chat 的 agent runtime 已从 L1 走到 **L2**，但只覆盖 `Read`/`Shell`、没有会话历史/规划；`CM-*` PASS 仍不能当作 agent 能力评测。WP/EG 绿也不等于 AR-01/02/03 已升裁：生产 provider live 未跑，AR-15 仍开。

### 1.3 为什么群 Bot 现在还不算“协作多智能体”

1. **同一任务广播**：`orchestrateRoom` 给每个 responder 的 `task` 是同一个，没有拆解/分工。
2. **只能看见已落盘的历史**：`buildRoomContext` 已带最近 N 条 `user` / `bot_reply` / `final_report`，失败只带“本轮未成功”状态；但同一轮并行 responder 互相看不到本轮刚生成的回复，也没有共享任务板/中间状态。
3. **没有汇总者**：`final_report` 是把每个 section 拼起来，不是 lead agent 综合判断后的答案。
4. **无 @ 的选择是独立判断，不是团队协商**：`roomTurn` 支持 `@A` / `@A @B` 定向；无 @ 时 `responder_policy="bot_discretion"` 现在由每个候选 Bot 独立跑 YES/NO 回合，只扇出选中者（`mentioned_names=[]`），全员弃权落 `skipped`。但每个 Bot 只看任务+已有转录，没有互相提名/分工；selector 失败还走 fail-open。
5. **handoff 不执行**：`handoffTask` 只写群转录 + 目标 inbox，不触发目标 Bot 回合。
6. **responder 可走 AgentLoop，但群编排仍是 Host 单轮扇出**：单 Bot 若 intent=Chat 会进内核 `AgentLoop::run`，但群回合没有共享任务板/团队预算/本轮实时跨成员观察（只有上一轮及更早的转录）；`approved:false` 也意味着群内 Shell 不能绕过审批。
7. **群 composer 绕过内核**：主路径是 `rooms.orchestrate`；内核 `Orchestrate` / `final_report` 没有做。文档自己已承认这是 Host 产品路径。

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
| 有限 MCP | `mcp_discover` / `mcp_call` + `host_h4_mcp_stdio.py` | 测试 server，不是通用 client |
| Subagent worker | `host_ffi.js runWorkerMoonTurn` | 一次性，prompt 截 800，不回注工具结果 |
| 桌面打包 | `scripts/pack-desktop.sh` / electron-builder | 内核未进 bundle，见发布项 |
| 模型工具调用 | `host_ffi.js` SSE/非 SSE 保留 `tool_calls`；A7/A8 23/0 | 仅 Read/Shell；通用工具目录未做 |
| observation 回注 | `runtime/agent_loop.mbt`：tool 结果 fence 后进下一次 `llm_chat` | 只在本回合内；不持久化 |
| 群 responder 的 AgentLoop | `runRoomResponderTurn → runner.runTurn` | intent=Chat 时可走内核 loop；最近转录已进 prompt；群预算/任务板仍不共享 |

### 2.2 已接线但未升裁 / 仍是壳的能力

| 能力 | 现状 | 缺什么 |
|---|---|---|
| `AgentLoop` | 产品默认 Chat 已走 `runtime/agent_loop.mbt`；Read/Shell、observation、64 步、取消、审批边界已通 | 无会话历史/压缩、无规划/反思、通用 ToolRegistry 弱 |
| `ToolRegistry` | `product_tool_registry` 注册 Read/Shell；boot registry 仍把 schema 写成 `{}` | 注册、发现、权限、通用 schema、执行接线 |
| `ToolCallTrace` | `runtime/transcript.mbt` 审计记录 | 持久化 `AgentStep` trace：model/tool/args/result/duration/error |
| `RoomOrchestrator` | Host `orchestrateRoom` 可扇出/聚合 | 无拆解/共享任务板/lead 综合（最近转录已接）；Kernel `Orchestrate` 未做 |
| `spawn_parallel_executors` | `agents/task/parallel_spawn.mbt` 内存 handle | 无真实调度/隔离 |
| Cloud lifecycle | `agents/cloud/lifecycle.mbt` fake bc | 无真实远端生命周期 |
| Teammates | `agents/teammates/create_agent.mbt` 内存 | 无真实 agent runtime |
| MCP | `tools/mcp_host_file.mbt` 自述 mock | 无通用 MCP client |

### 2.3 关键缺口（AR = Agent Runtime）

| ID | 缺口 | 当前状态 | 证据/口径 | 优先级 |
|---|---|---|---|---|
| AR-01 | 模型驱动 tool loop | **部分/门禁绿，未升裁** | `AgentLoop::run` 已跑 model→tool→observe→repeat；WP 49/0；PP live 未跑 | P1 |
| AR-02 | ToolSpec 弱，`tool_calls` 被忽略 | **部分** | `tool_calls` 流式/非流式都保留；Read/Shell 有 JSON schema；通用 ToolRegistry 仍弱 | P1 |
| AR-03 | 工具结果不回注 | **部分/已实现** | `agent_loop.mbt` 把结果 fence 后回注下一轮；不跨回合持久化 | P1 |
| AR-04 | 无会话历史/上下文预算 | **未做** | AgentLoop 只从当前 user 文本起步；无 transcript/压缩 | P1 |
| AR-05 | memory 不注入 provider prompt | **未做** | 记忆仍是 kernel seed，provider prompt 不可见 | P2 |
| AR-06 | 无规划/反思/任务分解 | **未做** | 只有 ReAct 式 think/call/observe，无 plan/todo/reflection | P2 |
| AR-07 | 群无共享上下文 | **部分/已接** | `buildRoomContext` 带最近 N 条转录；`prove_room_context` 15/0；同轮并行仍互不可见、无任务板 | P1 |
| AR-08 | 群路由语义不真实 | **已实现** | `@` 真定向、`@everyone` 全员、无 @ 逐 Bot YES/NO 真选择；全员弃权落 `skipped`；selector 失败 fail-open 并标 `fail_open`，UI 明示 | P1 |
| AR-09 | handoff 不执行 | **未做** | `handoffTask` 仍只写 transcript + inbox | P1 |
| AR-10 | 无 orchestrator/synthesis | **未做** | `final_report` 仍是 section 拼接 | P1 |
| AR-11 | 无共享工作区/task board | **未做** | 无团队任务板/产物状态 | P2 |
| AR-12 | 无团队预算/取消/loop guard | **部分** | 单 loop 有 64 步/取消；群有 6 人/timeout；无 token/成本预算 | P1 |
| AR-13 | 无真实 MCP client | **部分/未做** | 只有有限 stdio 测试 server | P2 |
| AR-14 | 无 trace/eval | **部分** | 有 QA gates/`BITBOT_LOOP` trace；无 agent eval suite | P2 |
| AR-15 | 安全 P0 | **部分/未关** | P0 入站/auth/sandbox/SK 绿；P0-3 仍 U；文档明确不关 AR-15 | **P0** |
| AR-16 | 打包/运维缺口 | **未做** | 内核未进 bundle；数据目录/签名未收口 | P3 |
| AR-17 | Kernel/Host 双路径漂移 | **部分** | Chat 已单一路径；群编排仍 Host 产品路径 | P1 |

## 3. 与主流对比

> 工程判断，不是厂商 benchmark；主流指 Claude Code / Codex / Cursor Agent / OpenHands 这类公开行为。

| 维度 | 主流 agent | BitBot 现在 | 差距 |
|---|---|---|---|
| 自主性 | 计划→执行→观察→继续 | 默认 Chat 已 think→call→observe→continue；非 Chat 仍单轮 | 无 plan/cross-turn 状态 |
| 工具选择 | 模型从 schema 选 | 模型从 Read/Shell schema 选 | 工具目录窄，通用 ToolRegistry 未做 |
| 观察回注 | 工具结果进入下一轮 | 结果 fence 后回注本回合下一轮 | 不持久化，不跨回合 |
| 上下文 | 会话历史 + 压缩 | 当前 user + persona + 最近群转录（仅群） | 无 DM 历史/压缩 |
| 记忆 | 自动检索/写入 | 显式短语 + 分槽 | 不自动、不注入 provider |
| 规划 | plan/reflection/todo | 无 | 复杂任务弱 |
| 多 Agent | 角色/委派/共享状态 | 并行 persona 应答；定向 @ 已真；最近转录已接 | 无拆解/共享任务板/综合 |
| 交接 | 目标 agent 真执行 | 写 inbox | 不执行 |
| 共享工作区 | 文件/任务板/产物 | 群 transcript/最近上下文有，工作区/任务板无 | 无团队状态 |
| 安全 | 认证/沙箱/审批 | P0 入站/auth/sandbox 已硬化；P0-3 U | AR-15 未关 |
| 可观测 | trace/eval/回放 | QA gates + `BITBOT_LOOP` trace | 无 agent eval suite |
| 扩展 | 通用 MCP/插件 | 有限 stdio MCP | 生态弱 |
| 发布 | 签名/自动更新 | 包内缺内核/硬编码路径 | 不可干净安装 |

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
| **P2** | 真实 MCP client + 工具权限 | **部分/未做**；当前是有限 stdio 测试 server | L | Tool contract |
| **P2** | Trace/Eval/回放 | **部分**：有 QA gates/loop trace，无 eval suite | M | Loop + 群编排 |
| **P2** | 规划/反思 | **未开始** | M | Loop + 上下文 |
| **P3** | 打包/签名/更新/数据目录 | **未开始**；内核未进 bundle | M | 安全/发布 |

## 5. 波次计划

> 状态总览（2026-10-25）

| Wave | 状态 | 证据/口径 |
|---|---|---|
| 0 安全止血 | **Host 面完成；AR-15 未关** | P0 8/0、host 11/0、SK 8/0；P0-3 仍 U |
| 1 群聊真实性 | **部分** | 定向 @ 已真；无 @ 逐 Bot YES/NO 真选择；最近 N 条转录已进 responder prompt；handoff 未做 |
| 2 Agent Loop MVP | **默认 Chat 已接；未升裁** | WP 49/0、EG 62/0、AU 69/0、A7/A8 23/0；PP `NEEDS_LIVE` |
| 3 上下文与记忆 | **未开始** | 无 transcript/token budget/memory 注入 |
| 4 真群编排 | **未开始** | 仍是 Host 并行扇出 + section 拼接 |
| 5 工具/MCP | **部分** | Read/Shell 已接；通用 MCP 未做 |
| 6 观测/评测 | **部分** | QA gates/loop trace；无 eval suite |
| 7 发布/运维 | **未开始** | 内核未进 bundle |

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

**目标**：干净机器能装、能升级、数据不丢。

**改动**
- 内核二进制/`cmd/` 进入 bundle；去掉 `resolveRepoRoot()` 硬编码。
- 数据目录移到 `app.getPath("userData")`；不写 app bundle。
- 单实例锁、CSP、日志轮转、崩溃恢复。
- 签名/公证/更新源；vault key 接 OS Keychain。
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

## 11. 证据索引

| 证据 | 证明 |
|---|---|
| `runtime/agent_loop.mbt` `AgentLoop::run` | 内核拥有 model→tool→observe→repeat；64 步、取消、未知工具/坏参数、审批 allow/deny/cancel、untrusted fence |
| `cmd/desktop_turn/agent_loop_product_native.mbt` | 默认 Desktop/cmd Chat：`open_turn` + `AgentLoop::run`；默认 Read/Shell registry；legacy `--legacy-chat-effect` 才退回旧路径 |
| `hosts/shared/agent_loop_product_wire.js` | Host 四操作映射；`llm_chat` / `exec_tool` / `request_approval` / `deliver`；Read/Shell 参数与审批动作规范化 |
| `hosts/shared/host_ffi.js` `agentLoopToolSchema` | provider 请求带 Read/Shell JSON schema；非空 schema 不是旧 `{}` |
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
| `hosts/shared/host_ffi.js` `runWorkerMoonTurn` | subagent worker 一次性，prompt 截 800，不回注工具结果 |
| `docs/qa/agent-loop-wp1-wp8-gates.md` | WP1–WP8：49/0；runtime 54/54；parser 3/3 |
| `docs/qa/electron-chat-agent-loop-gates.md` | EG1–EG6：62/0；Electron mid-run/取消 |
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
