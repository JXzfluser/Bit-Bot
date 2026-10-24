# Agent loop gates A1–A8

> 内核入口：`open_turn` 之后 `AgentLoop::run(ctx, host)`。`max_steps` 强制 64。Host 不自转模型循环。  
> Host FFI：`exec_tool` / `request_approval` / `deliver` / `llm_chat`（保留 `tool_calls`）。审批在 Call 边界；参数里的 `approved` 不能放行。  
> **不是** H4 升 I。**不关** AR-15。这些门通过也不等于桌面产品路径上的 Agent Loop MVP（Host 只解析并上交 `tool_calls`，不在 Node 里 think→call→observe）。

| ID | 裁决 | 期望 | 证据 |
|---|---|---|---|
| A1 | mock PASS | `open_turn` → `AgentLoop::run`。构造体 `max_steps=1` 仍在 64 步停止，执行 64 次 | `moon test -p runtime` |
| A2 | mock PASS | 工具结果回注下一轮 `llm_chat`；3 步内 final | 同上 |
| A3 | mock PASS | 无 `tool_calls` 则 deliver final，不执行工具 | 同上 |
| A4 | mock PASS | 未知工具 / 缺必填参数给出可读错误，不假装成功 | 同上 |
| A5 | mock PASS | 一直 tool call 时恰好 64 步、64 次 exec，没有第 65 次 | 同上 |
| A6 | mock PASS | Shell 在 Call 边界 `request_approval`。拒绝或取消不执行。参数 `"approved":true` 不能跳过审批 | 同上 |
| A7 | Host PASS | 流式路径解析并上交 `tool_calls`（分片拼接 arguments）。禁止只读 `delta.content`。只有 tool_calls、没有 content 也不得当成空流丢掉 | `node scripts/prove_agent_loop_a7_a8.js` |
| A8 | Host 最小门 PASS | 纯 content 流式仍得到原文且 `tool_calls=[]`；非流式 content 同样。runtime 回归 47/0 | 同一脚本 + `moon test -p runtime` |

全桌面 `smoke_desktop_turn.sh` / `smoke_grok_desktop_parity.sh` **没有**在本波重跑。A8 是 Host `executeHostEffects` → `llm_chat` 的最小烟，不是全量桌面烟。

## evidence_cmd

```bash
bash scripts/prove_agent_loop_a7_a8.sh
```

脚本会：

1. 用本机 loopback stub 打真实 `createHostFfi` → `executeHostEffects(kind=llm_chat)`。
2. A7：SSE 按小块写出，`tool_calls` 的 arguments 跨 chunk 拼接为 `{"path":"a.txt"}`，同时保留 content `Hi`。只有 tool_calls 的流 `ok` 且不上交空。
3. A7：源码不再出现 `obj.choices[0].delta.content` 这种只取 content 的读法，而是 `consumeSseDataLine`。`agent_loop_ffi.js` 的 `implicitHostLoop` 为 false，不导出 `runAgentLoop`。
4. A8：content-only 流得到 `Hello world` 且 `tool_calls` 为空；非流式 content 得到 `plain answer`。
5. 有 `moon` 时跑 `moon test -p runtime`（A1–A6 + 既有 runtime 回归）。没有 moon 则失败，不把缺工具链写成 PASS。

## 实测

2026-10-24，本工作区：

```bash
bash scripts/prove_agent_loop_a7_a8.sh
```

Host 段：`prove_agent_loop_a7_a8 pass=20 fail=0`。  
`moon test -p runtime`：`Total tests: 47, passed: 47, failed: 0.`

远程当时没有 `runtime/agent_loop*.mbt`。本 PR 按上述 A1–A6 合同补上 mock Host（入口 `AgentLoop::run`，cap 64），使 `moon test -p runtime` 为 47/0。  
`tools/dynamic.mbt` 的 `schema_required_keys` 会把 `"path"` 收成 `path`（`String::replace` 只去掉一处引号，否则合法参数被判缺字段）。`moon test -p tools`：`Total tests: 61, passed: 61, failed: 0.`

未升 I。未改 capability matrix。未关 AR-15。未宣称 Agent Loop MVP。
