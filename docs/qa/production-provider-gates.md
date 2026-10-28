# Production provider gates PP1–PP7

> 边界：`docs/agent-core/01-agent-loop-production-provider.md`。  
> **不是** H4 升 I。**不关** AR-01/02/03/15。**不改** capability matrix。  
> **不倒裁** A/WP/EG/P0/AU/SK。**不宣称** Agent Loop MVP 或 Desktop Agent Loop MVP。  
> `BITBOT_LEGACY_CHAT_EFFECT=1` 不是本页证据。WP/EG loopback 不是 PP1–PP4。

| ID | 本工作区 | 期望 |
|---|---|---|
| PP1 | live PASS 2026-10-28 | `AgentLoop::run` 的 `llm_chat` 打到外部 `base_url` |
| PP2 | live PASS 2026-10-28 | 第一次请求 `tools` 非空 |
| PP3 | live PASS 2026-10-28 | `tool_calls` 进内核 `exec_tool`，Host 不自转 |
| PP4 | live PASS 2026-10-28 | Observe 之后的请求带 fence / untrusted，Finish 也不丢观察 |
| PP5 | 接线已查 | tee / artifact / printenv 子进程无密钥明文；Authorization 为 `Bearer [redacted]` |
| PP6 | NEEDS_LIVE | 无密钥退出码 2；强制离线子进程 `BLOCKED` 退出码 3 |
| PP7 | 声明仍在 | A/WP/EG/P0/AU/SK 未改判；P0-3 仍是 U only；无 MVP 声明 |

无生产密钥时 PP1–PP4 保持「未跑 live」。不得把 NEEDS_LIVE 抄成 PASS。

## evidence_cmd

```bash
bash scripts/prove_production_provider.sh
```

## 实测

2026-10-24，本工作区无 `BITBOT_LLM_API_KEY` / catalog `env_key`：

```bash
bash scripts/prove_production_provider.sh
```

退出码 2。`prove_production_provider NEEDS_LIVE`。PP6 子进程：无密钥退出码 2，强制离线退出码 3。没有 `ok PP1` … `ok PP7`。

同一环境下，`BITBOT_LLM_BASE_URL=http://127.0.0.1:9/v1` 且带占位密钥时退出码 3，`prove_production_provider BLOCKED`。`BITBOT_LEGACY_CHAT_EFFECT=1` 退出码 1。两条都不是 PASS。

操作员实跑 PP1–PP4 的步骤写在 SoT「操作员实跑 PP1–PP4」。有密钥且模型发出 Read `tool_calls` 时，成功摘要才是 `prove_production_provider pass=7 fail=0`。

AR-01/02/03/15 状态列不关。P0-3 仍是 U。capability matrix 未改。不宣称 Desktop Agent Loop MVP。

## 实测 2026-10-28（live）

本工作区已配置生产密钥（`hosts/desktop/.env.local` 指向外部 `https://api.deepseek.com/v1`，非 loopback）：

```bash
set -a && source hosts/desktop/.env.local && set +a
node scripts/prove_production_provider.js
```

退出码 0。`prove_production_provider pass=7 fail=0`。PP1–PP7 全部 ok：
- PP1 `AgentLoop::run` 的 `llm_chat` 打到外部 `base_url`；
- PP2 第一次请求 `tools` 非空；
- PP3 `tool_calls` 进内核 `exec_tool`，Host 不自转；
- PP4 Observe 之后的请求带 fence / untrusted，Finish 也不丢观察；
- PP5 子进程无密钥明文，Authorization 为 `Bearer [redacted]`；
- PP6 无密钥退出码 2、强制离线退出码 3（负向子进程仍按预期 fail-closed）；
- PP7 A/WP/EG/P0/AU/SK 未改判，P0-3 仍是 U only，无 MVP 声明。

三次连跑，都是 `pass=7 fail=0`：干净会话槽首跑、在上一轮写下的会话槽上交叉重放、以及把一份**畸形历史**（14 条，assistant 纯文本 + 无 `tool_call_id` 的 `tool` 条目）塞回槽位后再跑。

## 事故与根因（2026-10-28，同日先失败后修复）

**先说结论**：同一天首跑 `pass=7 fail=0` 之后立刻变成 `pass=4 fail=3`（PP1/PP3/PP4 红）。这不是环境抖动，也不是此前怀疑的「工具 schema 空对象」，而是**跨回合重放了一段 provider 不接受的 tool 历史**：

1. 内核 `LoopMessage` 只有 `{role, content}`；`AgentLoop::run` 把模型发出的工具调用压成一行纯文本（`Read {"path": …}`）写进 assistant 历史，`append_tool` 又保留 `role:"tool"`。
2. `AgentContext::wire_messages` 原样把这两条发出去 —— assistant 没有 `tool_calls`，tool 没有 `tool_call_id`。
3. Host 侧 `executeLlmChat` 的 `overrideMessages` 重建又把消息拍成 `{role, content}`，即使内核带上了字段也会被抹掉。
4. 于是第二轮起 provider 返回 **HTTP 422**：`missing field tool_call_id at messages[2]`。失败的回合被写回会话槽，形成「上下文自中毒」——之后每一轮都 422。群侧此前那条 422 的红，真根因就是这个。

**修法（协议层正规修，不是止血）**：

| 层 | 改动 |
|---|---|
| `runtime/agent_loop.mbt` | `LoopMessage` 增 `tool_calls` / `tool_call_id`；新增 `append_tool_call` |
| `runtime/agent_context.mbt` | 历史条目记 `call_id` / `call_args`；`wire_messages` 按 call id 配对，并自愈两种非法形态（悬空调用降级为纯文本、旧会话里无 id 的 tool 条目降级为用户侧备注）；`encode`/`decode` 兼容旧的 6 字段记录 |
| `cmd/desktop_turn/agent_loop_product_parse.mbt` | `encode_product_messages` 输出 `tool_calls` / `tool_call_id` |
| `hosts/shared/host_ffi.js` | 重建 provider payload 时透传这两个字段；无 id 的 `tool` 条目降级为 user，绝不发出 |

**回归守卫**：`scripts/prove_agent_loop_product_wire.js` 新增 WP2b —— 第二次 provider 请求必须同时带「有 id 的 assistant `tool_calls`」和「回应该 id 的 `role:"tool"`」。这条不需要密钥、不需要外网，是上面那次 live 422 的离线镜像。负向对照已验证：把 Host 透传关掉，WP2b 立刻变红（WP 从 52/0 掉到 44/8）。

**纪律不变**：PP live PASS 只把「未跑 live」变 PASS。**不关** AR-01/02/03/15 状态列；**不改** capability matrix（仍 234/234，I-GAP 0）；**不升** I；**不宣称** Agent Loop MVP 或 Desktop Agent Loop MVP。

