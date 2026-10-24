# Electron Chat Agent Loop gates EG1–EG6

> 边界：`docs/agent-core/01-agent-loop-electron-midrun.md`（Accepted）。  
> **不是** H4 升 I。**不关** AR 状态列。**不改** capability matrix。**不碰** AR-15。  
> **不倒裁** WP1–WP8。**不宣称** Agent Loop MVP 或 Desktop Agent Loop MVP。  
> EG1–EG3 是 Electron/Chat GUI residual 的最低证据条。

| ID | 最低条 | 期望 | 证据 |
|---|---|---|---|
| EG1 | 是 | live Electron composer mid-run 已见 `AgentLoop::run` / `open_turn`，最终句尚未上屏 | `bash scripts/prove_agent_loop_electron_midrun.sh` |
| EG2 | 是 | 同一窗口已有 `llm_chat` + `exec_tool`，provider 第一次请求带 tools | 同上 |
| EG3 | 是 | `kernel_ops` = `node_ops`，provider 次数 = 内核 `llm_chat` 次数，Host/renderer 无 `while+llm_chat` | 同上 |
| EG4 | 否 | UI 只投影 AgentStep；mid-run 无 `deliver`；不为 GUI 另开内核状态机 | 同上 |
| EG5 | 否 | 第二次请求含 fence 与 `see b.txt`，最终可见文本 `saw file` | 同上 |
| EG6 | 否 | Read 路径不靠 `approved: true` 放行；不改审批 UI / matrix / H4；WP SoT `prove_agent_loop_product_wire.sh` 仍 fail=0 | 同上 |

## evidence_cmd

```bash
bash scripts/prove_agent_loop_electron_midrun.sh
```

## 实测

2026-10-24，本工作区：

```bash
bash scripts/prove_agent_loop_electron_midrun.sh
```

`prove_agent_loop_electron_midrun pass=55 fail=0`。

其中 EG6 含 `prove_agent_loop_product_wire pass=49 fail=0`，以及 `moon test -p runtime` 与 `cmd/desktop_turn/agent_loop_product_wbtest.mbt` 的 `failed: 0`。WP PASS 不是 EG1–EG5。

飞行窗口里（第二次 provider 响应被按住、`#log` 还没有 `saw file`、`#send` 仍禁用）已经看到：trace `agent_entry=open_turn`，DOM `[data-agent-step]` 有 entry / `llm_chat` / `exec_tool`，还没有 `deliver`；provider 已有 2 次请求，第一次带 `Read` tool，第二次 body 含 `<cursor_untrusted_data` 与 `see b.txt`。松开之后 DOM 与 turn JSON 的助手文本是 `saw file`，`kernel_ops` 与 `node_ops` 一致。Host/GUI 无 `while+llm_chat`。内核 `runtime/` 与 `cmd/` 无改动。

飞行窗口里（第二次 provider 响应被按住、`#log` 还没有 `saw file`、`#send` 仍禁用）已经看到：trace `agent_entry=open_turn`，DOM `[data-agent-step]` 有 entry / `llm_chat` / `exec_tool`，还没有 `deliver`；provider 已有 2 次请求，第一次带 `Read` tool，第二次 body 含 `<cursor_untrusted_data` 与 `see b.txt`。松开之后 DOM 与 turn JSON 的助手文本是 `saw file`，`kernel_ops` 与 `node_ops` 一致。

EG1–EG3 的 live Electron 证据已过。AR 状态列不关。H4 不升 I。capability matrix 未改。AR-15 未改。WP1–WP8 裁决未改。不宣称 Agent Loop MVP，也不宣称 Desktop Agent Loop MVP。
