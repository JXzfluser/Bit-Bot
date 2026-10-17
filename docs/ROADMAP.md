# Bit Bot Roadmap（全量，非 Demo）

## M0 — Foundation
- [x] MoonBit toolchain
- [x] `moon new` 仓库
- [x] 团队就位
- [x] 完整能力矩阵（234 原子项）
- [x] 可编译多包骨架 + boot（`scripts/start-bitbot.sh` 现为次级；产品启动见 Desktop）
- [x] 架构/接口文档

## M1 — Kernel + Delivery
- [x] TurnContext / ToolRegistry / ApprovalGate
- [x] ui_protocol 全消息类型 + end_turn / thread / widget
- [x] Untrusted content fence 解析与隔离

## M2 — Persistence
- [x] Memory（profile/journal/shared + recall/update）
- [x] Routines（cron + event triggers + lifecycle）
- [x] Skills catalog（managed / user / plugin）

## M3 — Hosts（产品基线：Desktop + multi-end）

> Host-integration（真屏/FFI/真 MCP）波次见 `docs/host-integration-roadmap.md`；不重开已 U-PASS。
> **产品基线**：`hosts/desktop` + `hosts/ios` + `hosts/android` 注册 `MachineKind`；MoonBit 编排 turn。

- [x] Box：Read/Shell/Screenshot/desktop session 协议
- [x] User machines：ListMachines、CopyTo/FromBox、machineId 路由
- [x] computerUse 任务协议
- [x] **Desktop Electron host** — `hosts/desktop/` + `cmd/desktop_turn`（JSON `v:1`）
- [x] **Multi-end layout** — `hosts/{desktop,ios,android}` + `scripts/host_mobile_stub.sh`

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

## M6 — Vertical + App UI parity（产品基线续）
- [x] 垂直 skills（scheduling/shopping/meetings/…）
- [x] Settings anchors / update-computer 引导语义
- [x] 首启、语言、时区、voice memo
- [x] Grok-like Desktop chrome（agents sidebar + machines panel + MoonBit transcript）
- [ ] Packaged installer / deeper Desktop Host FFI（Shell/FS/network execute loop）
- [ ] iOS / Android beyond stub（真机 HostAbi）

## M7 — Hardening
- [x] 全矩阵验收清零 P0 gaps（U=234；I=234）
- [x] 回归套件与文档同步（moon CI + H6 sweep soft）
- [x] Host I：41 行库存 open=0；全矩阵 I-PASS=234
- [ ] phone residual 仍待真机（非矩阵 I 阻塞）

## Non-goal — Python product deploy（demoted）

- [x] **Demoted**: `scripts/bitbot_runtime/` + `deploy_local.sh` + `:8765` Host UI are **not** the product brain.
  - Optional Host FFI / secondary only (ADR 0005).
  - Do not expand Python LocalBrain. Prefer deleting or narrowing entrypoints that advertise Python chat as Bit Bot.
  - Product path: `bash scripts/start-desktop.sh` → MoonBit turns.

## Desktop host + MoonBit brain (ADR 0005)

- [x] ADR 0005 accepted — `docs/adr/0005-course-correct-moonbit-desktop.md`
- [x] `cmd/desktop_turn` — intents: chat / ListMachines / memory / host_effect / channel_delivery / connectors_status / claim_inbox / draft_mail (`v:1` JSON)
- [x] ADR 0002 Host FFI 回注 — Desktop executes effects then `--apply-host-results` → `continue_after_host_ffi` (MoonBit kernel absorbs TurnEvent)
- [x] `hosts/desktop/` Electron — agents + machines + turn transcript from MoonBit
- [x] `hosts/ios/` + `hosts/android/` stubs + `scripts/host_mobile_stub.sh`
- [x] `scripts/start-desktop.sh` — moon on PATH, npm, Electron under `hosts/desktop`
- [ ] Live Slack/SMTP/MCP Host FFI (beyond stub channel_send / mail_draft)
- [ ] Real iOS/Android hosts beyond ListMachines kinds + stub scripts
- [x] Session-scoped Host memory: Desktop persists `data/memory/desktop-host.json` and reinjects via `--seed-memory` into MoonBit
- [ ] Stronger session TurnContext (thread/channel/machine_id across turns)
