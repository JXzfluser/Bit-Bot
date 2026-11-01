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

2026-10-24，本工作区：`bash scripts/prove_agent_loop_electron_midrun.sh` → `prove_agent_loop_electron_midrun pass=62 fail=0`。当时记为「本地证据，不是 Bit 复跑结论」，EG1–EG3 暂不写已关。

## 实测 2026-10-28（Bit 复跑，live）

2026-10-28 在本机（Bit 开发机，macOS + 原生显示，Electron 二进制齐备）实跑：

```bash
bash scripts/prove_agent_loop_electron_midrun.sh
```

`prove_agent_loop_electron_midrun pass=62 fail=0`。**这是 Bit 复跑结论**，EG1–EG3（连同 EG4–EG6）全部 live PASS，Electron/Chat GUI residual 收口：

- EG1 live Electron composer mid-run 已见 `AgentLoop::run` / `open_turn`，最终句尚未上屏即被采样；
- EG2 同一窗口已有 `llm_chat` + `exec_tool`，provider 第一次请求带 `Read` tool；
- EG3 飞行中点 GUI「取消」→ Host 取消信号 → 内核 `agent_stop=Cancelled`；之后无新的 `llm_chat` / `exec_tool` / provider 请求，也无 `deliver`；
- EG4 UI 只投影 AgentStep，mid-run 无 `deliver`；
- EG5 第二次请求含 fence 与 `see b.txt`，最终可见文本 `saw file`；
- EG6 Read 路径不靠 `approved:true` 放行，`prove_agent_loop_product_wire pass=49 fail=0`、`moon test failed: 0`。

本次复跑前，gate 脚本 `scripts/prove_agent_loop_electron_midrun.mjs` 暴露两处脆点并已修：
1. 「`AgentLoop::run` 是唯一 model loop」检查把正则钉死在旧字面量（`while steps < AGENT_LOOP_MAX_STEPS` / `host.llm_chat(messages)`）；内核经 L3→L6 重构后改用 `effective_max_steps()` 与 `host.llm_chat(agent_ctx.wire_messages())`。已改为跟意图断言（函数身份 + `while … steps < max_steps` + `host.llm_chat(`），全仓唯一 `host.llm_chat(` 调用仍在 `AgentLoop::run` 内。
2. 测试在 `#log` 出现 `saw file`（流式可能先于 `turn()` resolve）时即读 `#json-out`，读到占位串 `turn JSON (v:1) …`。已改为轮询等到 `#json-out` 真正变为 JSON 再解析。

**纪律不变**：EG live PASS 只关 Electron/Chat GUI residual。**不关** AR 状态列；**不升** H4→I；**不改** capability matrix；**不碰** AR-15；**不改** WP1–WP8 裁决；**不宣称** Agent Loop MVP 或 Desktop Agent Loop MVP。
