# Agent Core & 多智能体路线图

> 状态：draft · 2026-10-24  
> 范围：Kernel agent runtime + Host 群 Bot 多智能体；不含 UI 像素对齐、垂直 skills、商店上架。  
> 证据口径：以当前工作树代码为准；`file:line` 会漂移，引用时以函数名/文件为主。  
> 一句话：`CM-*` 234/234 与 385 tests 证明“能力合同/产品面”很完整，但不能证明“模型驱动的 agent runtime”或“协作多智能体”。

## 0. TL;DR

- **已经有的**：Turn 生命周期、Host FFI、审批门、per-bot persona/session、群 Bot 并行扇出、部分聚合、会话隔离、记忆分槽、Routines、Skills、有限 stdio MCP、桌面打包。
- **真正缺的**：模型工具循环、tool schema/`tool_calls`、观察回注、会话上下文、规划/反思、群共享上下文、委派/handoff 执行、orchestrator/汇总、团队预算、真实 MCP client、评测。
- **当前定位**：Agent core ≈ **L1**（预定义单步工具）；Group bot ≈ **并行多 Bot 应答**，不是协作多智能体；主流 agent ≈ **L3–L4**（多步工具/规划/长任务）。
- **优先级**：`P0 安全` → `P1 群聊真实性 + Agent Loop MVP` → `P1 上下文/记忆` → `P1 群编排` → `P2 工具/MCP/评测` → `P3 发布/运维`。
- **两条主线并行**：Kernel 负责 loop/tool/context；Host 负责 group/orchestrator/security。不要合成一个巨型 PR。

## 1. 口径先钉住

### 1.1 “多 Agent”至少有三层

| 层级 | 定义 | 当前 BitBot |
|---|---|---|
| 并行多 Bot | 同一个任务广播给多个独立 Bot，各自回答，最后聚合 | **已实现**，真实并行、真隔离、真部分失败 |
| 协作多 Agent | 有分工、共享上下文、互相消息、handoff、汇总/复核 | **只有壳**：handoff 写 inbox，不执行；无共享上下文；无汇总者 |
| 多 Agent Runtime | 调度、隔离、预算、取消、工具循环、追踪、评测 | **未实现**：内核无 `Orchestrate`，Host 是产品层编排 |

### 1.2 Agent 自主性分级

| 级别 | 能力 | 当前 |
|---|---|---|
| L0 | 单轮聊天，模型只回文本 | 已超过 |
| L1 | 预定义单步工具/效果，模型不选工具 | **当前 agent core** |
| L2 | 模型选工具，工具结果回注，可多步 | 目标 MVP |
| L3 | 多步循环 + 规划 + 失败恢复 | 目标 V1 |
| L4 | 长任务 + 记忆 + 多 Agent + 评测 | 目标 V2 |

> 结论：BitBot 的产品面/合同面接近“全量”，agent runtime 核心仍在 L1。`CM-*` PASS 不能当作 agent 能力评测。

### 1.3 为什么群 Bot 现在还不算“协作多智能体”

1. **同一任务广播**：`orchestrateRoom` 给每个 responder 的 `task` 是同一个，没有拆解/分工。
2. **互相看不见**：`buildRoomContext` 只带群名、成员、被 @ 的人、自己；没有最近转录，也没有其他 Bot 的回复。
3. **没有汇总者**：`final_report` 是把每个 section 拼起来，不是 lead agent 综合判断后的答案。
4. **无 @ 实际全员**：`roomTurn` 设 `responder_policy="bot_discretion"`，但 `orchestrateRoom` 仍对全部 responders 扇出；`mentioned_names` 也等于全部 responders。
5. **handoff 不执行**：`handoffTask` 只写群转录 + 目标 inbox，不触发目标 Bot 回合。
6. **每个 responder 仍是单轮聊天**：`runRoomResponderTurn` 最终是一次 `llm_chat`，没有工具循环。
7. **群 composer 绕过内核**：主路径是 `rooms.orchestrate`；内核 `Orchestrate` / `final_report` 没有做。文档自己已承认这是 Host 产品路径。

## 2. 现有能力清单

### 2.1 真实现的能力

| 能力 | 证据 | 边界 |
|---|---|---|
| Turn 生命周期 | `runtime/turn.mbt`；`cmd/desktop_turn/turn_json.mbt` | 单轮回注，不是 loop |
| Host effect 执行 | `hosts/shared/host_ffi.js`；`hosts/shared/run_moon_turn.js` | 每轮 spawn 一次 `moon` |
| 审批门 | `runtime` ApprovalGate；Desktop Approval UI | 存在 fixed `approved:true` 绕过，见 P0 |
| per-bot persona | `host_ffi.js llmSystemPrompt(botId)` | 只注入名字/职责/简介 |
| per-bot session | `room-<roomId>-<botId>` | 群回合不写 DM |
| 群 Bot 并行 | `product_surface.js orchestrateRoom` + `Promise.allSettled` | 最多 6，per-responder timeout |
| 部分失败聚合 | `final_report.partial` / `returned/total` | 诚实，但不综合 |
| 群转录隔离/脱敏 | `product_surface.js` room transcript | 有长度/字符清洗 |
| 记忆分槽 | `host_ffi.js memorySeedArgs(botId)` | kernel seed；provider prompt 不带 memory |
| Routines | `agents/routines` + Host durable store | 非长驻 daemon |
| Skills | `skills/` catalog + load | 模型不能自主选 |
| 有限 MCP | `mcp_discover` / `mcp_call` + `host_h4_mcp_stdio.py` | 测试 server，不是通用 client |
| Subagent worker | `host_ffi.js runWorkerMoonTurn` | 一次性，prompt 截 800，不回注工具结果 |
| 桌面打包 | `scripts/pack-desktop.sh` / electron-builder | 内核未进 bundle，见发布项 |

### 2.2 只有合同/内存态的能力

| 能力 | 现状 | 缺什么 |
|---|---|---|
| `AgentLoop` | `runtime/types.mbt` 注释即 “Skeleton”；`boot` 只拼字符串；`max_steps=64` 未用 | 真正的 model→tool→observe→repeat |
| `ToolRegistry` | 仅 `bitbot.mbt:21` 和测试引用 | 注册、发现、权限、执行接线 |
| `ToolCallTrace` | `runtime/transcript.mbt` 审计记录 | 不是模型 tool call |
| `spawn_parallel_executors` | `agents/task/parallel_spawn.mbt` 内存 handle | 无真实调度/隔离 |
| Cloud lifecycle | `agents/cloud/lifecycle.mbt` fake bc | 无真实远端生命周期 |
| Teammates | `agents/teammates/create_agent.mbt` 内存 | 无真实 agent runtime |
| MCP | `tools/mcp_host_file.mbt` 自述 mock | 无通用 MCP client |

### 2.3 关键缺口（AR = Agent Runtime）

| ID | 缺口 | 影响 | 优先级 |
|---|---|---|---|
| AR-01 | 无模型驱动 tool loop | 不能多步完成任务，只能单轮回答/单次效果 | P1 |
| AR-02 | ToolSpec 弱，`tool_calls` 被忽略 | 模型无法选工具；schema 恒 `{}` | P1 |
| AR-03 | 工具结果不回注 | 模型看不到执行结果，无法纠错/继续 | P1 |
| AR-04 | 无会话历史/上下文预算 | 多轮失忆；长 prompt 靠 argv 硬塞 | P1 |
| AR-05 | memory 不注入 provider prompt | 记忆槽存在但模型用不上 | P2 |
| AR-06 | 无规划/反思/任务分解 | 复杂任务无计划，失败不恢复 | P2 |
| AR-07 | 群无共享上下文 | Bot 看不到彼此/历史，无法接话 | P1 |
| AR-08 | 群路由语义不真实 | 无 @ 全员；`mentioned_names` 全量 | P1 |
| AR-09 | handoff 不执行 | 交接单可见，目标 Bot 不行动 | P1 |
| AR-10 | 无 orchestrator/synthesis | `final_report` 是拼接，不是团队答案 | P1 |
| AR-11 | 无共享工作区/task board | 多 Agent 无法围绕同一组文件/任务协作 | P2 |
| AR-12 | 无团队预算/取消/loop guard | 成本、死循环、超时不可控 | P1 |
| AR-13 | 无真实 MCP client | 工具生态不可扩展 | P2 |
| AR-14 | 无 trace/eval | 无法证明 agent 变好/没退化 | P2 |
| AR-15 | 安全 P0 | 远程 RCE/审批绕过/密钥泄漏 | **P0** |
| AR-16 | 打包/运维缺口 | 干净机器装不上/数据写 bundle | P3 |
| AR-17 | Kernel/Host 双路径漂移 | 两套群逻辑，合同与产品不一致 | P1 |

## 3. 与主流对比

> 工程判断，不是厂商 benchmark；主流指 Claude Code / Codex / Cursor Agent / OpenHands 这类公开行为。

| 维度 | 主流 agent | BitBot 现在 | 差距 |
|---|---|---|---|
| 自主性 | 计划→执行→观察→继续 | 单轮回答/单次效果 | 无 loop |
| 工具选择 | 模型从 schema 选 | 预定义 intent/effect | 无 `tool_calls` |
| 观察回注 | 工具结果进入下一轮 | 结果只给用户/审计 | 模型看不到 |
| 上下文 | 会话历史 + 压缩 | 当前 user + 少量系统信息 | 无历史/压缩 |
| 记忆 | 自动检索/写入 | 显式短语 + 分槽 | 不自动、不注入 |
| 规划 | plan/reflection/todo | 无 | 复杂任务弱 |
| 多 Agent | 角色/委派/共享状态 | 并行 persona 应答 | 无协作 |
| 交接 | 目标 agent 真执行 | 写 inbox | 不执行 |
| 共享工作区 | 文件/任务板/产物 | 群 transcript 有，工作区无 | 无团队状态 |
| 安全 | 认证/沙箱/审批 | 有审批但可绕过；LAN 暴露 | P0 |
| 可观测 | trace/eval/回放 | 日志/验收脚本 | 无 agent eval |
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

| 优先级 | 事项 | 为什么现在 | 规模 | 依赖 |
|---|---|---|---|---|
| **P0** | 远程 turn 认证、默认 loopback、去掉 fixed `approved:true`、shell 沙箱、webhook 签名、body limit、env 清洗 | 未认证 `/v1/turn` + `*:18765` + `/bin/bash -lc` = 远程 RCE | S | 无 |
| **P1** | 群聊真实性：无 @ 语义、mention 名单、最近转录、handoff 真执行 | 当前产品文案与行为不一致；群聊“看起来像团队”但实际不是 | M | 无 |
| **P1** | Agent Loop MVP：ToolSpec、`tool_calls`、host 执行、observation 回注、max steps、approval、trace | 没有它，所有 agent 能力都是单轮壳 | L | 安全 P0 建议先合 |
| **P1** | 上下文与记忆：transcript、token budget、压缩、memory 注入、resume | 多轮/长任务的基础 | L | Agent Loop |
| **P1** | 群编排：orchestrator、任务分解、分工、共享 room state、synthesis、预算/取消 | 从“并行多 Bot”变成“协作多 Agent” | L | Agent Loop + 上下文 |
| **P2** | 共享工作区/task board | 团队围绕同一组产物协作 | M | 群编排 |
| **P2** | 真实 MCP client + 工具权限 | 扩展生态；当前只是测试 server | L | Tool contract |
| **P2** | Trace/Eval/回放 | 证明变好、防回归 | M | Loop + 群编排 |
| **P2** | 规划/反思 | 复杂任务质量 | M | Loop + 上下文 |
| **P3** | 打包/签名/更新/数据目录 | 干净机器可安装 | M | 安全/发布 |

## 5. 波次计划

### Wave 0 — 止血（P0）

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
- 无 @ 的策略二选一：明确“全员响应”或实现真正的 `bot_discretion`；不要标签一套、行为一套。
- `mentioned_names` 只传真正被 @ 的人；`unknown_mentions` 保持可见。
- `buildRoomContext` 增加最近 N 条转录摘要（有预算、脱敏、无密钥）。
- `handoffTask` 触发目标 Bot 一轮；失败要可见，不能只写 inbox。
- 群 transcript 记录 handoff 请求 + 目标回复；部分失败继续诚实。
- 清理旧 `gp-room-send` 与主 composer 的双路径，或明确 legacy 标记。

**验收**
- `@A` 只跑 A；`@everyone` 跑全员；无 @ 行为与 UI 文案一致。
- Bot 能引用上一条群消息；handoff 后目标 Bot 真的产出。
- 群内不出现“已交接但没人执行”。

**非目标**：不在这一波做 lead agent / 任务分解。

### Wave 2 — Agent Loop MVP（P1）

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

> 这是“文档清单 + 优先级”，不是要求一次写完全部。P0/P1 文档先落，P2/P3 随实现补。  
> 新建文档先用 backtick 标记，避免未创建文件的死链。

| ID | 文档 | 类型 | 现状 | 优先级 | 动作 | 必须回答 |
|---|---|---|---|---|---|---|
| D01 | `docs/agent-core/README.md` | explanation | 本文 | P0 | 已建 | 现状/缺口/优先级/波次/文档索引 |
| D02 | `docs/agent-core/01-agent-loop.md` | reference | 未建 | P1 | 新建 | 状态机、tool loop、max steps、取消、错误、审批、trace |
| D03 | `docs/agent-core/02-tool-calling.md` | reference | 未建 | P1 | 新建 | ToolSpec schema、`tool_calls`、observation、untrusted、错误模型 |
| D04 | `docs/agent-core/03-context-and-memory.md` | reference | 未建 | P1 | 新建 | transcript、token budget、压缩、memory 注入、隐私、resume |
| D05 | `docs/agent-core/04-multi-agent.md` | reference | 未建 | P1 | 新建 | 角色、路由、共享上下文、handoff、orchestrator、synthesis、预算 |
| D06 | `docs/agent-core/05-security.md` | reference | 已建 | **P0** | 已建 | 威胁模型、认证、bind、沙箱、审批、secret、webhook、CSRF |
| D07 | `docs/agent-core/06-observability-eval.md` | reference | 未建 | P2 | 新建 | trace、metrics、eval 场景、CI 门槛、回放 |
| D08 | `docs/agent-core/07-release-ops.md` | reference | 未建 | P3 | 新建 | bundle、data dir、签名、更新、单实例、CSP、回滚 |
| D09 | `docs/agent-core/08-acceptance.md` | reference | 未建 | P1 | 新建 | 每个 AR 的验收用例/命令/期望 |
| D10 | `docs/04-interface-contracts.md` | reference | 已有 | P1 | 更新 | `ToolSpec`/`ToolCall`/`ToolResult`/`AgentStep`/`RoomPlan` |
| D11 | `docs/05-runtime-turn-lifecycle.md` | explanation | 已有 | P1 | 更新 | 单轮 → loop；observation 回注；取消/审批边界 |
| D12 | `docs/02-module-map.md` | reference | 已有 | P2 | 更新 | 新模块（agent loop/context/multiagent）边界 |
| D13 | `docs/ROADMAP.md` | explanation | 已有 | P1 | 已更新 | 增加 M8 Agent Core / M9 Multi-Agent |
| D14 | `docs/capability-matrix.md` | reference | 已有 | P1 | 更新 | 注明 `CM-* PASS ≠ AR-*`；不要混用口径 |
| D15 | `docs/qa/acceptance-plan.md` | reference | 已有 | P1 | 更新 | agent-core 验收计划 |
| D16 | `docs/qa/gaps.md` | reference | 已有 | P1 | 实现后更新 | AR residual / 证据 / 升裁 |
| D17 | `docs/design/desktop-target/report.md` | explanation | 已有 | P1 | 更新 | §8 加本路线图链接；保持 Host 路径口径 |
| D18 | `docs/host-integration-interface-gaps.md` | reference | 已有 | P2 | 更新 | 真实 MCP/FFI 的剩余缺口 |
| D19 | `docs/grok-desktop-parity/gaps.md` | reference | 已有 | P2 | 更新 | 记忆自动抽取/上下文残留 |
| D20 | `docs/adr/0006-agent-loop-and-tool-calling.md` | ADR | 未建 | P1 | 新建 | 为什么 loop 在 Kernel、执行在 Host |
| D21 | `docs/adr/0007-group-orchestrator-and-handoff.md` | ADR | 未建 | P1 | 新建 | orchestrator 归属、handoff 执行语义、预算 |
| D22 | `docs/adr/0008-remote-turn-auth-and-sandbox.md` | ADR | 已建 | **P0** | 已建 | `/v1/turn` 认证、bind、shell 沙箱、审批不可伪造 |
| D23 | `docs/adr/0009-kernel-host-single-path.md` | ADR | 未建 | P1 | 新建 | 群 composer 单一路径；Kernel 合同 vs Host 产品路径 |

### 6.1 文档写作顺序

1. **D06 + D22（P0 安全）**：先写威胁模型和不可伪造审批，再动代码。
2. **D02 + D03 + D10 + D11（P1 Agent Loop）**：契约先定，再实现。
3. **D05 + D21 + D09（P1 群编排）**：orchestrator/handoff 语义先定。
4. **D04（P1 上下文）**、**D15/D16（验收）** 随实现补齐。
5. **D07/D08（P2/P3）** 在对应波次前写，不提前写空文档。

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
| 远程 RCE | `/v1/turn` 无认证 + LAN + shell | P0 认证/loopback/沙箱/审批 |
| Host/Kernel 漂移 | 群 composer 走 Host，内核另有 `RoomTurn` | ADR 0009；一条路径；合同测试 |
| 成本爆炸 | 群全员 + 多步 loop + 无预算 | max agents/rounds/tokens/time；取消传播 |
| 上下文泄漏 | 群共享 transcript / memory 注入 | 脱敏、作用域、来源标注、最小注入 |
| 评测盲区 | 只有 smoke，没有 agent eval | 20 场景 + CI 门槛 |
| 装不上 | bundle 缺内核/硬编码路径 | Wave 7；干净机器 smoke |

## 9. 非目标

- 不在本路线图做 UI 像素对齐/主题细节。
- 不在没有 Agent Loop 前继续加更多群 Bot。
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
| `runtime/types.mbt:41-59` | `AgentLoop` 是 skeleton，`max_steps` 未用 |
| `bitbot.mbt:21` | `ToolRegistry` 仅在 boot 构造，未接线 |
| `runtime/transcript.mbt` | `ToolCallTrace` 是审计，不是模型 tool call |
| `hosts/shared/host_ffi.js:5286-5297` | 流式只读 `delta.content`，忽略 `tool_calls` |
| `hosts/shared/host_ffi.js:5578-5610` | payload 只有 system + 可选引用/搜索 + user |
| `hosts/shared/host_ffi.js:5630` | 固定 `temperature:0.3` |
| `hosts/shared/run_moon_turn.js:121-140` | 每轮 spawn；`memorySeedArgs(botId)` |
| `hosts/shared/run_moon_turn.js:363` | one guarded re-run, no loops |
| `hosts/desktop/product_surface.js:1544-1614` | `roomTurn` 无 @ → members + `bot_discretion` |
| `hosts/desktop/product_surface.js:1657-1794` | `orchestrateRoom` 并行扇出 + `final_report` 聚合 |
| `hosts/desktop/product_surface.js:1745` | `mentioned_names = responders` |
| `hosts/desktop/product_surface.js:1804` | `handoffTask` 只写转录/inbox |
| `hosts/desktop/main.js:1340-1460` | `buildRoomContext` 无 transcript；`approved:false` |
| `hosts/desktop/main.js:1501-1523` | `bitbot:rooms:orchestrate` 主路径 |
| `hosts/desktop/index.html:6240-6247` | 群 composer 调 `rooms.orchestrate` |
| `hosts/desktop/index.html:14589` | “kernel phrase is NOT sent here” |
| `hosts/shared/host_ffi.js:19787-19810` | `executeMultiAgentEffect` fallback 写 inbox |
| `hosts/shared/host_ffi.js:24260-24300` | `handoff_task` 写 inbox，不执行目标 |
| `hosts/shared/host_ffi.js:18336` | `runWorkerMoonTurn` 一次性 worker |
| `docs/design/desktop-target/report.md` §8 | 自认 Host 产品路径；内核 `Orchestrate`/`final_report` 未做 |
| `docs/grok-desktop-parity/gaps.md:431` | 记忆自动抽取未做 |
| `hosts/shared/cn_inbound_server.js` + `hosts/shared/p0_security.js` | ADR 0008：默认 `127.0.0.1`，无 Bearer 401，坏签名 401，body 413。不是 I，不关 AR-15 |
| `hosts/shared/host_ffi.js` shell | 无审批不执行；cwd 允许列表；子进程最小 env。P0-3 仍是 U |
| `docs/agent-core/05-security-sandbox-secrets.md` | SK1–SK8。不是 P0，不是 AU，不关 AR-15，不升 I |
| `docs/capability-matrix.md` | 234 CM / I-PASS；合同面 |
| `docs/qa/gaps.md` | 验收与 residual 口径 |

## 12. 变更记录

- 2026-10-24：初版。基于 agent core 审计、群 Bot 路径追踪、P0 安全审计、打包/数据审计整理。
- 2026-10-24：入站重新接上 `p0_security`（Bearer 401、坏签名 401、body 413、默认 loopback、入站不固定 `approved:true`、shell 最小 env）。P0-3 维持内核 U，不升 I。AR-15 不关。不宣称 MVP。
- 2026-10-24：SK1–SK8 沙箱与密钥立证（allowlist env、审批不放开密钥、cwd、超时/缓冲、scrub、手机不持模型密钥）。不是 P0，不是 AU。P0 host-checks 不算本 residual 已关。不关 AR-15，不升 I，不宣称 MVP。
