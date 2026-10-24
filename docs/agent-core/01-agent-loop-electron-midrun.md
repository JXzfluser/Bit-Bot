# Electron / Chat GUI：Agent Loop mid-run

状态：Accepted。这是接线边界，不是 I，不关 AR 状态列，不改 capability matrix，不碰 AR-15 / H4，不倒裁 WP1–WP8，不宣称 Agent Loop MVP 或 Desktop Agent Loop MVP。

本页在本工作区原先不存在。内容按 `01-agent-loop-product-path.md` 写死 Electron composer 这一段，供本轮实现与证据对齐。

## 路径

1. Desktop Chat composer（`#composer #text` → `runUserTurn` → `bitbot:turn` → `runner.runTurn`）与 cmd 共用入口：`open_turn` → `AgentLoop::run`。`max_steps` 仍强制 64。
2. Host 仍只回答内核吐出的一行 `BITBOT_FFI`：`llm_chat` / `exec_tool` / `request_approval` / `deliver`。`llm_chat` 走现有 `executeLlmChat`。Node 不根据 `tool_calls` 再叫一次模型。
3. Renderer 不拥有第二套 loop，也不另开状态机。它只投影内核 `AgentLoop::run` 已经走出的 `BITBOT_LOOP` 行（`bitbot:agent-loop`）。投影函数不得调用 `turn` 或 `executeLlmChat`。Host 与 GUI 禁止 `while` 再调用 `llm_chat`。模型循环只留在 `AgentLoop::run`。
4. `AgentStep` 形状只描述内核已经走出的步：`{ kind: "entry", entry: "AgentLoop::run", agent_entry: "open_turn" }` 或 `{ kind: "op", op }`，`op` 仅限上述四个操作。
5. 非 Chat（例如启动时的 `ListMachines`）仍不进 Agent Loop。
6. `--legacy-chat-effect` / `BITBOT_LEGACY_CHAT_EFFECT=1` 才回到单次 effect。默认 composer 不走这条。
7. Shell 仍须本回合 `request_approval` 的 allow。本轮不改审批 UI，不改 `bitbot:approvals:runAllowed` 与 cn-probe 里既有的 `approved: true`。

## 验收

EG1–EG3 是关掉 Electron/Chat GUI residual 的最低条。EG4–EG6 一起跑。通过这些门不关闭 AR-01/02/03 的状态列，也不把结果写成 MVP。

| ID | 最低条 | 期望 |
|---|---|---|
| EG1 | 是 | 真实 Electron composer 回合还在飞（最终助手句尚未出现在 `#log`）时，trace 与 DOM 已有 `entry=AgentLoop::run` / `agent_entry=open_turn`。源码字面量或单独的 cmd stub 不算 |
| EG2 | 是 | 同一飞行窗口里内核已走出 `llm_chat` 与 `exec_tool`。生产 `executeLlmChat` 已收到第一次请求且带 tools。第二次 provider 请求是内核又要了一次 `llm_chat`，不是 Host 自转 |
| EG3 | 是 | 飞行中的 GUI 取消按钮把取消信号交给 Host，内核 `AgentLoop::run` 以 `Cancelled` 停下。停下之后没有新的 `llm_chat` 或 `exec_tool`。`kernel_ops` 与 `node_ops` 对齐不是这一条 |
| EG4 | 否 | 飞行中 `#log [data-agent-step]` 只显示已投影的 AgentStep（entry、`llm_chat`、`exec_tool`），且当时还没有 `deliver` |
| EG5 | 否 | 第二次 provider body 含工具观察（`<cursor_untrusted_data` 与 `see b.txt`）。回合结束后可见助手文本是 `saw file`。默认未设 `BITBOT_LEGACY_CHAT_EFFECT` |
| EG6 | 否 | 本轮 Read 路径不出现审批放行。composer 不传 `approved: true`。不改 AR-15、H4、capability matrix。同一条 evidence_cmd 再跑 WP SoT `bash scripts/prove_agent_loop_product_wire.sh`，必须 fail=0。WP1–WP8 PASS 本身不是 EG1–EG5 |

## evidence_cmd

```bash
bash scripts/prove_agent_loop_electron_midrun.sh
```

脚本拉起真实 `hosts/desktop/main.js`。EG1/EG2/EG4/EG5 在一次 Chat 的第二次模型完成返回之前读 trace、DOM 和 loopback provider。EG3 另起一次飞行中的回合，点 `#turn-cancel`，断言内核 `Cancelled` 且没有新的 `llm_chat` / `exec_tool`。然后跑 WP SoT。缺 Electron、显示或 moon 时失败退出，不把缺工具链写成 PASS。WP PASS 不等于本页的 EG。ops 对齐不编号为 EG3。
