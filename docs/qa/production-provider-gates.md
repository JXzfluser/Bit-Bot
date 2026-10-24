# Production provider gates PP1–PP7

> 边界：`docs/agent-core/01-agent-loop-production-provider.md`。  
> **不是** H4 升 I。**不关** AR-01/02/03/15。**不改** capability matrix。  
> **不倒裁** A/WP/EG/P0/AU/SK。**不宣称** Agent Loop MVP 或 Desktop Agent Loop MVP。  
> `BITBOT_LEGACY_CHAT_EFFECT=1` 不是本页证据。WP/EG loopback 不是 PP1–PP4。

| ID | 本工作区 | 期望 |
|---|---|---|
| PP1 | 未跑 live | `AgentLoop::run` 的 `llm_chat` 打到外部 `base_url` |
| PP2 | 未跑 live | 第一次请求 `tools` 非空 |
| PP3 | 未跑 live | `tool_calls` 进内核 `exec_tool`，Host 不自转 |
| PP4 | 未跑 live | Observe 之后的请求带 fence / untrusted，Finish 也不丢观察 |
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
