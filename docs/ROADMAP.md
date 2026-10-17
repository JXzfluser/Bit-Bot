# Bit Bot Roadmap（全量，非 Demo）

## M0 — Foundation（进行中）
- [x] MoonBit toolchain
- [x] `moon new` 仓库
- [x] 团队就位
- [ ] 完整能力矩阵（80+ 原子项）
- [ ] 可编译多包骨架 + boot
- [ ] 架构/接口文档

## M1 — Kernel + Delivery
- TurnContext / ToolRegistry / ApprovalGate
- ui_protocol 全消息类型 + end_turn / thread / widget
- Untrusted content fence 解析与隔离

## M2 — Persistence
- Memory（profile/journal/shared + recall/update）
- Routines（cron + event triggers + lifecycle）
- Skills catalog（managed / user / plugin）

## M3 — Hosts

> Host-integration（真屏/FFI/真 MCP）波次见 `docs/host-integration-roadmap.md`；不重开已 U-PASS。

- Box：Read/Shell/Screenshot/desktop session 协议
- User machines：ListMachines、CopyTo/FromBox、machineId 路由
- computerUse 任务协议

## M4 — Connectors & IO
- MCP dynamic tools / InstallPlugin / Authenticate
- Email（agent inbox + user connectors + draft card 语义）
- Channels（Slack 等 inbound/outbound 规则）

## M5 — Multi-agent
- Task subagents（executor/computerUse/knowledgeWork/video）
- Teammates SendToAgent / CreateAgent / sections
- CloudAgent + Origin/GitHub 面

## M6 — Vertical + App UI parity
- 垂直 skills（scheduling/shopping/meetings/…）
- Settings anchors / update-computer 引导语义
- 首启、语言、时区、voice memo

## M7 — Hardening
- 全矩阵验收清零 P0 gaps
- 回归套件与文档同步
