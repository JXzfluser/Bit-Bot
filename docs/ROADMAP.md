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
- [x] Packaged installer / deeper Desktop Host FFI（Shell/FS/network execute loop）— `pack-desktop.sh` + shared Host FFI execute loop
- [x] iOS / Android beyond stub — `hosts/{ios,android}/BitBotHost` native shells + `mobile_host` HostAbi
- [x] Mobile pack staging — `scripts/pack-mobile.sh` stages BitBotHost + store metadata
- [ ] App Store / Play Store signed packaging (Apple/Play certificates still required)

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
- [x] `cmd/desktop_turn` — intents: chat / ListMachines / memory / host_effect / channel_delivery / connectors_status / claim_inbox / draft_mail / install_plugin / setup_slack (`v:1` JSON)
- [x] `scripts/smoke_desktop_turn.sh` — product-path smoke (not LocalBrain)
- [x] ADR 0002 Host FFI 回注 — Desktop executes effects then `--apply-host-results` → `continue_after_host_ffi` (MoonBit kernel absorbs TurnEvent)
- [x] `hosts/desktop/` Electron — agents + machines + turn transcript from MoonBit
- [x] `hosts/ios/` + `hosts/android/` native `BitBotHost` shells + `scripts/host_mobile_stub.sh`
- [x] `scripts/start-desktop.sh` — moon on PATH, npm, Electron under `hosts/desktop`
- [x] Shared Host FFI (`hosts/shared`) — shell / fs_list / fs_read / webfetch / channel_send (live Slack when token+BITBOT_SLACK_POST) / connectors_probe
- [x] Multi-end CLI Host (`hosts/cli_host/run_turn.js`) — same brain as Desktop with `--machine-kind ios|android|desktop`
- [x] TurnContext flags: `--session-id` `--machine-id` `--machine-kind` `--channel` on product JSON
- [x] Desktop pack script: `bash scripts/pack-desktop.sh` (electron-builder --dir)
- [x] CopyToBox / CopyFromBox product turns + Host real FS copy under repo
- [x] `mail_send` Host effect (Gmail API when OAuth token present; else journal sandbox)
- [x] ApprovalGate on shell / external send / mail (Host `--approved` after NeedUser)
- [x] Product turns: create_routine / mcp_discover / mcp_call / spawn_subagent / computer_use / teams_send / device_tools / load_skill / voice_start|relay|end
- [x] `hosts/mobile_host` — multi-end phone Host process (deviceLocalTools)
- [x] Native Host project trees: `hosts/ios/BitBotHost` (SwiftUI) + `hosts/android/BitBotHost` (Compose) sharing MoonBit brain
- [x] `scripts/pack-mobile.sh` — stages iOS/Android BitBotHost + store-packaging.json / SIGNING.md
- [ ] App Store / Play Store signed packaging (Apple/Play certificates / store submit still open)
- [x] Teammates: create_teammate / room_turn / send_to_agent on product path
- [x] Cloud / commerce / vertical: launch_cloud_agent / deliver_cloud_artifact / schedule_meeting / shop_retail / purchase_item
- [x] Vertical+connectors batch: travel_book / order_food / meeting_chat / finance_connect|call / fill_credential / cold_mail / personal_slack_dm / job_search
- [x] Skills+identity batch: learn_from_demo / make_slides / code_changes / source_control / send_on_behalf / list_workflows / identity_browser / x_search / author_skill / export_bot_template
- [x] CM-0705 product path: `device_permission` Host effect + phone machine_id resolve; mobile_host journals OS permission card (true-device dialog still residual)
- [x] Host MCP deepen: `mcp_discover`/`mcp_call` execute real stdio MCP (`host_h4_mcp_stdio.py`), not journal-only
- [x] Durable routines on Host: create/list/pause/resume/fire → `data/routines/host-routines.json`
- [x] Mail search/read product turns (`search_mail` / `read_mail_thread`) + Host `mail_search`/`mail_read`
- [x] Desktop Electron ApprovalGate UI (Approve & re-run with `--approved`) + effect chips
- [x] Host sandbox OAuth: `oauth` effect runs real IdP authorize→token for Slack/Gmail/Finance; Desktop Connectors panel
- [x] Host `computer_use` navigate: real HTTP public-page fetch + evidence under `data/journal/computer-use/`
- [x] Host `computer_use` box-chrome child process (`scripts/host_box_chrome_cu.py`): private CDP only, shared 9223/profile untouched; GUI residual remains true OS window automation
- [x] Host OAuth modes: default sandbox IdP; `BITBOT_OAUTH_MODE=live` applies real token or honest NeedsAuth (never pretend Connected)
- [x] Channel outbound durable store (`data/channels/outbound.jsonl`) for slack/teams/email; live Slack when token+BITBOT_SLACK_POST
- [x] Desktop device-permission card UI (CM-0705 Host card; true-device OS dialog still residual)
- [x] Mobile unsigned release archive + sha256 via `pack-mobile.sh` (store signing still open)
- [x] Journal / shared memory / inbound reaction product turns + durable Host stores (`events.jsonl` / `shared-scopes.json` / `inbound-reactions.jsonl`; CM-0302 / 0303 / 0110)
- [x] Host `skill_write` / `slides_pptx` / `export_pack` materialize real artifacts under `agent-tools/` (python-pptx PK zip; secrets stripped)
- [x] Host durable product delivery: device_permission/tool, voice session/relay/end, teammates/room/send_to_agent, subagent, approval queue, cloud launch/artifact, schedule/purchase/finance/credential/mail_draft (not journal-only)
- [x] Session-scoped Host memory: Desktop persists `data/memory/desktop-host.json` and reinjects via `--seed-memory` into MoonBit
