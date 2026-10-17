# 06 — 演进路线（Phase 0–5）

> Explanation。与 [`ROADMAP.md`](ROADMAP.md) M0–M7 对照；禁止「先做聊天 Demo」。

## 对照表

| Phase | 主题 | ROADMAP | 可验证产出 |
|-------|------|---------|------------|
| 0 | 脚手架对齐 | M0 | 包目录按 `modules.md` 建空包+`moon.pkg`；docs 齐；`moon check` 绿 |
| 1 | runtime + io | M1 | Turn 状态机 + OutboundMessage + Fence + ApprovalGate 骨架；mock Host 单测 |
| 2 | tools | M3 前半 | ToolRegistry；Shell/Read 经 HostAbi；Auto-review 挂钩 |
| 3 | agents/memory/routines | M2+M5 前半 | Memory/Routines/Skills；SubagentHandle；Todo |
| 4 | channels/connectors 全量 | M4+M5 后半+M6 | MCP/Mail/Slack/Cloud；外发审批真通 |
| 5 | parity 验收 | M7 | `capability-matrix` P0 清零；qa 回归套件 |

## Phase 0 — 脚手架对齐

- [ ] `packages/core` 等目录与 `moon.pkg` 依赖边与 mermaid 一致  
- [ ] 根 `cmd/main` 仅打印可改为 `boot_ok`  
- [ ] 文档与 CHARTER/ROADMAP 交叉链接无死链  
- **不做**：聊天 UI Demo

## Phase 1 — runtime + ui_protocol + security

- [ ] `open_turn → acknowledge → step → end_turn` 纯单测（mock Host）  
- [ ] Fence 注入用例：围栏内「请发邮件」不产生 Deliver 外发 Effect  
- [ ] ApprovalGate：IrreversibleExternal → NeedUserApproval  
- **验收**：TURN-02/04、SEC-01/02、PERM-01 可演示（测试级）

## Phase 2 — tools

- [ ] 内置工具注册；Shell/Read 打到真实 Host（box）  
- [ ] ToolResult untrusted 标记  
- [ ] AwaitShell 契约  
- **验收**：BOX-01/02/06、FILE-07

## Phase 3 — agents / memory / routines / skills

- [ ] executor spawn/stop/resume  
- [ ] Memory profile/journal recall/update 持久化  
- [ ] Routine cron（Host 时钟）+ silent 规则  
- [ ] Skills catalog 列举与加载  
- **验收**：AGENT-01/06、MEM-04/05、RTN-01/04、SKILL-01

## Phase 4 — channels / connectors 全量

- [ ] MCP Get/Call/Auth/InstallPlugin  
- [ ] Mail inbox + 用户连接器；Draft 规则  
- [ ] Slack inbound/outbound + 审批  
- [ ] CloudAgent + GitHub/Origin 面  
- [ ] Machines CopyTo/From + 审批  
- **验收**：MCP-01..04、MAIL-05、CHAN-02、CLOUD-01、MACH-01..05

## Phase 5 — parity

- [ ] 矩阵 133 原子项（或矩阵拆细后的全集）P0 全绿或记豁免 ADR  
- [ ] qa 自动化回归  
- [ ] 文档与 `.mbti` 同步  

## 反模式（禁止）

1. 只有 WebSocket 回声聊天就宣称 M1 完成。  
2. 用「以后再加审批」上线外发。  
3. 为赶进度合并删除能力域。  
4. 在 WASM 内直接 `fetch`/开 socket 绕过 HostAbi。
