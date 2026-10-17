# bitbot/bitbot

**Product = MoonBit kernel + Desktop host** (ADR 0005). Capability matrix: **234** CMs · **U-PASS=234** · **I-PASS=234** (Wave H6; CM-0705 platform-subset wording retained).

See [docs/scaffold-status.md](docs/scaffold-status.md), [docs/capability-matrix.md](docs/capability-matrix.md), [docs/adr/0005-course-correct-moonbit-desktop.md](docs/adr/0005-course-correct-moonbit-desktop.md).

## Start Desktop (primary)

```bash
export PATH="$HOME/.moon/bin:$PATH"
bash scripts/start-desktop.sh
# Window title: Bit Bot Desktop
# Boot → moon run cmd/main --target native
# Chat → moon run cmd/desktop_turn --target native -- "<text>"
```

One MoonBit turn without the window:

```bash
moon run cmd/desktop_turn --target native -- "hello from desktop"
```

Default target is **native**. Wasm alternative: `BITBOT_MOON_TARGET=wasm` (or `moon run … --target wasm`).

Kernel boot only:

```bash
moon run cmd/main --target native
```

## Check / test

```bash
export PATH="$HOME/.moon/bin:$PATH"
moon check
moon test   # expect 347+ passed
```

## Python Host (optional / secondary)

`scripts/bitbot_runtime/` + `:8765` Host UI remain available for Host FFI / local deploy experiments. They are **not** the product brain; Desktop + MoonBit is. Prefer `bash scripts/start-desktop.sh` for the product path.

```bash
bash scripts/deploy_local.sh   # optional: http://127.0.0.1:8765/
bash scripts/start-bitbot.sh   # optional: same stack without smoke curl
```

Docs: [docs/qa/real-host-runtime.md](docs/qa/real-host-runtime.md).

### LLM mode (Host FFI only; Host owns the model)

| Priority | Condition | Mode |
|----------|-----------|------|
| 1 | `BITBOT_LLM_BASE_URL` + `BITBOT_LLM_API_KEY` (+ optional `BITBOT_LLM_MODEL`) | `api` (OpenAI-compatible) |
| 2 | Ollama at `BITBOT_OLLAMA_URL` (default `http://127.0.0.1:11434`) | `ollama` |
| 3 | else | `localbrain` (heuristic; deprecated as product brain) |

Other useful env for that stack: `BITBOT_DATA_ROOT` (default `/workspace/data`), `HOST_UI_PORT` (default `8765`).

## Host smokes / H6 matrix I sweep

```bash
bash scripts/host_h0_smoke.sh all
bash scripts/host_h5_smoke.sh media
bash scripts/host_matrix_i_sweep.sh all
H6_FAST=1 bash scripts/host_matrix_i_sweep.sh all
```

Artifacts: `docs/qa/artifacts/h6-matrix-i/SUMMARY.json`
