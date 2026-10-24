# HostAbi agent-loop draft

状态：草稿。不是 I。不关 AR-15。不是 Agent Loop MVP。

内核循环仍是 `open_turn` 之后的 `AgentLoop::run(ctx, host)`，`max_steps` 强制 64。本页只加一个 draft host：`LoopHostAbi`（`runtime/agent_loop_hostabi.mbt`）。它实现同一组四调用：

- `llm_chat`
- `exec_tool`（Read 读 draft 内存文件；Shell 只在审批 Allow 之后由循环调用）
- `request_approval`（不看参数里的 `approved`）
- `deliver`

没有第二套模型循环。

## 流式 A7

`hosts/shared/agent_loop_stream_stub.js` 不再 fail-closed。它把 SSE 交给 `agent_loop_ffi.js` 的解析器，`tool_calls` 原样返回，`fail_closed` 为 false。Host 的 `httpJsonStream` 经这个 stub 取 `consumeSseDataLine`。

## evidence_cmd

```bash
bash scripts/prove_agent_loop_a7_a8.sh
```

`moon test -p runtime` 含 HABI-1…HABI-6。通过只说明 mock / 最小 Host 烟，不升 I。
