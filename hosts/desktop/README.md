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
# BITBOT_LLM_STREAM=0 to disable SSE streaming into the Desktop UI
```

### Desktop product shell (P1)

- **会话列表**：左侧「会话」+ 新建；持久化 `data/desktop/sessions.json`
- **流式**：Host `llm_chat` SSE → `bitbot:llm-stream` → 聊天气泡增量
- **托盘**：关闭窗口隐藏到托盘；托盘菜单显示/隐藏、新对话、退出
- **全局快捷键**：`Ctrl+Shift+Space`（macOS `⌘⇧Space`），可用 `BITBOT_DESKTOP_HOTKEY` 覆盖

### Resident / schedule (P3)

- **开机自启**：`app.setLoginItemSettings({ openAtLogin })`（默认开；`BITBOT_DESKTOP_AUTOSTART=0` 关）
- **定时守护**：启动时拉起 `scripts/host_routine_daemon.sh --long-lived`（`BITBOT_ROUTINE_DAEMON_AUTOSTART=0` 关）
- 可选 systemd user unit：`bash scripts/host_routine_daemon.sh --install-user-unit`
- IPC：`bitbot.autostart.*` / `bitbot.daemon.*`

### Release / OTA / 备案 (P4)

见 [`docs/desktop-release.md`](../../docs/desktop-release.md)。要点：

- `npm run dist` / `dist:mac` / `dist:win`；mac 公证走 `build/notarize.js`（缺 Apple 凭证不假装）
- OTA：`BITBOT_UPDATE_FEED_URL` → Host `check_updates` 真探测
- 内容审核：`BITBOT_CONTENT_MODERATION=1`；备案号：`BITBOT_ICP_FILING` / `BITBOT_ALGORITHM_FILING`

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
