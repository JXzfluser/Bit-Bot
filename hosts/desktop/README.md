# Bit Bot Desktop host

Electron HostAbi surface for the **MoonBit** product brain (ADR 0005). Lives under `hosts/desktop/` as the Desktop end of the multi-end baseline (`MachineKind::Desktop`).

## What it does

- Opens a real window titled **Bit Bot Desktop** with agents sidebar + machines panel
- Boot IPC runs `moon run cmd/main --target native` and shows the kernel banner
- Chat IPC runs `moon run cmd/desktop_turn --target native -- "<text>"` and renders versioned turn JSON (`v:1`)
- Product Chat plans Host `llm_chat` (DeepSeek / `BITBOT_LLM_*`); Host executes OpenAI-compatible completions — **no LocalBrain**
- On boot, asks MoonBit `ListMachines` so Desktop / iOS / Android kinds appear in the machines panel
- Host FFI loop (ADR 0002): MoonBit plans `effects` → Desktop executes → `--apply-host-results` re-injects into MoonBit
- Product intents also cover channel delivery, connectors status, claim inbox, draft mail (not Python LocalBrain)

### LLM env (product brain)

```bash
export BITBOT_LLM_API_KEY=sk-...          # required
export BITBOT_LLM_BASE_URL=https://api.deepseek.com/v1   # default
export BITBOT_LLM_MODEL=deepseek-chat                    # default
# optional multi-model: BITBOT_LLM_PROVIDER=deepseek|qwen|moonshot
# catalog: data/llm/providers.json
```

Python `scripts/bitbot_runtime/` is **not** on this path. It remains optional Host FFI / legacy deploy only.

## Start

From repo root:

```bash
export PATH="$HOME/.moon/bin:$PATH"
bash scripts/start-desktop.sh
```

Or:

```bash
cd hosts/desktop && npm install && npm start
```

Headless / CI: `xvfb-run -a bash scripts/start-desktop.sh`.

## Targets

Default is `--target native`. For wasm:

```bash
BITBOT_MOON_TARGET=wasm bash scripts/start-desktop.sh
```

## Pack

`npm run pack` prints a note. Wire `electron-builder` / packager when you need installers.
