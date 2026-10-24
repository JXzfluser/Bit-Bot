# 生产 LLM 供应商（PP1–PP7）

状态：接线证据。不是 I。不关 AR-01/02/03/15 状态列。不改 capability matrix。不碰 H4。不倒裁 A/WP/EG/P0/AU/SK。不宣称 Agent Loop MVP，也不宣称 Desktop Agent Loop MVP。

本页证明产品 Chat 打到配置好的外部供应商 HTTP，不是 WP loopback stub，也不是 EG loopback。`BITBOT_LEGACY_CHAT_EFFECT=1` 与 `--legacy-chat-effect` 不是本页证据。

## 路径（PP-D1…PP-D6）

PP-D1. 产品默认 Chat 是 `open_turn` → `AgentLoop::run` → Host `llm_chat` → `executeLlmChat`。内核拥有循环。Host 不因为 `tool_calls` 再叫一次模型。

PP-D2. URL 来自 catalog / `BITBOT_LLM_BASE_URL`（deepseek 的 `env_base` 就是这个名字）。缺省 `https://api.deepseek.com/v1`。不是 `127.0.0.1`，不是 WP/EG 的 loopback harness，也不是进程内假装的 completion。

PP-D3. Agent Loop 第一次请求的 `tools` 非空（Read / Shell）。

PP-D4. 模型 `tool_calls` 回到内核 Call / `exec_tool`。`kernel_ops` 与 `node_ops` 一致。provider 次数等于内核 `llm_chat` 次数。

PP-D5. Observe 之后的下一次 provider 请求带 fence / untrusted observation。该步若 Finish，请求里仍然留着 observation。

PP-D6. 密钥只从 `BITBOT_LLM_API_KEY` 或当前 provider 的 catalog `env_key` 进入 Host。不进 argv。tee、artifact、printenv 子进程不得出现明文。落盘的 Authorization 只能是 `Bearer [redacted]`。没有密钥，或强制离线，退出码非 0，输出 `NEEDS_LIVE` 或 `BLOCKED`。不许用 stub 写成 PASS。

## 命令

```bash
bash scripts/prove_production_provider.sh
```

## 4. Binding

`ok PP1` … `ok PP7` 与下面七行逐字同构。脚本对每一行打一个 `ok` 或 `FAIL`。七行缺一即失败。legacy chat effect 不在此列。WP/EG loopback 不在此列。

- PP1 live AgentLoop llm_chat hits external base_url (entry=AgentLoop::run)
- PP2 first request tools non-empty
- PP3 tool_calls → Kernel Call/exec_tool (not Host self-loop second llm_chat)
- PP4 after Observe, next provider request includes fence/untrusted observation (or Finish without dropping observation)
- PP5 tee/artifact/printenv child has no key plaintext; Authorization redacted
- PP6 no key / forced offline → NEEDS_LIVE or BLOCKED, exit ≠ 0
- PP7 regression note — A/WP/EG/P0/AU/SK not regressed; P0-3 still U-only; no MVP claim

| ID | 断言 |
|---|---|
| PP1 | `createTurnRunner.runTurn` 进入内核 `AgentLoop::run`（`entry=AgentLoop::run`，`agent_entry=open_turn`）。`executeLlmChat` 的 HTTP 打到 `resolveLlmConfig().base_url`。Host 不是 loopback，也不是进程内 stub |
| PP2 | 第一次 provider 请求体的 `tools` 非空 |
| PP3 | 出现 `tool_calls` 后，内核走出 `exec_tool`。`node_ops` 与 `kernel_ops` 相同。第二次 `llm_chat` 仍是内核要的，不是 Host 自转 |
| PP4 | 第一次 `exec_tool` 之后的 provider 请求含 `cursor_untrusted_data` 或 `untrusted`，以及本回合写入的观察标记。若 `agent_stop=Final`，最后一次请求仍带着该观察 |
| PP5 | 本命令的 tee、本回合新建的 llm artifact / trace、以及 `printenv` 子进程都不含密钥明文。Authorization 只以 `Bearer [redacted]` 出现 |
| PP6 | 子进程去掉 catalog env key 后打印 `NEEDS_LIVE` 且退出码非 0。另一子进程把 base 指到不可解析的主机并打印 `BLOCKED` 且退出码非 0。两条都不返回假装的 completion |
| PP7 | 回归声明。A/WP/EG/P0/AU/SK 的证据命令与「不关 AR / 不升 I / 不宣称 MVP」仍在。`docs/qa/p0-security-gates.md` 的 P0-3 仍是 U only（`不升 I`）。capability matrix 未把 AR-01/02/03/15 写成已关。本页不宣称 Desktop Agent Loop MVP |

无密钥时顶层命令本身就是 PP6 的 `NEEDS_LIVE` 路径：不打 `ok PP1` … `ok PP7`，不以 `pass=7 fail=0` 收尾。

## 操作员实跑 PP1–PP4

CI 没有生产密钥时，上面的命令退出码为 2，输出 `NEEDS_LIVE`。这不是 PASS。要实跑 PP1–PP4：

1. 安装 MoonBit，保证 `moon` 在 `PATH`。脚本会设 `MOONBIT_NEW_NATIVE=0`（产品 FFI 是 C stub）。
2. 密钥放进环境，不要写进 argv，不要 `echo`。deepseek（catalog 默认）用 `BITBOT_LLM_API_KEY`。其他 provider 用该条目的 `env_key`（例如 `BITBOT_LLM_QWEN_API_KEY`）。
3. 需要时再设 `BITBOT_LLM_BASE_URL`。不设则用 catalog 缺省 `https://api.deepseek.com/v1`。不要指到 `127.0.0.1` / `localhost`。那是 WP/EG harness，本页会 `BLOCKED` 退出，不算 PASS。
4. `unset BITBOT_LEGACY_CHAT_EFFECT`。设为 `1` 时本命令直接失败，不把它当成 PP 证据。
5. 不要设 `BITBOT_MOBILE_HOST=1`（手机进程不持有桌面模型密钥）。
6. 跑 `bash scripts/prove_production_provider.sh`。模型必须对 Read 发出 `tool_calls`。第一次就 Finish、没有工具调用时，PP3/PP4 失败，脚本不会改判成 PASS。

期望成功摘要：`prove_production_provider pass=7 fail=0`，以及与 §4 逐字相同的 `ok PP1` … `ok PP7`。

## 实测

2026-10-24，本工作区没有 `BITBOT_LLM_API_KEY`，也没有其他 catalog `env_key`：

```bash
bash scripts/prove_production_provider.sh
```

退出码 2。输出：

```text
note PP6 no-key child exit=2 NEEDS_LIVE
note PP6 offline child exit=3 BLOCKED
NEEDS_LIVE
note operator live PP1-PP4: docs/agent-core/01-agent-loop-production-provider.md
prove_production_provider NEEDS_LIVE
```

这不是 PASS。没有 `ok PP1` … `ok PP7`，也没有 `pass=7 fail=0`。PP6 的两个子进程分别以 `NEEDS_LIVE`（退出码 2）和 `BLOCKED`（退出码 3）结束。loopback base 另测为 `BLOCKED` 退出码 3。`BITBOT_LEGACY_CHAT_EFFECT=1` 直接失败，不算 PP。

有密钥的操作员按上一节实跑后，成功摘要才是 `prove_production_provider pass=7 fail=0`。

## 非目标

- 不关 AR-01、AR-02、AR-03、AR-15 的状态列。
- 不升 I，不改 capability matrix，不把 P0-3 写成 I。
- 不宣称 Agent Loop MVP 或 Desktop Agent Loop MVP。
- 不把 WP/EG 的 loopback stub 写成 PP1–PP4。
- 不把 `BITBOT_LEGACY_CHAT_EFFECT=1` 写成 PP 证据。
- 不把 A/WP/EG/P0/AU/SK 的既有 PASS 改判。
