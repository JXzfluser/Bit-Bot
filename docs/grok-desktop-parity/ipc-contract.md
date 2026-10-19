# Grok Parity Wave G — 跨层接口契约（single source of truth）

> 参与者：kernel(`cmd/desktop_turn/*.mbt`,`security/*`) ↔ host(`hosts/shared/host_ffi.js`) ↔ desktop(`hosts/desktop/main.js|preload.js|index.html`)。
> 回合通道不变：renderer `runUserTurn(text)` → IPC `bitbot:turn` → `runner.runTurn` → `moon run cmd/desktop_turn` JSON `v:1` → effects → `ffi.executeHostEffects` → `--apply-host-results` 回注。
> 本波新增 **product effect kinds** 与 **IPC channels** 全部列在这里；未列出的不得改名。

## 1. 短语 → kernel intent → effect kind → host tool

command 一律 `key=value` 空格分隔；**最后一个字段值可为自由文本到行尾**。kernel 生成时值内空格用 `+` 编码（host 解析后还原，见 §2）。

| 短语（kernel 识别，小写前缀） | TurnIntent 变体 | effect kind | command | host tool |
|---|---|---|---|---|
| `create bot <name> job=<job> description=<text>` | `CreateBot(name~,job~,description~)` | `bot_create` | `name=Piper job=Perf description=free+text` | `host_bot_create` |
| `update bot <id> name=<n> job=<j> description=<d> avatar=<p>` | `UpdateBot(bot_id~,name~,job~,description~,avatar~)` | `bot_update` | `bot=<id> name=... avatar=... description=...` | `host_bot_update` |
| `duplicate bot <id>` | `DuplicateBot(bot_id~)` | `bot_duplicate` | `bot=<id>` | `host_bot_duplicate` |
| `pin bot <id>` / `unpin bot <id>` | `PinBot(bot_id~, pinned~)` | `bot_pin` | `bot=<id> pinned=1` | `host_bot_pin` |
| `set primary bot <id>` | `PrimaryBot(bot_id~)` | `bot_set_primary` | `bot=<id>` | `host_bot_set_primary` |
| `hide agent <id>` / `unhide agent <id>`（已有→改接新 store） | `HideAgent` | `hide_agent` | 现格式不变 | `host_hide_agent`（改为写 bots store） |
| `delete agent <id>`（已有→补级联） | `DeleteAgent` | `delete_agent` | 现格式不变 | `host_delete_agent`（级联 sessions+routines，保留 workspace 文件） |
| `take over reason=<r>` / `need takeover` | `TakeOver(reason~)` | `take_over` | `reason=password` | `host_take_over` |
| `i'm done` / `hand back control` | `TakeoverDone` | `takeover_done` | `ok=1` | `host_takeover_done` |
| `recover computer` | `RecoverComputer` | `recover_computer` | `confirm=recover` | `host_recover_computer` |
| `always allow pattern=<p>` | `ApprovalRule(pattern~, decision~)` | `approval_rule` | `pattern=shell:* decision=allow` | `host_approval_rule` |
| `ask first pattern=<p>` | 同上 | `approval_rule` | `pattern=... decision=ask` | 同上 |
| `dark mode` / `light mode` / `system theme` | `AppearanceSet(mode~)` | `appearance_set` | `mode=dark` | `host_appearance_set` |
| `set language zh-CN` / `set language en` | `LanguageSet(code~)` | `language_set` | `code=zh-CN` | `host_language_set` |
| `set timezone Asia/Shanghai` | `TimezoneSet(tz~)` | `timezone_set` | `tz=Asia/Shanghai` | `host_timezone_set` |
| `local execution ask` / `always` / `never` | `LocalExecutionMode(mode~)` | `local_execution_mode` | `mode=ask` | `host_local_execution_mode` |
| `create group chat bots=<a,b> title=<t>` | `GroupChat(bots_csv~, title~)` | `group_chat` | `bots=a,b title=Ops+room` | `host_group_chat` |
| `room <id> message <text>`（含 `@Name` / `@everyone` 原样保留） | `RoomTurn`（已有，扩展） | `room_turn` | 现有格式 + `mention=<name|everyone>` | `host_room_turn`（路由见 §3.4） |

kernel 对每个新 kind 走 `deliver_ok(..., needs_host_ffi=true)`；host 回填经 `continue_after_host_ffi`。

## 2. Host 持久化 store（全部 JSON，原子写 tmp+rename，mode 0600 若含敏感）

根：`<repo>/data/desktop/`

- `bots.json` → `{version:1, primary_id:"agent-bit", bots:[{id,name,job,description,avatar,hidden,pinned,created_at,updated_at}]}`；内置 `agent-bit`（name=Bit Bot）永不删除。id 规则 `bot-` + 6hex；`agent-bit` 保持固定 id。
- `approval-rules.json` → `{version:1, rules:[{pattern,decision:"allow|ask",source:"personal|team",created_at}]}`；team 条目 `locked:true` 不可删（GP-73）。
- `pending-approvals.jsonl` → 行 `{id,source:"chat|routine|teammate",kind,command,requested_at,expires_at(后台+10min),status:"pending|decided|expired",decision,decided_at}`。
- `approvals.log.jsonl` → 决策审计（每次 allow_once/always/deny 追加）。
- `settings.json` → `{version:1, appearance:"system|light|dark", language:"zh-CN|en|...", timezone, local_execution:"ask|always|never", route_traffic:false, unread:{<bot_id>:N}}`。
- `computer.json` → `{version:1, state:"ready|error|recovering", last_update_at, last_reset_at, last_recover_at, screens:{<bot_id>:{task,status,frame_path,updated_at}}, takeover:{active,bot_id,reason,started_at,ended_at}}`。
- `llm-usage.json` → `{version:1, week:"YYYY-Www", rows:[{at,provider,model,prompt_tokens,completion_tokens,requests}]}`（llm_chat 成功后累计；无数据时 UI 显示空态，不造假 0）。
- 值编码：kernel 生成的 command 中自由文本用 `+` 代替空格；host 解析 `description=`/`title=` 取到行尾并 `+`→空格。

Host 判定顺序（GP-22）：`ask` 规则命中 → 需审批；否则 `allow` 规则命中 → 直放；否则默认策略（chat 内由 kernel ApprovalGate；后台源由 host pending 队列）。

## 3. 需要真实副作用的 host tool 行为

3.1 `host_bot_create/update/duplicate/pin/set_primary`：写 `bots.json`；duplicate 生成 `<name> copy`，仅复制 name/job/description/avatar 配置，**不带** messages/memory；set_primary 更新 `primary_id`。返回 JSON 含 `bots` 全量主列表（hidden 剔除）+ `hidden_bots` + `primary_id`，`mode:"host_bot_*"`，`pretend_saved:false`。

3.2 `host_delete_agent`：确认后删 bots 条目 + `data/desktop/sessions.json` 中该 Bot 会话 + `data/routines` 中该 Bot routine 文件；**必须保留** box workspace 文件并在结果里给 `workspace_files_kept:number`。未带 `confirm=yes` 时返回 `{ok:false, needs_confirm:true, advise_hide_first:true}`。

3.3 `host_take_over` / `host_takeover_done`：take_over → `computer.json` takeover.active=true，抓一帧真截屏（复用现有 screenshot 链，DISPLAY 可用时）写入 `data/desktop/frames/`，结果含 `frame_path, guidance:"密码/验证码请在本机输入，不要贴进对话"`；done → active=false + 结束帧 + `handback_at`。无 DISPLAY 时 `mode:"takeover_sandbox"`、`frame_path:null`、`residual:"no DISPLAY"`，不假装有帧。

3.4 `host_group_chat`：校验 2–6 成员（bots.json 中真实 id/名）→ 建 `data/desktop/rooms.json` 条目 `{id,title,members:[bot_id...],created_at}`；`host_room_turn` 路由：`mention=<bot名>`→仅该成员；`mention=everyone`→全部成员；无 mention→**全部成员各自可响应，但审批/Secret 卡只进对应 Bot 私聊，不进群 transcript**（GP-53：room_turn 返回 `escalations:"dm-only"`，并从群 transcript 剔除）。

3.5 `host_approval_rule`：upsert 规则；pattern 语法 `kind:*`、`kind:prefix*`、精确 command 前缀。命中 allow 时 `executeHostEffects` 对 gated kinds（`shell, channel_send, mail_send, purchase_item, computer_use 写操作, mcp_call`）免弹卡直放。

3.6 `host_recover_computer`：仅当 `computer.json.state=="error"` 或 `?force=1`（错误卡按钮）可用；从快照恢复、保留 `/workspace`（box 目录）与 connectors 登录态文件；Settings 短语入口返回 `{ok:false, error:"recover only from error state", advise:"update_computer"}`（GP-35）。

3.7 `host_appearance_set/language_set/timezone_set/local_execution_mode`：写 `settings.json`；timezone 同时使 `host_routine_*` 下次计算用新 IANA 区（通过 env `BITBOT_TZ` 注入 daemon）；local_execution_mode 改变 `shell`/本地文件 kind 的执行前判定：never→直接拒绝 `{ok:false, refused:"local_execution_never"}`；ask→无 pre-approved 时返回 needs_approval；always→直放。

3.8 `host_render_markdown` / 附件：新增 IPC-only host 函数（非 kernel kind）`stageAttachments(paths[], limits)`：≤6 个、文档/图片/音频 ≤25MB、视频 ≤200MB；复制进 `data/workspace/uploads/<sess>/`，返回真实绝对路径数组；违规返回 `too_many_attachments` / `too_large:<name>`（GP-11）。

## 4. Electron IPC 新增（main.js handle + preload 同名暴露）

| channel | 参数 | 返回 | 说明 |
|---|---|---|---|
| `bitbot:bots:list` | – | bots.json 视图 | 侧边栏数据源（渲染层优先用 turn 结果，此 IPC 兜底/刷新） |
| `bitbot:settings:get/set` | patch{} | settings.json | main 应用 `nativeTheme.themeSource`（light/dark/system）与语言（app badge/菜单文案 zh/en）立即生效 |
| `bitbot:attachments:pick` | – | `{ok,paths[],residual?}` | `dialog.showOpenDialog` + §3.8 限额校验 + 落 `data/workspace/uploads/`；renderer 把返回路径注入下一条消息 |
| `bitbot:skills:list` | – | skills 目录 | `/` 自动完成数据源（复用 `list_skills` host 逻辑） |
| `bitbot:approvals:rule` | `{pattern,decision}` | rule | Always allow 用 |
| `bitbot:approvals:listPending` | – | pending+expired | 后台审批队列视图 |
| `bitbot:computer:frame` | `{bot_id?}` | `{frame_path,data_url,residual}` | Computer 面板帧轮询（复用 `bitbot:readArtifact` 媒体通道） |
| `bitbot:computer:takeover` | `{action:"begin|end",bot_id,reason}` | takeover 状态 | Take over / I'm done 按钮直连 |
| `bitbot:usage:week` | – | llm-usage.json | Usage & Billing 真实数据 |
| `bitbot:voice:ingest` | `{wav_b64, session}` | `{ok, wav_path, transcript?, residual}` | 真录音落盘 `data/desktop/voice/`；无 STT 时 `transcript:null, residual:"no_stt"`（诚实，不伪造转写） |
| `bitbot:notify:turn` | `{title, body, session_id, bot_id}` | – | 聚焦抑制 + 每 Bot 开关（settings.notify[bot]）+ click→`bitbot:focus-session` |
| `bitbot:badge:set` | `n:int` | – | `app.setBadgeCount`（Linux/mac）；renderer 未读变化时调用 |
| `bitbot:sessions:rename/delete` | id(,title) | store 回执 | 会话重命名/删除 |
| `bitbot:sidebar:toggle` | – | – | Cmd/Ctrl+B 也由 accelerator 触发 |

已存在不动：`bitbot:turn / boot / sessions:* / llm* / secrets:* / cn* / ota / autostart / daemon / readArtifact / openArtifact / product:status`。

## 5. 验收（脚本层）

- `scripts/smoke_grok_desktop_parity.sh`（新增）：逐 kind `moon run cmd/desktop_turn` 断言 intent + effects.kind；再 `hosts/cli_host/run_turn.js` 实跑断言 host_results.ok 且 store 文件真的变化（bots/rules/settings/computer/usage），并断言 deny/expired/never/refused 路径不产生副作用。
- `moon test` 增量：新 intent 的单测（phrase→intent→effect kind→name()）放入 `cmd/desktop_turn/desktop_turn_wbtest.mbt`；`security` 规则判定顺序单测。
- Electron 冒烟：`BITBOT_DESKTOP_SMOKE_TURN="create bot Piper job=scout description=Watch+the+market" xvfb-run npm start` 退出码 0 且 `bots.json` 出现 Piper。
