# Real Host runtime — what is live vs residual

**Demoted / non-product.** Prefer Desktop + MoonBit: `bash scripts/start-desktop.sh` and ADR 0005.

Legacy Host FFI package: `scripts/bitbot_runtime/`.
Surface: Host UI on `http://127.0.0.1:8765/` (`scripts/host_ui_surface/`).
Optional deploy: `bash scripts/deploy_local.sh` (not the product brain).
Smoke: `bash scripts/smoke_real_chat.sh` (Shell, ListDir, memory set/get, WebFetch+summarize, connectors/status).

## Real on this box

| Surface | Behavior |
|---------|----------|
| Chat turn | `POST /api/host/chat` → `run_turn` → assistant reply + audit + journal entry |
| Shell / Read / Write / ListDir | Real subprocess + FS under `/workspace` or `/tmp/bitbot-sandbox` |
| WebFetch | Real HTTP(S) via urllib; no env credential injection |
| Fetch → summarize | LocalBrain multi-step: WebFetch then extractive summary (ZH/EN) |
| Persistence | Atomic JSON under `/workspace/data/{chats,memory,journal,routines,connectors,audit}` |
| Memory API | `POST /api/host/memory/recall` / `update` disk-backed; chat intents `记住我叫X` / `我叫什么` |
| Memory panel | Host UI optional snippet from `state.memorySnippet` after turns |
| Routines | LocalBrain list/create → `data/routines/<agent>.json` |
| Irreversible gate | Refuses `rm -rf /` and similar without running |
| LLM chain | `BITBOT_LLM_*` API → Ollama → **LocalBrain** (heuristic + real tools) |
| LLM badge | Host UI shows `llm=` mode on chat header + chat strip |
| Connectors status | `POST /api/host/connectors/status` → live vs sandbox per Slack/Gmail/Outlook |
| Slack | If `SLACK_BOT_TOKEN` set: live `auth.test` (+ draft-first post); live `chat.postMessage` when `BITBOT_SLACK_POST=1`; local mock via `BITBOT_SLACK_API_BASE` |
| Teams | Draft transcript by default; live Graph when `BITBOT_TEAMS_TOKEN`+`BITBOT_TEAMS_POST=1`; local mock via `BITBOT_TEAMS_GRAPH_URL` |
| Email connectors | If OAuth JSON in `data/connectors/gmail.json` or `outlook.json`: Connected |
| Box copy | `copy_to_box` / `copy_from_box` → FS under repo + durable `data/box-copy/*.json` + SendToUser attachment |

## Residual (honest gaps)

Product Host path is Desktop/CLI + MoonBit + `hosts/shared/host_ffi.js` (ADR 0005). Below are deferred product residuals (not matrix I blockers):

| Item | Status |
|------|--------|
| Phone OS permission card (CM-0705 true device) | **Deferred** (user) — Host card + native scaffolds exist; physical-device OS popup skipped |
| Production Slack/Gmail IdP credentials | **Deferred** (user) — sandbox / local_exchange / interactive_local / remote_callback rehearsals green; full production IdP consent skipped |
| Store signing certs (Desktop/iOS/Android) | **Deferred** (user) — signing scaffolds + unsigned pack evidence present; store certs skipped |
| Slack post without `BITBOT_SLACK_POST=1` | Draft-first only (live gated); live mock closes residual when API base + token + POST=1 |
| Slack inbound claim | `BITBOT_SLACK_CLAIM=1` + token → live `conversations.history` (`live_slack_claim`); without token → `sandbox_slack_claim`; mock serves history |
| Teams inbound claim | `BITBOT_TEAMS_CLAIM=1` + token → live Graph chat messages (`live_teams_claim`); without token → `sandbox_teams_claim` |
| Credential fill | Upserts `data/credentials/vault.json` metadata only; `list credentials` sees domain/username; never secret plaintext |
| Teams without `BITBOT_TEAMS_POST=1` | Draft transcript only; live Graph mock when token + POST + optional `BITBOT_TEAMS_GRAPH_URL` |
| Screenshot (CM-0605 product path) | `screenshot` Host effect: ffmpeg x11grab / import / gnome-screenshot / scrot when `DISPLAY` set; else `screenshot_residual=true`, never `pretend_live` / `pretend_frame` |
| Check Updates (CM-1906) | `check_updates` opens Updates tab (`update-channel`); artifact asserts `ne_update_computer` vs Computer tab `update-computer` |
| CreateAgent → Members (CM-1401) | `teammate_create` durable row + `appears_in_members` / `in_sidebar`; Members panel reads same store |
| Auto-review Settings (CM-1507) | `auto_review_settings` opens General deeplinks `auto-review` / `auto-review-rules` / `security-keys` (closed set) |
| box-chrome launcher (CM-0802) | `box_chrome_probe` prefers `/usr/local/bin/box-chrome`; refuses bare; private CDP; never uses shared 9223/profile |
| InstallPlugin namespace (CM-0904) | `mcp_namespace` marks Ready/usable in `data/connectors/mcp-namespaces/`; unknown plugin refused; never pretend_registered |
| Desktop Electron smoke turn | `BITBOT_DESKTOP_SMOKE_TURN=… npx electron .` writes `data/tmp/desktop-electron-turn.json` (MoonBit brain; local_brain=false) |
| Routine wake scheduler | On-demand `routine_fire` + daemon `--long-lived` / `--interval-ms`; `--install-user-unit` installs user systemd unit |
| CU paid checkout | `payment_wall` / `live_paid_residual` when pay form seen; local fixture via `BITBOT_CU_ALLOW_LOCAL=1`; never pretend_purchased without `BITBOT_CU_LIVE_PAID` |
| Purchase charge | Sandbox HTML receipt by default; live `/charge` when `BITBOT_PURCHASE_LIVE=1` + token + `BITBOT_PURCHASE_API_URL` |
| Remote Cursor Cloud | Default `local_worker`; remote probe when `BITBOT_CLOUD_API_URL`+token; live mock → `remote_cloud_api`; fail→local, never pretend remote |
| Meeting live transport | DirectSend transcript; live POST when `BITBOT_MEETING_API_URL`+token |
| OS-window CU input | Windowed Chrome+CDP primary; `BITBOT_CU_NATIVE_ACT=1` drives native click/type |
| Vision OCR | PIL hotspots; `BITBOT_CU_OCR=1` → tesseract closes `ocr_residual` |
| Source-control remote PR | `git status` always; `BITBOT_GH_CREATE_PR=1` → view or `gh pr create --dry-run`; real create needs `BITBOT_GH_PR_CREATE=1`; `BITBOT_GH_BIN` injects mock gh for Host fidelity smoke |
| Mail search/read | Durable `data/mail/search|threads` artifacts; live Gmail when token (+ optional `BITBOT_GMAIL_API_BASE`); never pretend_live |
| Mail send | Sandbox `.eml` draft by default; live Gmail/Outlook when token+`BITBOT_MAIL_SEND=1` (+ optional API base); never pretend_sent |
| Email channel | `email:`/`gmail:` → mail_send; live_email_gmail when SEND gated |
| Calendar | ICS always; live POST `/events` when `BITBOT_CALENDAR_API_URL`+token |
| MCP `$file:` | Host FFI expands `$file:` under repo before stdio MCP (CM-2163) |
| MCP write_to_file | `write_result` → `/workspace/agent-tools/`; returns path+sha; never inline PAYLOAD |
| Teammate sections | Durable `data/agents/sections/`; post isolation; unknown section refused |
| Credentials list | `list credentials` → metadata only under `data/credentials/`; never secret plaintext |
| Source-control PR plan | Always `data/source-control/pr-create-plan.json`; `real_create_gated` unless `BITBOT_GH_PR_CREATE=1` |
| Mobile SendToUser | `mobile_host` appends delivery strip from Host results (CHARTER Delivery) |
| Code changes | Plan artifact always; `BITBOT_CODE_APPLY=1` writes `.bitbot-applied.json` sidecar; never auto-commit |
| Workflow list | Host `data/workflows/catalog.json` (CM-2118) |
| X public search | Durable `data/connectors/x/`; live when `BITBOT_X_BEARER` (+ optional `BITBOT_X_API_BASE` mock); else sandbox_public |
| Job search | Durable `data/jobs/`; live catalog when `BITBOT_JOB_API_URL`+token; never pretend_applied |
| Legacy LocalBrain Host UI | Demoted — not product brain |

## Env vars

| Var | Role |
|-----|------|
| `BITBOT_LLM_BASE_URL` + `BITBOT_LLM_API_KEY` (+ `BITBOT_LLM_MODEL`) | OpenAI-compatible chat completions |
| `BITBOT_OLLAMA_URL` | Default `http://127.0.0.1:11434` |
| `BITBOT_OLLAMA_MODEL` | Default `llama3.2:1b` |
| `BITBOT_DATA_ROOT` | Default `/workspace/data` |
| `HOST_UI_PORT` | Default `8765` |
| `SLACK_BOT_TOKEN` | Live Slack adapter; **absent → sandbox_idp** |
| `BITBOT_SLACK_POST` | Set `1` to allow `chat.postMessage` |
| `BITBOT_SLACK_API_BASE` | Override Slack API root (local mock e.g. `http://127.0.0.1:18769`) |
| `BITBOT_TEAMS_TOKEN` | Bearer for Teams Graph live post |
| `BITBOT_TEAMS_POST` | Set `1` to allow Teams Graph post |
| `BITBOT_TEAMS_GRAPH_URL` | Override Graph root (local mock e.g. `http://127.0.0.1:18770`) |
| `BITBOT_JOB_API_URL` + `BITBOT_JOB_TOKEN` | Live job catalog POST `/jobs/search` |
| `BITBOT_X_BEARER` | Live X recent search bearer |
| `BITBOT_X_API_BASE` | Override X API root (local mock e.g. `http://127.0.0.1:18772`) |
| `BITBOT_GMAIL_TOKEN` | Bearer for Gmail live search/read/send |
| `BITBOT_GMAIL_API_BASE` | Override Gmail API root (local mock e.g. `http://127.0.0.1:18773`) |
| `BITBOT_MAIL_SEND` | Set `1` to allow live Gmail/Outlook send |
| `BITBOT_OUTLOOK_TOKEN` | Bearer for Outlook Graph live send |
| `BITBOT_OUTLOOK_GRAPH_URL` | Override Graph root (local mock e.g. `http://127.0.0.1:18775`) |
| `BITBOT_CALENDAR_API_URL` + `BITBOT_CALENDAR_TOKEN` | Live calendar POST `/events` |
| `BITBOT_CODE_APPLY` | Set `1` to write code-changes applied sidecar (still never auto-commits) |
| `BITBOT_GH_CREATE_PR` | Set `1` to allow `gh pr view` / `gh pr create --dry-run` |
| `BITBOT_GH_PR_CREATE` | Set `1` to allow real `gh pr create` (default remains dry-run / gated) |
| `BITBOT_GH_BIN` | Optional path to injectable `gh` (e.g. `scripts/host_gh_mock.sh` for smoke) |
| `SLACK_DEFAULT_CHANNEL` | Channel for optional Slack posts |

Absent Slack/Gmail/Outlook credentials are documented in `connectors_live.CONNECTOR_ENV_DOCS` and echoed by `/api/host/connectors/status`.

## Optional systemd note

Not required. For a long-lived unit, point `ExecStart` at `bash /workspace/scripts/start-bitbot.sh` (or `python3 …/host_server.py` after data dirs exist), with `Restart=on-failure` and the env vars above. Prefer `deploy_local.sh` on this machine.
