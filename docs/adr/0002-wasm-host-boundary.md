# ADR 0002 — MoonBit/WASM 与 Host 边界

- 状态：Accepted  
- 日期：2026-10-17（Asia/Shanghai）  
- 决策者：Bit架构

## 背景

`preferred_target = wasm`。Grok Bot 能力含 Shell、桌面、网络、MCP、邮件等，无法在纯 WASM 沙箱内直接实现。

## 决策

采用 **WASM Kernel + Host ABI**：

| 在 WASM（MoonBit）内 | 经 Host FFI/IPC |
|----------------------|-----------------|
| Turn 状态机、Todo、调度逻辑 | Shell / Read / AwaitShell |
| ApprovalGate 策略、Fence 解析 | 审批卡 UI、OAuth 窗口 |
| Tool 编排与参数校验 | 真实进程、文件系统字节、网络 |
| Memory/Routine/Skill 逻辑模型 | 持久化存储引擎、cron 唤醒时钟 |
| Subagent 协议与状态聚合 | 子进程/云代理运行时、桌面会话 |
| 能力策略、「不擅自外发」判定 | SendToUser 投递、SMTP/Slack API |

Kernel 只依赖 `HostAbi` trait；具体 Node/浏览器/系统实现属于 Host。

## 后果

- 所有副作用表现为 `Effect` → Host → `TurnEvent` 回注。  
- 禁止在 WASM 内偷开 socket/`fetch` 绕过 Gate。  
- 测试可用 mock Host；集成测试打真实 Host。  
- computerUse / CloudAgent 的「重活」在 Host，Kernel 保留编排权威。

## 备选（未采纳）

1. 纯 Native 目标放弃 WASM — 与 `moon.mod` preferred_target 冲突，且损可移植。  
2. 能力全在 Host 脚本、MoonBit 只当胶水 — 无法保证类型化契约与矩阵验收。
