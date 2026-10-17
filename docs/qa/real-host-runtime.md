# Real Host runtime — what is live vs residual

Product Host runtime package: `scripts/bitbot_runtime/`.
Surface: Host UI on `http://127.0.0.1:8765/` (`scripts/host_ui_surface/`).
Deploy: `bash scripts/deploy_local.sh`.

## Real on this box

| Surface | Behavior |
|---------|----------|
| Chat turn | `POST /api/host/chat` → `run_turn` → assistant reply + audit |
| Shell / Read / Write / ListDir | Real subprocess + FS under `/workspace` or `/tmp/bitbot-sandbox` |
| WebFetch | Real HTTP(S) via urllib; no env credential injection |
| Persistence | Atomic JSON under `/workspace/data/{chats,memory,journal,routines,connectors,audit}` |
| Memory API | `POST /api/host/memory/recall` / `update` disk-backed |
| Irreversible gate | Refuses `rm -rf /` and similar without running |
| LLM chain | `BITBOT_LLM_*` API → Ollama → **LocalBrain** (heuristic + real tools) |
| Slack | If `SLACK_BOT_TOKEN` set: live `auth.test` (+ draft-first post) |
| Email connectors | If OAuth JSON in `data/connectors/gmail.json` or `outlook.json`: Connected |

## Residual (not blocking matrix I)

| Item | Status |
|------|--------|
| Phone OS permission card (CM-0705 true device) | Still needs real phone OS |
| Production Gmail/Outlook OAuth without tokens on disk | Sandbox IdP path; Connected state stored locally |
| Slack post without `BITBOT_SLACK_POST=1` | Draft-first only |
| Screenshot | Only when `DISPLAY` set and import/scrot available |
| Large model quality | LocalBrain is tool-faithful, not a frontier LLM |

## Env vars

| Var | Role |
|-----|------|
| `BITBOT_LLM_BASE_URL` + `BITBOT_LLM_API_KEY` (+ `BITBOT_LLM_MODEL`) | OpenAI-compatible chat completions |
| `BITBOT_OLLAMA_URL` | Default `http://127.0.0.1:11434` |
| `BITBOT_OLLAMA_MODEL` | Default `llama3.2:1b` |
| `BITBOT_DATA_ROOT` | Default `/workspace/data` |
| `HOST_UI_PORT` | Default `8765` |
| `SLACK_BOT_TOKEN` | Live Slack adapter |
| `BITBOT_SLACK_POST` | Set `1` to allow `chat.postMessage` |

## Optional systemd note

Not required. For a long-lived unit, point `ExecStart` at `bash /workspace/scripts/start-bitbot.sh` (or `python3 …/host_server.py` after data dirs exist), with `Restart=on-failure` and the env vars above. Prefer `deploy_local.sh` on this machine.
