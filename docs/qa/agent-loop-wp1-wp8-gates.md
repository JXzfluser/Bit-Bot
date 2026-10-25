# Agent loop product gates WP1–WP8

> 默认 Desktop/cmd Chat：`open_turn` → `AgentLoop::run`。Host 不自转模型。  
> **不是** H4 升 I。**不关** AR-15。**不改** capability matrix。  
> A1–A8 绿不够。WP1–WP3 没有 live 进程证据，不得宣称 Desktop Agent Loop MVP。

| ID | 裁决 | 期望 | 证据 |
|---|---|---|---|
| WP1 | live PASS | 默认用户消息进入 Kernel `AgentLoop::run`（stderr `entry=AgentLoop::run`，JSON `agent_loop` + `agent_entry=open_turn`）。不是单次计划好的 `llm_chat` effect | `bash scripts/prove_agent_loop_product_wire.sh` |
| WP2 | live PASS | Host `llm_chat` 走 provider，请求带 tools。第二次调用的 messages 含工具观察（fence + `see b.txt`） | 同上 |
| WP3 | live PASS | Node 每个内核请求只回一次。`kernel_ops` 与 `node_ops` 一致，provider 次数等于内核 `llm_chat` 次数。wire 模块没有 `while`，pump 不读 `tool_calls` | 同上 |
| WP4 | live PASS | Shell 无 allow 不执行。参数 `"approved":true` 不能跳过 `request_approval`。allow 之后观察才进下一轮 | 同上 |
| WP5 | live PASS | 一直 tool call 时 `agent_exec=64`、`agent_llm=64`、`agent_stop=MaxSteps`，provider 调用 64 次 | 同上 |
| WP6 | live PASS | 无 tool call 时 deliver 最终助手文本，`agent_exec=0` | 同上 |
| WP7 | live PASS | `ListMachines` 不进 Agent Loop、不打 provider、不自动 `auto_approved`。guarded re-run 默认关，`BITBOT_LEGACY_GUARDED_RERUN=1` 才开 | 同上 |
| WP8 | runtime PASS | `moon test -p runtime` 54/54。解析器白盒 3/3。A7 脚本本波复跑仍绿 | 同上 + `node scripts/prove_agent_loop_a7_a8.js` |

全桌面 `smoke_desktop_turn.sh` / `smoke_grok_desktop_parity.sh` **没有**在本波重跑。

## evidence_cmd

```bash
bash scripts/prove_agent_loop_product_wire.sh
```

脚本会：

1. 用本机 loopback stub 走真实 `createTurnRunner.runTurn` → `moon run cmd/desktop_turn --target native`。
2. 内核经 `BITBOT_FFI` 每次要一个 op；Node `pumpMoonFfi` 回一行 JSON，不根据 `tool_calls` 再叫模型。
3. WP1/WP2：SSE 工具调用后，第二次 provider body 含 `<cursor_untrusted_data` 与 `see b.txt`，最终助手文本是 `saw file`。
4. 有 `moon` 时跑 `moon test -p runtime` 和 `cmd/desktop_turn/agent_loop_product_wbtest.mbt`。没有 moon 则失败，不把缺工具链写成 PASS。

## 实测

2026-10-25，本工作区：

```bash
node scripts/prove_agent_loop_product_wire.js
moon test -p runtime
moon test cmd/desktop_turn/agent_loop_product_wbtest.mbt --deny-warn
node scripts/prove_agent_loop_a7_a8.js
```

`prove_agent_loop_product_wire pass=49 fail=0`。  
`moon test -p runtime`：`Total tests: 54, passed: 54, failed: 0.`<br>
parser 白盒：`Total tests: 3, passed: 3, failed: 0.`<br>
`prove_agent_loop_a7_a8 pass=23 fail=0`。

Shell 执行是审批后的记录标记 `[product-shell]`，不在这条路径上启动真实 shell。Read 优先用 `BITBOT_LOOP_READ_JSON`，否则只读仓库根目录内的相对路径。

未升 I。未改 capability matrix。未关 AR-15。本页不把结果写成 Desktop Agent Loop MVP 完成声明：WP1–WP3 的 live 证据已过，产品级 MVP 仍留给 Bit 验证裁决。

## Electron / Chat GUI residual

上表是 `createTurnRunner.runTurn` 的 live 证据，不是 Desktop Electron composer。composer mid-run 的边界与证据另记，WP1–WP8 裁决不变：

- `docs/agent-core/01-agent-loop-electron-midrun.md`
- `docs/qa/electron-chat-agent-loop-gates.md`
- `bash scripts/prove_agent_loop_electron_midrun.sh`

该命令通过也不关闭 AR 状态列，也不宣称 MVP。
