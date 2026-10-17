# Real Host runtime — what is live vs residual

Product Host runtime package: `scripts/bitbot_runtime/`.
Surface: Host UI on `http://127.0.0.1:8765/` (`scripts/host_ui_surface/`).
Deploy: `bash scripts/deploy_local.sh`.
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

| Item | Status |
|------|--------|
| Phone OS permission card (CM-0705 true device) | Still needs real phone OS; Host card is gate UI only |
| Production Gmail/Outlook OAuth without tokens on disk | Sandbox IdP path; Connected state stored locally; no browser OAuth dance in this runtime |
| Slack post without `BITBOT_SLACK_POST=1` | Draft-first only |
| Screenshot | Only when `DISPLAY` set and import/scrot available |
| Large model quality | LocalBrain is tool-faithful + extractive summary, not a frontier LLM |
| Routine *execution* | Disk list/create only; no cron / wake scheduler yet |
| Write path policy | Prefer `/workspace/data` and `/workspace/agent-tools`; other workspace paths still allowed by sandbox |
| API/Ollama tool JSON | Optional ```json tool blocks; primary tool path is LocalBrain intent parse |
| Multi-user auth | Host UI is local demo surface; no account login |

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
