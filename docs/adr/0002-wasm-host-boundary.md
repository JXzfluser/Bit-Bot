# ADR 0002 — MoonBit Kernel 与 Host 边界

- 状态：Accepted（**2026-10-31 修订**：原 WASM 边界已被 native FFI 取代）
- 日期：2026-10-17（Asia/Shanghai）；修订 2026-10-31
- 决策者：Bit架构

## 背景

Grok Bot 能力含 Shell、桌面、网络、MCP、邮件等，无法在纯 WASM 沙箱内直接实现。

最初的决策是「WASM Kernel + Host ABI」，并把 `moon.mod` 的 `preferred_target` 设成
`wasm`。这条决策在 2026-10-17 写下时是成立的，但它**描述的边界已经不是产品实际
发布的边界**了，所以本次修订把现状写清楚。

## 决策（现行）：Native Kernel + Host FFI

产品发布的是 **native 二进制内核**，不是 WASM。

| 位置 | 事实 |
|------|------|
| 生产内核 | `moon run cmd/desktop_turn --target native`（开发机）/ 打包后的 `desktop_turn` 二进制（发布包） |
| Host 侧默认 | `BITBOT_MOON_TARGET` 默认 `native`（`hosts/shared/run_moon_turn.js`、`hosts/shared/host_ffi.js`） |
| 打包形态 | `BITBOT_KERNEL_BIN` 指向预编译内核，与 `moon run … --target native` 是 drop-in：同样的 argv 尾、同样的 stdout/stdin 行协议 |
| 边界协议 | 单行 JSON：内核在 stdout 写 `BITBOT_FFI <json>\n`，Host 在 stdin 回一行 JSON（`cmd/desktop_turn/bitbot_ffi_stub.c`） |
| WASM target | `cmd/desktop_turn/agent_loop_product_wasm.mbt` —— **只保留 legacy planner**，生产不跑；仅 `moon test --target wasm` 覆盖它 |

`moon.mod` 的 `preferred_target` 此前仍是 `wasm`，与生产相反，已一并改为 `native`，
让"默认构建"和"发布产物"落在同一个 target 上。

## 内核 / Host 职责划分（不变）

| 在 Kernel（MoonBit）内 | 经 Host FFI/IPC |
|----------------------|-----------------|
| Turn 状态机、Todo、调度逻辑 | Shell / Read / AwaitShell |
| ApprovalGate 策略、Fence 解析 | 审批卡 UI、OAuth 窗口 |
| Tool 编排与参数校验 | 真实进程、文件系统字节、网络 |
| Memory/Routine/Skill 逻辑模型 | 持久化存储引擎、cron 唤醒时钟 |
| Subagent 协议与状态聚合 | 子进程/云代理运行时、桌面会话 |
| 能力策略、「不擅自外发」判定 | SendToUser 投递、SMTP/Slack API |

Kernel 只依赖 `HostAbi`；具体 Node/浏览器/系统实现属于 Host。

## 后果

- 所有副作用表现为 `Effect` → Host → `TurnEvent` 回注。
- 禁止在 Kernel 内偷开 socket/`fetch` 绕过 Gate。
- 测试可用 mock Host；集成测试打真实 Host。
- computerUse / CloudAgent 的「重活」在 Host，Kernel 保留编排权威。
- **CI 必须同时测两个 target**：native 是发布路径，wasm 只是 legacy planner 的保留测试。
  只跑 wasm 的 CI 会给出一个「绿」但与产品无关的结论——这正是本 ADR 最初遗漏的部分。

## 被取代的决策（原 0002，2026-10-17）

原决策为「WASM Kernel + Host ABI」，`preferred_target = wasm`。废弃原因：

1. WASM target 走的是 legacy planner，与 native 的 live loop 不是同一条代码路径，
   在 wasm 上测出来的绿不能代表产品行为。
2. 发布包需要的是免工具链的独立内核二进制，WASM 产物无法满足打包形态。

原「内核在 WASM / 能力在 Host」的**职责划分表仍然有效**，上面已保留。

## 备选（未采纳）

1. 纯 Native 目标放弃 WASM — 与当时的 `moon.mod preferred_target` 冲突。
   **该冲突已于本次修订解除**（preferred_target 改为 native），WASM target 作为
   legacy planner 的回归测试保留。
2. 能力全在 Host 脚本、MoonBit 只当胶水 — 无法保证类型化契约与矩阵验收。
