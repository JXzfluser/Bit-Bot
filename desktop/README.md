# Bit Bot Desktop

Electron host for the **MoonBit** product brain (ADR 0005).

## What it does

- Opens a real window titled **Bit Bot Desktop**
- Boot IPC runs `moon run cmd/main --target native` and shows the kernel banner
- Chat IPC runs `moon run cmd/desktop_turn --target native -- "<text>"` and shows the JSON turn result

Python `scripts/bitbot_runtime/` is **not** on this path. It remains optional Host FFI / legacy deploy only.

## Start

From repo root:

```bash
export PATH="$HOME/.moon/bin:$PATH"
bash scripts/start-desktop.sh
```

Or:

```bash
cd desktop && npm install && npm start
```

Headless / CI: `xvfb-run -a bash scripts/start-desktop.sh`.

## Targets

Default is `--target native` (already builds in this repo). For wasm:

```bash
BITBOT_MOON_TARGET=wasm bash scripts/start-desktop.sh
```

## Pack

`npm run pack` prints a note. Wire `electron-builder` / packager when you need installers.
