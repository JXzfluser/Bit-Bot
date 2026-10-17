# Bit Bot Roadmap（全量，非 Demo）

## M0 — Foundation
- [x] MoonBit toolchain
- [x] `moon new` 仓库
- [x] 团队就位
- [x] 完整能力矩阵（234 原子项）
- [x] 可编译多包骨架 + boot（`scripts/start-bitbot.sh`）
- [x] 架构/接口文档

## M1 — Kernel + Delivery
- [x] TurnContext / ToolRegistry / ApprovalGate
- [x] ui_protocol 全消息类型 + end_turn / thread / widget
- [x] Untrusted content fence 解析与隔离

## M2 — Persistence
- [x] Memory（profile/journal/shared + recall/update）
- [x] Routines（cron + event triggers + lifecycle）
- [x] Skills catalog（managed / user / plugin）

## M3 — Hosts

> Host-integration（真屏/FFI/真 MCP）波次见 `docs/host-integration-roadmap.md`；不重开已 U-PASS。

- [x] Box：Read/Shell/Screenshot/desktop session 协议
- [x] User machines：ListMachines、CopyTo/FromBox、machineId 路由
- [x] computerUse 任务协议

### Host I 波次（smoke + I-PASS · 2026-10-17 Asia/Shanghai）

权威计数与证据：`docs/qa/host-integration-gaps.md`（**I-PASS=234 / 41 行库存 open=0 / 全矩阵 I-todo=0**）；升裁见 `docs/qa/gaps.md`。

- [x] **H0** 探针绿线（0607/0608/2175）— smoke + I-PASS
- [x] **H1** 真屏/Desktop（0605/0802/2160/0806）— smoke + I-PASS（0806=隔离 throwaway jar + Update Computer；共享 9223 untouched）
- [x] **H2** Host UI×14 — smoke + I-PASS（C′）
- [x] **H3** Host FFI×4 — smoke + I-PASS（0705=平台子集）
- [x] **H4** MCP/OAuth/出网×7 — smoke + I-PASS（OAuth 三项用 **local sandbox IdP**，非生产）
- [x] **H5** 媒体/卡/像素×9 — smoke + I-PASS
- [x] **H6** 全矩阵 I 收口×193 — sweep + I-PASS（ADR 0004；kernel-sufficient / covered-by-H0-H5）
- [ ] **Residual（非矩阵 I 阻塞）**：CM-0705 真手机 OS 权限卡仍 GAP

## M4 — Connectors & IO
- [x] MCP dynamic tools / InstallPlugin / Authenticate
- [x] Email（agent inbox + user connectors + draft card 语义）
- [x] Channels（Slack 等 inbound/outbound 规则）

## M5 — Multi-agent
- [x] Task subagents（executor/computerUse/knowledgeWork/video）
- [x] Teammates SendToAgent / CreateAgent / sections
- [x] CloudAgent + Origin/GitHub 面

## M6 — Vertical + App UI parity
- [x] 垂直 skills（scheduling/shopping/meetings/…）
- [x] Settings anchors / update-computer 引导语义
- [x] 首启、语言、时区、voice memo

## M7 — Hardening
- [x] 全矩阵验收清零 P0 gaps（U=234；I=234）
- [x] 回归套件与文档同步（moon CI + H6 sweep soft）
- [x] Host I：41 行库存 open=0；全矩阵 I-PASS=234
- [ ] phone residual 仍待真机（非矩阵 I 阻塞）

## Product Host runtime (post-matrix)

- [x] **Product Host runtime deployed on box** — `scripts/bitbot_runtime/` + Host UI chat/memory on `:8765`; persist under `/workspace/data/`; LLM chain api→ollama→LocalBrain; `bash scripts/deploy_local.sh` (see `docs/qa/real-host-runtime.md`)
  - Status after ADR 0005: this Python path is **optional Host FFI / secondary**, not the product brain.

## Desktop host + MoonBit brain (ADR 0005 · in progress)

Course-correct: product main path is a **Desktop window** + **MoonBit** turn orchestration (not Python LocalBrain, not Host UI smoke as the product).

- [x] ADR 0005 accepted — `docs/adr/0005-course-correct-moonbit-desktop.md`
- [x] `cmd/desktop_turn` — MoonBit CLI: `open_turn` → `deliver_text` → JSON stdout (`--target native`)
- [x] `desktop/` Electron app — window title Bit Bot Desktop; `bitbot.boot()` / `bitbot.turn(text)` → MoonBit
- [x] `scripts/start-desktop.sh` — ensure `moon` on PATH, `npm install`, `electron .`
- [ ] Packaged installer / deeper Host FFI (Shell/FS/network) from Desktop
- [ ] Retire or narrow Python `bitbot_runtime` as product entrypoints in docs/scripts
