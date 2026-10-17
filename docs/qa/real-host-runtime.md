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
| Slack | If `SLACK_BOT_TOKEN` set: live `auth.test` (+ draft-first post) |
| Email connectors | If OAuth JSON in `data/connectors/gmail.json` or `outlook.json`: Connected |

## Residual (honest gaps)

Product Host path is Desktop/CLI + MoonBit + `hosts/shared/host_ffi.js` (ADR 0005). Below are deferred product residuals (not matrix I blockers):

| Item | Status |
|------|--------|
| Phone OS permission card (CM-0705 true device) | **Deferred** (user) — Host card + native scaffolds exist; physical-device OS popup skipped |
| Production Slack/Gmail IdP credentials | **Deferred** (user) — sandbox / local_exchange / interactive_local / remote_callback rehearsals green; full production IdP consent skipped |
| Store signing certs (Desktop/iOS/Android) | **Deferred** (user) — signing scaffolds + unsigned pack evidence present; store certs skipped |
| Slack post without `BITBOT_SLACK_POST=1` | Draft-first only (live gated) |
| Screenshot | Only when `DISPLAY` set and ffmpeg/import/scrot available |
| Routine wake scheduler | On-demand `routine_fire` + daemon `--long-lived` / `--interval-ms`; systemd unit scaffold under `data/routines/` — install to `/etc/systemd/system` still residual |
| CU paid checkout | `payment_wall` / `live_paid_residual` when pay form seen; never pretend_purchased without `BITBOT_CU_LIVE_PAID` |
| Purchase charge | Sandbox HTML receipt (`live_paid_residual`); live charge needs `BITBOT_PURCHASE_LIVE=1` + `BITBOT_PURCHASE_TOKEN` |
| Remote Cursor Cloud | Default `local_worker`; remote probe when `BITBOT_CLOUD_API_URL`+token; fail→local, never pretend remote |
| Meeting live transport | DirectSend transcript; live POST when `BITBOT_MEETING_API_URL`+token, else `live_meeting_residual` |
| OS-window CU input | Windowed Chrome+CDP primary; `xdotool`/`wmctrl` probe recorded; `os_window_automation_residual` until both usable |
| Vision OCR | PIL edge hotspots only; `ocr_residual=true` (no tesseract) |
| Source-control remote PR | `git status` always; remote PR only with `BITBOT_GH_CREATE_PR=1`+`gh`; else `remote_pr_residual` |
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
| `SLACK_DEFAULT_CHANNEL` | Channel for optional Slack posts |

Absent Slack/Gmail/Outlook credentials are documented in `connectors_live.CONNECTOR_ENV_DOCS` and echoed by `/api/host/connectors/status`.

## Optional systemd note

Not required. For a long-lived unit, point `ExecStart` at `bash /workspace/scripts/start-bitbot.sh` (or `python3 …/host_server.py` after data dirs exist), with `Restart=on-failure` and the env vars above. Prefer `deploy_local.sh` on this machine.
