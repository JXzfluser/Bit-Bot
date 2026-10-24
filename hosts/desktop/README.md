# Bit Bot Desktop host

Electron HostAbi surface for the **MoonBit** product brain (ADR 0005). Lives under `hosts/desktop/` as the Desktop end of the multi-end baseline (`MachineKind::Desktop`).

**本阶段 Desktop-first**：iOS / Android 暂缓；验收只盯真 Desktop 窗口 + 真模型 + 真国内渠道。

## What it does

- Opens a real window titled **Bit Bot Desktop** with agents sidebar + machines panel
- Boot IPC runs `moon run cmd/main --target native` and shows the kernel banner
- Chat IPC runs `moon run cmd/desktop_turn --target native -- "<text>"` and renders versioned turn JSON (`v:1`)
- Product Chat plans Host `llm_chat` (DeepSeek / `BITBOT_LLM_*`); Host executes OpenAI-compatible completions — **no LocalBrain**
- On boot, asks MoonBit `ListMachines` so Desktop / iOS / Android kinds appear in the machines panel
- Host FFI loop (ADR 0002): MoonBit plans `effects` → Desktop executes → `--apply-host-results` re-injects into MoonBit
- Product intents also cover channel delivery, connectors status, claim inbox, draft mail (not Python LocalBrain)

### LLM env (product brain)

Prefer **Settings → 产品凭证**：写入 `hosts/desktop/.env.local` 并热加载（`bitbot:secrets:set`），然后点「试连大脑」。

```bash
export BITBOT_LLM_API_KEY=sk-...          # required for 真模型
export BITBOT_LLM_BASE_URL=https://api.deepseek.com/v1   # default
export BITBOT_LLM_MODEL=deepseek-chat                    # default
# optional multi-model: BITBOT_LLM_PROVIDER=deepseek|qwen|moonshot
# catalog: data/llm/providers.json
# BITBOT_LLM_STREAM=0 to disable SSE streaming into the Desktop UI
```

### Inbound turn auth (ADR 0008)

CN / mobile `POST /v1/turn` requires `Authorization: Bearer $BITBOT_TURN_TOKEN`. The listener defaults to `127.0.0.1:18765`. Set `BITBOT_BIND_LAN=1` only when a phone on the LAN should connect, and put the same token in the phone's 凭证. DingTalk / Feishu / WeCom callbacks are rejected with 401 until their signing secrets are set (`BITBOT_DINGTALK_APP_SECRET`, `BITBOT_FEISHU_ENCRYPT_KEY`, `BITBOT_WECOM_CALLBACK_TOKEN`).

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

### Grok Bot 产品对等（Wave G · 分支 `cursor/grok-bot-parity-desktop-v2`）

规格：`docs/grok-desktop-parity/`（spec.md / ipc-contract.md / gaps.md）。真功能而非 UI 外壳——每条走 kernel intent → Host effect → `data/desktop/*.json` 落盘：

- **`product_surface.js`（Host 数据层）**：bots / approval-rules / pending-approvals（~10min 过期，过期仍可 always-allow/deny，allow-once 拒绝）/ approvals.log（deny 回执）/ settings（appearance·language·timezone·local_execution 三档·route_traffic·notify·unread·sidebar_collapsed）/ computer（screens + takeover begin/end）/ llm-usage / rooms（群聊 2–6 Bot + transcript ≤200）。原子写 tmp+rename。
- **审批三按钮**：Allow once（`--approved` 续跑）/ Always allow（落 `<kind>:*` 规则，下次 `auto_approved via=approval_rule` 真执行）/ Deny（pending 决定 + `approvals.log.jsonl` 回执，不静默）。ask-first 优先于 allow；GP-36 never 时卡直接拒绝（`host_approval_card_refused`）且无执行。
- **群聊路由**：`room <id> :: @BotName …` → mentioned_only；`@everyone` → all；无 @ → bot_discretion；审批/secret 永不进群（`escalations:"dm-only"`）。
- **Take over / I'm done / Recover**：接管 banner 提示"密码/验证码/2FA 请在本机输入，不要贴进对话"；Recover 仅错误态出现。
- **草稿卡**：New Email / New Slack Message 可编辑，Send 才真发（approved 回合），Discard 零出站。
- **快捷键**：`Cmd/Ctrl+B` 折叠侧边栏（持久）、`Cmd/Ctrl+N` 新对话（原生菜单 + renderer 双通道）。
- **通知**：聚焦抑制、侧边栏未读、`setBadgeCount`、点击通知跳会话。
- **验收**：`bash scripts/smoke_grok_desktop_parity.sh`（25 项，逐 kind 断言 store 真实变化）+ `BITBOT_DESKTOP_SMOKE_TURN="create bot Piper job=scout description=Watch+the+market" ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a npm start`（退出码 0，bots.json 出现 Piper）。注意自由文本 `+` 编码约定（spec/contract §3）。

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

```bash
cd hosts/desktop
npm run pack          # --dir 未打包目录（CI/Linux 常用）
npm run dist:linux    # AppImage + dir
npm run dist:mac      # dmg/zip（需 Apple 凭证公证）
npm run dist:win      # nsis
```

详见 [`docs/desktop-release.md`](../../docs/desktop-release.md)。
