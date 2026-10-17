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

### Host I 波次（smoke + I-PASS · 2026-10-17 Asia/Shanghai）

权威计数与证据：`docs/qa/host-integration-gaps.md`（**I-PASS=41 / open GAP=0**）；升裁见 `docs/qa/gaps.md`。

- [x] **H0** 探针绿线（0607/0608/2175）— smoke + I-PASS
- [x] **H1** 真屏/Desktop（0605/0802/2160/0806）— smoke + I-PASS（0806=隔离 throwaway jar + Update Computer；共享 9223 untouched）
- [x] **H2** Host UI×14 — smoke + I-PASS（C′）
- [x] **H3** Host FFI×4 — smoke + I-PASS（0705=平台子集）
- [x] **H4** MCP/OAuth/出网×7 — smoke + I-PASS（OAuth 三项用 **local sandbox IdP**，非生产）
- [x] **H5** 媒体/卡/像素×9 — smoke + I-PASS
- [ ] **Residual（非 41 行 open 库存）**：CM-0705 真手机 OS 权限卡仍 GAP

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
- Host I：41 行库存 open=0；phone residual 仍待真机
