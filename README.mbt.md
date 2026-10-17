# bitbot/bitbot

MoonBit runtime for Bit Bot (Grok Bot–class agent host). Full capability matrix: **234** CMs · **U-PASS=234** · **I-PASS=234** (Wave H6; CM-0705 platform-subset wording retained).

See [docs/scaffold-status.md](docs/scaffold-status.md), [docs/capability-matrix.md](docs/capability-matrix.md), and [docs/adr/0004-full-matrix-i-closure.md](docs/adr/0004-full-matrix-i-closure.md).

Product Host runtime (real chat + tools + disk persist): [docs/qa/real-host-runtime.md](docs/qa/real-host-runtime.md).

## Deploy (this machine)

```bash
bash scripts/deploy_local.sh
# Host UI: http://127.0.0.1:8765/
# Health:  http://127.0.0.1:8765/api/host/health
```

Or start without the smoke curl:

```bash
export PATH="$HOME/.moon/bin:$PATH"
bash scripts/start-bitbot.sh
```

Smoke one real tool turn:

```bash
curl -s -X POST http://127.0.0.1:8765/api/host/chat \
  -H 'Content-Type: application/json' \
  -d '{"agent_id":"demo-agent","text":"用 Shell 执行 echo bitbot-live 并告诉我结果"}'
ls /workspace/data/chats/
```

### LLM mode (Host owns the model)

| Priority | Condition | Mode |
|----------|-----------|------|
| 1 | `BITBOT_LLM_BASE_URL` + `BITBOT_LLM_API_KEY` (+ optional `BITBOT_LLM_MODEL`) | `api` (OpenAI-compatible) |
| 2 | Ollama at `BITBOT_OLLAMA_URL` (default `http://127.0.0.1:11434`) | `ollama` |
| 3 | else | `localbrain` (heuristic agent; still runs **real** Shell/Read/Write/ListDir/WebFetch) |

Other useful env: `BITBOT_DATA_ROOT` (default `/workspace/data`), `HOST_UI_PORT` (default `8765`), `SLACK_BOT_TOKEN`, `BITBOT_SLACK_POST=1`.

Kernel boot only:

```bash
moon run cmd/main
```

## Check / test

```bash
export PATH="$HOME/.moon/bin:$PATH"
moon check
moon test   # expect 347+ passed
```

## Host smokes / H6 matrix I sweep

```bash
# Prior Host-hard inventory (H0–H5)
bash scripts/host_h0_smoke.sh all
bash scripts/host_h5_smoke.sh media

# Wave H6 — remaining matrix I=todo → READY_FOR_I_REVIEW artifacts
bash scripts/host_matrix_i_sweep.sh all
# Fast re-artifact (skip moon test):
H6_FAST=1 bash scripts/host_matrix_i_sweep.sh all
```

Artifacts: `docs/qa/artifacts/h6-matrix-i/SUMMARY.json`
