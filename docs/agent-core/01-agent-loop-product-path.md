# Desktop / cmd 产品路径：Agent Loop

状态：Accepted。这是接线边界，不是 I，不关 AR-15，不改 capability matrix。

默认用户回合（Desktop `bitbot:turn` / `runTurn`，意图 `Chat`）：

1. `open_turn` → `AgentLoop::run`。`max_steps` 仍强制 64。
2. Host 只实现四个操作：`llm_chat` / `exec_tool` / `request_approval` / `deliver`。
3. `llm_chat` 走现有 provider（`executeLlmChat`）并带 `Read` / `Shell` tools。流式解析复用已绿的 `tool_calls` 解析。
4. Node 按内核吐出的一行 `BITBOT_FFI` 做一次响应。禁止 Node 再写 think→call→observe。
5. Shell 必须先有本回合 `request_approval` 的 allow。参数里的 `approved` 不能放行。
6. 非 Chat（例如 `ListMachines`）仍走原来的 effect 计划。
7. `--legacy-chat-effect` 或 `BITBOT_LEGACY_CHAT_EFFECT=1` 才回到单次 `llm_chat` effect。
8. 旧 guarded auto re-run 仅当 `BITBOT_LEGACY_GUARDED_RERUN=1`。

原生后端必须是 C（`MOONBIT_NEW_NATIVE=0`），因为交换一行 stdin/stdout 的实现是 `cmd/desktop_turn/bitbot_ffi_stub.c`。

未过 WP1–WP3 的 live 证据，不得宣称 Desktop Agent Loop MVP。
