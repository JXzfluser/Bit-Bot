# Electron Chat Agent Loop gates EG1–EG6

> 边界：`docs/agent-core/01-agent-loop-electron-midrun.md`（Accepted）。  
> **不是** H4 升 I。**不关** AR 状态列。**不改** capability matrix。**不碰** AR-15。  
> **不倒裁** WP1–WP8。**不宣称** Agent Loop MVP 或 Desktop Agent Loop MVP。  
> EG1–EG3 是 Electron/Chat GUI residual 的最低证据条。

| ID | 最低条 | 期望 | 证据 |
|---|---|---|---|
| EG1 | 是 | live Electron composer mid-run 已见 `AgentLoop::run` / `open_turn`，最终句尚未上屏 | `bash scripts/prove_agent_loop_electron_midrun.sh` |
| EG2 | 是 | 同一窗口已有 `llm_chat` + `exec_tool`，provider 第一次请求带 tools | 同上 |
| EG3 | 是 | 飞行中点 GUI 取消 → Host 取消信号 → 内核 `Cancelled`；之后无新的 `llm_chat` / `exec_tool`。ops 对齐不叫 EG3 | 同上 |
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

`prove_agent_loop_electron_midrun pass=61 fail=0`。

EG3 是另一次飞行中的回合：`#turn-cancel` 可见，且当时已有 `llm_chat` 与 `exec_tool`。点该按钮后 turn JSON 为 `agent_stop=Cancelled`。取消之后 `llm_chat` 次数、`exec_tool` 次数和 provider 请求数都没有增加，也没有 `deliver`。`kernel_ops` 与 `node_ops` 对齐仍有检查，但不编号为 EG3。

EG6 含 `prove_agent_loop_product_wire pass=49 fail=0`，以及 moon test `failed: 0`。`moon test -p runtime` 为 54/54（含取消回复不再执行下一步工具）。WP PASS 不是 EG1–EG5。

AR 状态列不关。H4 不升 I。capability matrix 未改。AR-15 未改。WP1–WP8 裁决未改。不宣称 Agent Loop MVP，也不宣称 Desktop Agent Loop MVP。
