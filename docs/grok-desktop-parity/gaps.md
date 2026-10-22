# Grok Bot 桌面端对等 — 现状差距审计（Wave G 验收后）

> 口径：**已实现 = 有可证伪验收信号且本轮实测通过**；**残留 = 行为真实存在但依赖本沙箱不可达的外部条件（按诚实残留纪律标注，不 pretend）**；**未做 = 本波范围内尚未接线，如实列出**。
> 验收证据（M43 最新）：`scripts/smoke_grok_desktop_parity.sh` **PASS=302 FAIL=0**。新增 `prove_m43_settings.js` 8/0（#settings-tabs 分段控件容器 inline-flex + #f4f4f5 + 999px；tab 按钮透明无边框、active 白底浮起 pill；移除 HTML inline style 覆盖；#settings-sheet 头部 sticky + 分隔线；标题升至 --text-lg；M42/M20 回归护栏 + 负向对照）。M33–M42 契约保持。详见 Wave M43。
> 验收证据（M42）：`scripts/smoke_grok_desktop_parity.sh` **PASS=296 FAIL=0**。新增 `prove_m42_stream.js` 7/0（#log 单列居中 max-width 820 + margin auto，修 user 贴右视口 / assistant 止于 760 的左右不对称；user 气泡保留 18px（M20）+ 右下 6px 尾角；assistant 卡片 bot-bubble + 左上 8px 尾角；连续 assistant 行隐藏重复头像 + margin-top 收紧；M20 用户胶囊正则回归护栏）。M33–M41 契约保持。详见 Wave M42。
> 验收证据（M41）：`scripts/smoke_grok_desktop_parity.sh` **PASS=289 FAIL=0**。新增 `prove_m41_cn.js` 7/0（收尾中英混排：channels-meta `workflows ·`→`工作流 ·`、box-meta `env ·`→`运行环境 ·`、webhook `copied`→`已复制`、delivery `last:`→`最近：`、cloud-meta 内部枚举 `local_worker`→`本地代理` 不外泄；ADR 0002 / ICS 等技术引用按扫描规则保留）。M33–M40 契约保持。详见 Wave M41。
> 验收证据（M40）：`scripts/smoke_grok_desktop_parity.sh` **PASS=283 FAIL=0**。新增 `prove_m40_a11y.js` 8/0（`:focus{outline:none}` + `:focus-visible` 2px accent 键盘焦点环；`@media (prefers-reduced-motion: reduce)` 全局压平 transition/animation，并归零 composer / sess-row / msg-actions 的 transform；M39 淡入契约回归检查）。M33–M39 契约保持。详见 Wave M40。
> 验收证据（M39）：`scripts/smoke_grok_desktop_parity.sh` **PASS=277 FAIL=0**。新增 `prove_m39_micro.js` 10/0（`.msg-actions` 淡入用 opacity + pointer-events 而非 display 硬切；按钮 `:active scale(0.96)`；`sess-row:hover translateX(1px)` + `:active scale(0.995)`；composer send/attach/voice `:active scale(0.94)`；M38 契约不破）。M33–M38 契约保持。详见 Wave M39。
> 验收证据（M38）：`scripts/smoke_grok_desktop_parity.sh` **PASS=269 FAIL=0**。新增 `prove_m38_copy.js` 8/0（消息悬浮 Copy 按钮 + clipboard/execCommand 双通道、pill 工具条 + backdrop-filter、welcome .w-brand 渐变、三语 copy* 齐备、含负向对照）。M33 / M34 / M35 / M36 / M37 契约保持。详见 Wave M38。
> 验收证据（M37）：`scripts/smoke_grok_desktop_parity.sh` **PASS=263 FAIL=0**。新增 `prove_m37_layout.js` 13/0（全局 `[hidden] { display: none !important }` 兜底；`#account-popup` 改 `position: fixed` + `z-index: 45`；`setAccountPopup(open)` 单一真源同步 `hidden` 与 `aria-expanded`；Escape 关闭；侧栏 280px；M37 batch 1/2 CN/EN 清扫覆盖 gpQueueNote / autoReview / accountSection / accountLabelPlaceholder / aria New chat / settings-tab map / composer placeholder）。M33 / M34 / M35 / M36 契约保持。详见 Wave M37。
> 验收证据（M36）：`scripts/smoke_grok_desktop_parity.sh` **PASS=252 FAIL=0**。新增 `prove_m36_voicehotkey.js` 5/0（Cmd/Ctrl+D 语音绑定与 🎙 按钮共用 startVoiceInput 单一入口，含 typeof guard 与负向对照）。M33 / M34 / M35 契约保持。详见 Wave M36。
> 验收证据（M35）：`scripts/smoke_grok_desktop_parity.sh` **PASS=247 FAIL=0**。新增 `prove_m35_hotkeys.js` 6/0（Cmd/Ctrl+K 搜索 + Cmd/Ctrl+/ 快捷键面板，DOM 建、三语齐、复用 bb-modal / bb-sheet、含负向对照）。M33 / M34 契约保持。详见 Wave M35。
> 验收证据（M34）：`scripts/smoke_grok_desktop_parity.sh` **PASS=241 FAIL=0**。新增 `prove_m34_account_actions.js` 5/0（账户弹层入口落地：三项走 open settings anchor、三项走中文占位 callout、handler 都收 popup；含负向对照）；`prove_m33_grokchrome.js` 8/0（新增 Composer 圆形 ↑ 发送按钮断言）；其余 M33 契约保持。详见 Wave M34。
> 验收证据（M33）：`scripts/smoke_grok_desktop_parity.sh` **PASS=234 FAIL=0**。新增 `prove_m33_grokchrome.js` 7/0（侧栏图标工具栏、账户弹层、送达状态、typing indicator、CN/EN 分离、语言下拉原生名、负向对照）；`prove_m20_ui.js` 24/0（sidebar 宽度契约更新为 280px 以匹配 Grok 视觉密度）；`prove_m24_window.js` 29/0。`e2e_grok_desktop_boot.mjs` 124/0；`prove_m23_memory.js` 26/0；`prove_m26_botpanel.js` 27/0；其余探针与 M32 一致。内核未改。详见 Wave M33。
> 验收证据（M32）：干净 store（`bots.json` 已存在但没有 `agent-bit` 行、`data/workspace` 空、`desktop-host.json` 不存在）上 `scripts/smoke_grok_desktop_parity.sh` **PASS=230 FAIL=0**。`e2e_grok_desktop_boot.mjs` 124/0；`prove_m20_ui.js` 24/0；`prove_m23_memory.js` 26/0；`prove_m24_window.js` 29/0；`prove_m26_botpanel.js` 27/0。内核未改。详见 Wave M32。
> 验收证据（M31 行为基线）：`scripts/smoke_grok_desktop_parity.sh` PASS=229 FAIL=0；`moon test` 381/381（M26–M31 未改内核）；`scripts/prove_m31_reactions.js` 17/0；`scripts/prove_m30_attachpreview.js` 10/0；`scripts/prove_m29_roomchat.js` 16/0；`scripts/prove_m28_usage.js` 14/0；`scripts/prove_m27_convrail.js` 19/0；`scripts/prove_m26_botpanel.js` 27/0；`scripts/prove_m25_profile.js` 25/0；`scripts/prove_m24_window.js` 29/0；`scripts/prove_m23_memory.js` 26/0；`scripts/prove_m22_readfirst.js` 25/0；`scripts/prove_m21_trust.js` 45/0；`scripts/prove_m20_ui.js` 21/0；`scripts/prove_gp96_progress.js` 30/0；`scripts/prove_gp93_links.js` 21/0；`scripts/prove_gp14_reply.js` 16/0；`scripts/e2e_grok_desktop_boot.mjs` 124/0；Electron 冒烟 `BITBOT_DESKTOP_SMOKE_TURN="create bot Piper job=scout description=Watch+the+market" xvfb-run npm start` 退出码 0 且 `bots.json` 出现 Piper；renderer 冷启动（xvfb + ELECTRON_ENABLE_LOGGING）console 无 JS 错误。
> 基线：`cursor/grok-bot-parity-desktop-v2`，kernel Wave G 提交 `3f49b4b` + Host/Desktop 对等提交。

## 逐条状态

| ID | 状态 | 说明 |
|----|------|------|
| GP-01 | 已实现 | create bot → `bot_create` → `bots.json` 落盘（smoke G-1）；renderer 侧边栏 + Cmd/Ctrl+N 新建。 |
| GP-02 | 已实现 | 模板目录 store 化 `data/desktop/bot-templates.json`（Host 首读种入官方六模板）；空状态一键创建 + 创建对话框 chips 同源；未知模板诚实拒绝。见 Wave M10。 |
| GP-03 | 已实现 | update bot name/job/description 持久（smoke G-1）；头像无效路径由既有 CM-0202 门拒绝。 |
| GP-04 | 已实现 | pin 持久（smoke G-1）；renderer 置顶区排序读取 store。 |
| GP-05 | 已实现 | duplicate → `Smoke copy` 持久（smoke G-1）；不复制对话历史（store 语义仅配置）。 |
| GP-06 | 已实现 | hide/unhide 走 store-backed `bot_hide/bot_unhide`（bots.json 仅置 hidden 标志）；Hidden Bots 恢复入口在 renderer。**行为级**断言：隐藏 Bot 的 routine 在 daemon sweep 与 `tick routines` 短语两条路径下均真实触发（fires.jsonl `fired:true, pretend_fired:false` + last_fired_at 推进），隐藏不暂停 Routines 不再只是行存活。见 Wave M11。 |
| GP-07 | 已实现 | delete 级联（bots/DM sessions/routines/rooms 成员）+ 共享 Computer 文件保留计数；agent-bit 拒删；未确认 → `needs_confirm + advise_hide_first`（拒绝负载含 bot_id）。聊天侧发起 `delete bot X` 现在同样弹出 hide-first 确认框（取消/改为隐藏/确认删除），不再只有侧栏菜单路径。断言进 smoke G-1b + G-12。 |
| GP-08 | 已实现 | set primary 持久（smoke G-1）。X 入站模拟路由沿用既有 CN inbound 测试。 |
| GP-10/12/13 | 已实现 | Composer 多行/`/`技能/`@`提及已有；GP-13 群内 `@BotName` 路由本轮实测（smoke G-6）。 |
| GP-11 | 已实现 | 附件三入口（选择/粘贴/拖拽）共用同一校验器 `stageAttachments(paths, session, existingCount)`：单次 ≤6 按「本次+已暂存」累计口径、文档/图片/音频 ≤25MB、视频 ≤200MB，拒绝负载带 `kind/bytes/max_bytes/already_staged` 供本地化文案；无真实磁盘路径 → `no_real_path` 诚实拒绝（CM-0106 不伪造）。kernel 侧新 `AttachFiles` 意图，一条意图 = 每路径一个 `copy_to_box` effect，dest 为仓库内 workspace 上传目录 `data/workspace/uploads/<basename>`（spec「仓库 /workspace 语义目录」的真实可执行形式；此前写成绝对 `/workspace/...` 会被 Host `resolveUnderRepo` 拒，整串多路径塞一条命令更是直接失败）。见 Wave M16（smoke G-17 十一断言 + E2E）。 |
| GP-14 | 已实现 | Reply 回复特定消息 + React：会话 store 每条消息有持久 id（`sessions.js` `newMessageId`，旧行一次性 backfill），renderer hover 出「回复」→ composer 上方引用条 → 发送时**被回复消息 id** 经 `--reply-to` 进 kernel 上下文（`DesktopTurnContext.reply_to`，turn JSON 回显）；Host 用 `sessions.findMessage(id)` 把 id 解析成原文并注入真实 provider 请求体，`data/llm/turns/*.json` artifact 记 `reply_to/reply_quote_source`。未知 id → `message_not_found` + `unresolved`（不静默吞、不假装引用成功）；引用随会话行持久化，切会话重载仍在。React 走既有 `react_message` pill 链。见 Wave M17（smoke G-18 + E2E GP-14 十断言）。 |
| GP-15 | 已实现 | 语音输入：🎙 recording 态（红圈）→ MediaRecorder → `bitbot.voice.ingest` 真实落盘 `data/desktop/voice/*.wav`；无 STT 时诚实提示补文字（不伪造转写）。getUserMedia 链已用 `--use-fake-device-for-media-stream` CDP 实测（录音→存盘回执截图）。 |
| GP-20 | 已实现 | 审批卡结构化：操作/参数/目标 kv 行 + secret 提示；不可映射类别隐藏 Always。 |
| GP-21 | 已实现 | 三按钮全链实测：基线弹卡→always allow 规则落盘→同 pattern 自动执行（`yes:approval_rule`）；Deny 走 pending 匹配 + `approvals.log.jsonl` 回执。 |
| GP-22 | 已实现 | ask-first 优先实测（smoke G-3：allow+ask 冲突不自动）。规则持久在 `approval-rules.json`。 |
| GP-23 | 已实现 | 过期语义实测：expired 后 allow_once 拒绝（`approval_expired`）、always/deny 仍可（smoke G-3）。 |
| GP-24 | 已实现 | 五类门经 `waveGApprovalCardGate`/`waveGApprovalGate`；Destructive 不可 always-allow（映射为 null，UI 隐藏按钮）。 |
| GP-25 | 已实现 | secret 提示 + 掩码 store 沿用 `.env.local` 0600 既有验收。 |
| GP-30 | 已实现 | 每 Bot screen 状态在 `computer.json screens` 呈现（takeover/preview/screenshot/CU 全链路写入）；**同 Bot computer-use 并发拒绝**：Host 文件锁 `data/desktop/cu-locks/<bot>.json`（TTL 120s，崩溃不死锁），第二任务 `busy+refused+pretend_ran:false` 并说明占用任务，不同 Bot 并行。断言进 smoke G-13，实测见 Wave M12。 |
| GP-31 | 已实现 | Grok 式右侧 Computer 预览 rail（`#computer-rail`，3s 帧轮询 + 活动流 + per-Bot chips）；`open computer` → `computer_preview` effect 只读截帧、不暂停后台；screens 落盘断言进 smoke G-4（PASS=41）。沙箱 DISPLAY 真帧已由 Xvfb 截屏验证（preview-*.png 非空且入面板渲染）。 |
| GP-32/33/34 | 已实现 | `take over` → `takeover.active=true`、`i'm done` → false+handback 实测（smoke G-4）；banner 文案含"密码/验证码/2FA 请在本机输入，不要贴进对话"。 |
| GP-35 | 已实现 | recover 仅错误态：非 error 时被拒且不假装恢复（smoke G-4 grep）。update/reset 沿用 CM-1903/1904。 |
| GP-36 | 已实现 | 三档实测：never → `host_approval_card_refused` 不执行；always → `via=local_execution_always` 自动；ask 弹卡。**本轮修复**：kernel 把裸 `local execution never|always`（Grok 设置页原语）误路由为 legacy on/off（`never` 反而=启用 machine use），已在 `parity_intents.mbt` 修正并加 4 条内核测试断言。 |
| GP-99..102 | 已实现 | §8.3 安全密钥输入：对话流真 `<input type=password>` 卡（显示/隐藏、Enter 提交、Cancel），提交只走 `bitbot:secrets:submit`（不经 composer / `bitbot:turn`）；Host vault AES-256-GCM 落盘（`data/secrets/`，0600），只回 `handle + ****last4`，`status()` 恒 `value:null`；气泡恰为 `[REDACTED]` 并以 `secret_handle` 持久化，重载仍在；composer 粘贴密钥被拦截，kernel 同样 `fail_turn` 且被拒回合的 user 行也脱敏；全 `data/` grep 无明文。见 Wave M21（prove 45/0 + E2E 10 断言）。 |
| GP-103..105 | 已实现 | §8.4 Untrusted Content：内核 `fence_body` 给外部 kind（webfetch/mcp/shell/CU/video…）输出加 `source` fence，未闭合 fence 改为 fail-closed；`hosts/shared/untrusted_fence.js` 与内核同一 grammar（幂等、转义伪造闭合标签）；Fenced slice 不出 ExternalSend，伪造「Auto-review」仍 `IgnoreAsData`；renderer 出 `data-untrusted="1"` 角标并显示真实来源，去标签后仍走 GP-93 唯一安全渲染路径。 |
| GP-106/107 | 已实现（诚实三态） | §8.5 Privacy Mode 只读：`privacy_status` 返回 `managed_by:account / local_toggle_supported:false`，preload 无 setter；无账户信号 → `unavailable` + `training_use=disabled_by_default`，legacy → `unsupported`，仅在 `privacy_verified` 真实信号下才 `on/disabled_verified`。**残留**：本地无 provider 签发信号，真实运行恒为 unavailable。 |
| GP-108 | 已实现 | §6.4 先读后执行：`fire routine r` 默认**只准备**——Host 写 `data/routines/drafts/routine-*.json`（prompt / prepared_at / `requires_approval:true` / 5 类 `approval_boundary` / `default_action:"draft"`），fire 记录 `mode:host_routine_draft`、`executed:false`、`pretend_executed:false`；`execute=1` 才执行且写入 `executed_at` + `execute_via`（command / routine_config / env）。renderer 在对话流渲染草稿卡（prompt + 边界 + Execute/Discard），`routine_tick` 的 `fired[]` 同样逐个出卡。见 Wave M22。 |
| GP-109 | 已实现 | 未 approved 的 `fire routine r execute=1` **停在内核审批门**（`ExternalSend`，`approval_card`，Host 零执行记录）；approved 回合才产出 `mode:host_routine_fire_executed`。草稿卡的 Execute = 一次 `approved:true` + `execute=1` 回合；面板 “Fire routine” 按钮不再带 approved（准备 ≠ 执行）。`execute_via=command` 让审计能回答「为什么跑了」。 |
| GP-110 | 已实现 | 只读不打扰：`list routines / list connectors / list skills / list credentials` 未 approved 下 `ok:true` 且 effects 与 host_results 均为零 `approval_card`；写入类（purchase / draft mail / execute）必停在审批卡，且实测无小票、无 `mail_send`、无 `routine_fire` host 结果。 |
| GP-111 | 已实现 | §4.2 跨会话记忆：`data/memory/desktop-host.json` 升为 `{version:2, bots:{<id>:{entries:[…]}}}`，每回合按 Bot 取 seeds 以 `--seed-memory` 注入内核（`run_moon_turn.js` → `memorySeedArgs(botId)`），`memory update k=v` 走 `memory_update` 写 `profile-vault.json` 分槽 + 回写 store 分槽；旧扁平数组/对象首读自动迁移到 `agent-bit` 槽（不丢用户数据）。同一 Bot 换 session 仍 recall 得到同一条偏好。见 Wave M23。 |
| GP-112 | 已实现 | 记忆隔离按 Bot：`loadSessionMemory/saveSessionMemory(botId)`、`readProfileVault/ensureVaultBotSlot`、`dropBotMemory/dropBotProfileVault` 全部以 Bot 为键；内核 `--bot-id` → `DesktopTurnContext.bot_id`（回复文本标注 `bot=<id>`），归属经 Host 的 `ffiOpts.botId` 路由（effect 命令仍是 `key\|value`，不把 Bot id 塞进命令语法）；worker 回合（cloud / voice / teammate / subagent）同样带 Bot 槽。另一 Bot 的 recall 命中 0 条。 |
| GP-113 | 已实现 | 共享可传递：`shared memory put/read` 仍走 `data/memory/shared-scopes.json`（scope 维度、不按 Bot 分），A 写的 scope 键 B 可读；`data/workspace/**` 无 Bot 目录；群聊 transcript 属房间。 |
| GP-114 | 已实现 | 删除不连坐：`botsDelete` 级联 sessions/routines/rooms 后调用 `dropBotMemorySlot(bot_id)`，**只**删该 Bot 在 `desktop-host.json` 与 `profile-vault.json` 的槽（回执 `memory_dropped`），其它 Bot 槽与 `workspace_files_kept` 保留。 |
| GP-115 | 已实现 | 记忆不授权动作：内核 `memory_grants_send()` 恒 `false`（记忆只做上下文），审批/草稿仍由 `gate_consequential` 决定；实测在 Bot 记忆里写 `send=allow all` 后 `purchase` / `channel_send` 仍只出 `approval_card`，无真实 host 执行。 |
| GP-116 | 已实现 | §2.1 主窗口结构：侧栏六类入口齐全且顺序固定 —— `#bot-list`（Bot）→ `#room-list`（群组，读 `rooms.json`）→ `#session-list`（会话）→ `#sidebar-footer`（Hidden Bots / Connect apps / Marketplace / Settings）。群组列表由新增 `refreshSidebarRooms()` 渲染（行带 `data-room-id` + 成员数，点击把该群设进群组面板并提示消息入口），随 boot、`group_chat/room_turn` 回合与群组面板刷新同步。Marketplace 打开 `#marketplace-modal`，卡片来自 `window.bitbot.templates.list()`（Host `bot_templates_list` 读 `data/desktop/bot-templates.json`），一键创建走 `templates.create` → `bot_create_from_template` 真建 Bot；渲染层**没有**写死的模板数组。新增文案 zh-CN/zh-TW/en 三语齐全。见 Wave M24。 |
| GP-117 | 已实现 | Bot 列表按**真实活动**排序：`listViews()` 先 `pinned` 后 `updated_at` 降序；`product_surface.touchBotActivity(bot_id)` 在 `bitbot:turn` 成功落盘后由 main 调用（未知 id 返回 `bot_not_found` 且不造行），随后广播 `bitbot:bots-changed` → preload `onBotsChanged` → renderer 重排侧栏，无需手动刷新。见 Wave M24。 |
| GP-118 | 已实现 | 隐藏 Bot 入口位于侧栏**底部**：`#agents` 是**一整列滚动容器**（`overflow-y:auto`），三个列表保持自然高度（不再各自开滚动条），`#sess-new` `position:sticky; top:0` 常驻列首、`#sidebar-footer`（Hidden Bots / Connect apps / Marketplace / Settings）`position:sticky; bottom:0` 常驻列尾，DOM 上确为 `#agents` 最后一个块；E2E 实测长列表下 `#agents` 自身 `scrollHeight > clientHeight` 且 footer/新对话按钮仍在可视矩形内。隐藏数量徽标仍由 `bots.list()` 的 `hidden` 长度驱动。见 Wave M24/M25。 |
| GP-119 | 已实现 | 中央 `#log` 是**唯一**消息流：群聊回合走同一条 `runUserTurn("room …")` 落在 `#log`，不另开窗口；右侧 `#machines`（工具）与 `#computer-rail`（Computer 预览）各自被 `body.tools-open` / `body.computer-open` 独立开合，打开 Computer 后中央宽度仍 > 200px（实测 340px 右栏下 `#log` 475px）。见 Wave M24。 |
| GP-120 | 已实现 | §2.2 **Edit Profile**：侧栏 Bot 行右键 →「Edit Profile」打开 `#bot-edit-modal`（名称/标签/职责/多行描述/头像）。内核 `UpdateBot` 新增可选 `tags~`，为空时**不产出** `tags=` 字段（Host 视为"保持"），`tags=-`/`avatar=-` 是显式清空；Host `botsUpdate` 用 `normalizeTags` 归一化（≤8 条）并把头像路径转 `avatar_data_url`（≤512KB，mime 由扩展名推断），`listViews()` 里 Bot 行同时带 `tags` 与 `avatar_data_url`。侧栏 Bot 行与左下 Bot 胶囊渲染真实 `<img>`，`meta` 追加 `· #tag` chips。Host 拒绝（如 `invalid_avatar`）现在经 `host_payload.ok:false` 让 `bots.op` 返回失败，不再"绿着返回却没保存"。见 Wave M25。 |
| GP-121 | 已实现 | §2.3 **创建流程**：`#bot-new-btn` / `Cmd/Ctrl+N` 打开同一表单的创建态（隐藏标签行与头像列，显示模板 chips）；Name 留空 → Host `botsCreate` 落 `New Bot`（官方占位名）；Description 用 textarea 且 `enc()` 只替换空格，换行原样保留；创建成功后读 `host_payload.bot` 调 `selectBotForChat()` **自动打开该 Bot 的对话**。见 Wave M25。 |
| GP-122 | 已实现 | §4.5 **头像上传**：main 新增 `bitbot:bots:pickAvatar`（`dialog.showOpenDialog` 限图片，`statSync` 拦 >2MB → `avatar_too_large`，成功返回 `{path,data_url}`），preload 暴露 `bots.pickAvatar()`；对话框内预览 + 可清空（`avatar=-`）。E2E 走同一 IPC 写真实路径后 `refreshBots()`，侧栏渲染 `<img>`；坏路径由 Host 拒且旧头像保留。系统选择框本身按残留记（无桌面环境不可自动化）。见 Wave M25。 |
| GP-123 | 已实现 | 侧栏会话组织补齐官方形态：`sessDayBucket()` 按本地零点分 **今天 / 昨天 / 更早**（`.sess-group` 标题），`#session-search` 按标题+预览实时过滤并在无命中时给空态；行双击 → `#session-rename-modal`（`sessions.rename`），右键 → 重命名/删除，删除走 `#session-delete-modal`（点名会话、明示不可恢复）→ `sessions.delete`，之后重选 active 并重载 transcript。全程走既有 Host IPC，渲染层不直接写 `sessions.json`。见 Wave M25。 |
| GP-124 | 已实现 | §2.1 可选右栏（Bot 设置）：`#bot-rail` 与 Computer 预览共用同一可选列，打开一个即收起另一个（M27 起升级三方互斥）；面板字段全部来自真实 store。见 Wave M26。 |
| GP-125 | 已实现 | Bot 设置面板字段逐项来自 bots.json / 记忆槽 / 会话 / rooms / `settings.notify`，未知 id → `bot_not_found` 不造行。见 Wave M26。 |
| GP-126 | 已实现 | 每 Bot 通知开关合并写 `settings.notify`，关掉后回合通知真实被抑制（`notify:turn` 返回 `shown:false, reason=bot_notify_off`）。见 Wave M26。 |
| GP-127 | 已实现 | 面板动作与 Bot 菜单同源（编辑/置顶/副本/隐藏/删除复用既有流）；删除确认后右栏自动关闭。见 Wave M26。 |
| GP-128 | 已实现 | §2.1 对话详情右栏：`#conv-rail`（三方互斥同一可选列），标题/归属/创建/更新/消息数/回复数/最近一条逐项来自真实 sessions.json，中央消息流不被挤 0。见 Wave M27。 |
| GP-129 | 已实现 | 详情面板内重命名真写 sessions.json 且面板标题随动；删除会话后面板自动关闭且行消失。见 Wave M27。 |
| GP-130 | 已实现 | §7.1 每次真实模型调用计入用量：`executeLlmChat` 双路径提取 provider usage（流式最终 chunk / 非流式顶层），emit `phase:"usage"` → main.js 写 `recordUsage` → `llm-usage.json` 按周按 provider/model 累加；未上报时 requests 真记、tokens 不伪造。见 Wave M28。 |
| GP-131 | 已实现 | Usage & Billing 面板 per-provider/model 明细行 + 周合计，读真 store；空态不造 0；未上报 tokens 的行如实标注。见 Wave M28。 |
| GP-132 | 已实现 | §5.1 附件发送前预览：chip 预览真实字节——图片缩略图来自磁盘（data-URL base64）、非图片 kind+体积徽标、缺失/空路径诚实拒绝。见 Wave M30。 |
| GP-133 | 已实现 | §5.1 消息反应 (React)：hover 反应按钮 + 6 emoji picker（👍❤️😂🎉😮😢），chips 从 store 行渲染，点击 chip 走同一 IPC 撤销；transcript 重载把 reactions 传给 addMsg；IPC `bitbot:sessions:react` + preload `sessions.react` 全链暴露；sessions store `react(sessionId, messageId, emoji, on)` 单一事实源。见 Wave M31。 |
| GP-37 | 残留 | `route_traffic` 开关持久 + UI 显示真实生效状态；真代理生效不可达 → renderer 显示 honest residual 文案。 |
| GP-40/41 | 已实现 | 草稿卡（New Email / New Slack Message）可编辑，Send→真实 approved 回合再编码；Discard→不落出站。仅当卡类别为 ExternalSend 时渲染（不从任意文本臆造草稿）。 |
| GP-42 | 已实现 | kernel 判定未变（CM-0306），UI 不代客批准。 |
| GP-50 | 已实现 | 2 成员建立 / 1 成员拒绝 `members_2_to_6` 实测（smoke G-6）；名称可改持久（rename 走 rooms store）。 |
| GP-51 | 已实现 | `@BotName`→mentioned_only、`@everyone`→all、无@→bot_discretion 实测（smoke G-6，transcript 落 rooms.json）。 |
| GP-52 | 已实现 | `send_to_agent` 沿用 CM-14xx；本轮补齐 Bot→Bot 任务所有权转移：`handoff room <id|title> [from=<bot>] to=<bot> task=<text>` → `handoff_task` 意图 → Host 写群 transcript（回执含 to_bot/responders，规格信号"转交可见于 transcript"）+ 任务投递承接 Bot inbox；非成员/未知群诚实拒绝（`pretend_transferred:false`，不写 transcript）。smoke G-14 十断言。 |
| GP-53 | 已实现 | `escalations:"dm-only"` 实测出现在 room_turn 结果；审批卡只进 pending 队列/私聊，不进 transcript。 |
| GP-60/61 | 已实现 | GP-60 Voice chat：composer 为空才可发起（非空/有附件禁用按钮，实测）→ 通话栏（脉冲+计时+监听文案+转述框）+ 侧边栏"语音对话进行中"→ 挂断后对话留 Voice chat 卡（真实麦克风录音优先，含时长）。GP-61 memo 卡：播放/暂停 + 转写展开（relay user_text 回填）。kernel→host 链断言进 smoke G-7（PASS=46）。 |
| GP-70 | 已实现 | appearance dark 持久实测 + boot 时 `applyAppearance` 读取持久值（smoke G-5）；M15 补像素断言：Playwright-E2E 走真实 `settings.set → nativeTheme + broadcast → renderer` 链，零依赖 PNG 解码算 viewport 亮度（dark 38.8 / light 238.0 / Δ>120，重启再 boot 仍暗），smoke G-16。诚实残留：Xvfb 下 `themeSource` 不驱动 live `prefers-color-scheme` media query（boot 探测同现），暗色像素由 force-dark token 通道承担，OS live 通道需在带 DE 的机器复核。 |
| GP-71 | 已实现 | language 持久 + renderer `wavegLangApply` 关键文案切换（zh-CN/zh-TW/en）。 |
| GP-72 | 已实现 | timezone 持久 + `process.env.BITBOT_TZ` + 守护进程重启（smoke G-5）。 |
| GP-73 | 已实现 | 规则 CRUD 持久、团队规则 locked 行不可删（`rule_locked`）。 |
| GP-74 | 已实现 | Account 面板 + `whoami / sign in <label> / sign out / switch account <label>` 全链：本地 profile store（data/desktop/account-profile.json）+ 真实凭证来源清单（env 与 .env.local 双查，llm/slack/gmail/outlook/dingtalk/feishu/wecom）。未登录明确 "not signed in"，登录态附 backed_by；未知 profile `account_not_found + known[]` 拒绝（`pretend_switched:false`）。smoke G-15 六断言。 |
| GP-75 | 已实现 | 见 GP-35/37。 |
| GP-76 | 已实现 | `usage.week` 读取 `llm-usage.json` 真实统计；无数据渲染空态而非 0 假数（smoke 未断 UI，store 层实测）。 |
| GP-77 | 已实现 | `ota:check` 真实网络探测不变；新增安装态持久化（main boot 写 data/desktop/app-install.json，ota:check 各分支写 ota-state.json）→ `update_status` 意图读真实 version/packaged/residual（未打包 `residual:true, pretend_up_to_date:false`），Updates tab 打开即显示「安装版本 v0.1.0 · 开发运行（未打包）· … · 应用更新不会重置 Computer 文件」；smoke 用 computer.json marker 断言 check_updates/update_status 链全程未改写 Computer 状态。 |
| GP-80/81/82 | 已实现 | 聚焦抑制（BrowserWindow focus 态）+ 侧边栏未读 + `setBadgeCount` + 点击通知激活 session（`wireFocusSession`）；系统 Notification 在 xvfb 无通知总线环境下不弹出属平台限制，逻辑分支以 store/badge 状态实测。 |
| GP-90/91/92 | 已实现 | readArtifact 文本族（md/txt/json/csv/ics/eml/yaml + ≤64KB 无 NUL 探测）文件卡；saveArtifact IPC 真拷贝（headless 覆盖）；GP-92 全屏查看器（图/视频/音频/文本，Esc/遮罩关闭）。见 Wave M9。 |
| GP-93/94/95 | 已实现 | Markdown/链接纪律（官方 §5.6）三层落地：政策与渲染共用同一份 `hosts/desktop/link_discipline.js`（renderer `<script src>` 载为 `window.__bitbotLinks`，main `require` 同文件，无第二份实现）；正文经 `applyLinkBodyTo()` 只产 text node + `a.msg-link`，全仓无 `.body` innerHTML；点击 `preventDefault` → `bitbot:links:open` → scheme 门（仅 http/https）→ `shell.openExternal` → `data/desktop/links.jsonl` 审计行（拦截也留痕）；`setWindowOpenHandler` 一律 deny、`will-navigate` 拦截后同路；hover 出主机名+完整 URL 预览卡且零副作用。见 Wave M18（smoke G-19 六断言 + E2E 十四断言）。Xvfb 下真实浏览器启动抑制为 record-only（opened:false + 原因），属诚实残留。 |
| GP-96/97/98 | 已实现 | 进度更新（官方 §5.7）：`host_ffi.executeHostEffects` 在每个 effect 边界发 `start/done` 事件（`results.push` 拦截 + `closeDangling` 兜底），`total` 等于真实 effect 数；`hosts/shared/turn_progress.js` 把事件经 `ctx.onProgress` 交上层（Electron main `broadcast("bitbot:turn-progress")` → renderer `#turn-progress` 实时行；CLI `run_turn` 落 stderr）；`hosts/desktop/progress_protocol.js` 纯协议层（renderer `<script src>` 载为 `window.__bitbotProgress`，main `require` 同文件）定义 7 类 category + kind→category 映射 + reducer；renderer 10 个 prog* i18n 键 ×3 语言；慢 provider 下首个进度事件 42ms 可见（回合 862ms 才结束）；done 事件的 path 只在文件确实存在时才带。见 Wave M19（`scripts/prove_gp96_progress.js` 30 断言）。 |
| GP-A1 | 已实现 | Cmd/Ctrl+B 折叠（renderer accelerator + 主菜单 + `sidebar_collapsed` 持久）；Cmd/Ctrl+N 新对话（菜单模板 broadcast `bitbot:menu-new-chat`）。 |
| GP-A2/A3 | 已实现 | Connect apps 面板（侧栏按钮 + Cmd/Ctrl+Shift+M）：浏览/添加/卸载、Your plugins 管理、全局生效说明、OAuth 提示；单工具启用/禁用走 `TogglePluginTool` → `mcp_tool_toggle` → `mcp-tools-catalog.json` 持久化（未知工具诚实拒绝）。见 Wave M8。 |

## 已知坑与纪律（本波实测结论）

1. **key=value `+` 编码**：kernel `extract_kv` 在已知 key 词处截断且不解码 `+`；renderer 自由文本进 phrase 前必须 `encodeURIComponent` 再把 `%20→+`（`encodeURIComponentVal`），否则 `description=Watch+the+market` 会截吞。bot name、room title、规则 pattern 都吃这条。
2. **审批卡词法**：`"<Class> :: <summary> :: <reason>"`；规则匹配串 = summary 去掉 `"<kind>: "` 标签前缀（`cardRuleCommand`），pattern 词汇 = `kind:*` / `kind:prefix*` / exact。`Always allow` 持久化 `entry.kind + ":*"`。
3. **kernel 先于 Host 弹卡**：chat 流的 consequential shell 由内核 `gate_consequential` 先出 approval_card，Host 对 `shell` kind 的门只在 `runAllowed` 重放/非卡路径生效——两层门并存，验收分别覆盖。
4. **拒绝不静默**：never/refused 路径 renderer 显示固定诚实文案（"被你的设置直接拒绝，未执行"），host_results 无执行条目；deny 回执写 `approvals.log.jsonl`（`executed:false`）。
5. **测试残留卫生**：`data/desktop/*.json*` 全部 gitignore；脚本运行前后必须清 bots/rooms/rules/settings，避免跨 run 污染。
6. **回归脚本环境依赖**：`smoke_grok_parity_scenario.sh` 的 voice 段隐式要求 TTS 二进制（espeak mock 或 ffmpeg sine），无 ffmpeg 的纯沙箱会在 `voice_relay` 断言处红——这是脚本级环境耦合，不是 Host 行为回归（`mode` 字符串由 `replyMedia.tool` 决定，属既有设计）。本波未改该脚本，运行它时注入 `BITBOT_ESPEAK_BIN` 即可。

## 未做清单（后续波次）

- ~~GP-02 `bot-templates.json` store 化 + 模板一键创建的脚本断言~~（M10 已实现，smoke G-11 五断言）。
- ~~GP-06/GP-07 隐藏不暂停 Routines、删除二次确认的自动化断言~~（M11 已实现，smoke G-12 八断言 + 聊天侧确认框接线）。
- ~~GP-30 同 Bot computer-use 并发拒绝的桌面端专项断言~~（M12 已实现：文件锁 + 拒绝路径 + smoke G-13 七断言）。
- ~~GP-15/GP-60 真麦克风链路~~（M6 已用 `--use-fake-device-for-media-stream` 实测 getUserMedia→MediaRecorder→落盘全链）。
- ~~GP-52 群内所有权转移 transcript 断言~~（M13 已实现：kernel `handoff_task` 意图 + Host transcript 写入 + inbox 投递 + smoke G-14 十断言）。
- ~~GP-70 nativeTheme 像素级断言~~（M15 已实现：`scripts/lib_png_pixel.mjs` + `scripts/e2e_grok_desktop_boot.mjs`，smoke G-16；Xvfb live media-query 通道按残留纪律如实标注）。
- ~~GP-14 Reply 定向消息的 kernel 侧 id 传递断言~~（M17 已实现：`--reply-to` → `DesktopTurnContext.reply_to` → turn JSON 回显 → Host 解析注入 provider 请求体；`scripts/prove_gp14_reply.js` 16 断言 + E2E 真实点击「回复」十断言 + smoke G-18）。
- ~~GP-90/92 预览格式扩展与全屏验收~~（M9 已实现文本族文件卡 + saveArtifact + 全屏查看器，CDP 实测）。
- ~~GP-93/94/95 官方 §5.6 Markdown/链接纪律（可点击 + 系统浏览器 + 悬停不自动导航）~~（M18 已实现：`link_discipline.js` 政策/渲染同源 + `link_open.js` scheme 门与审计 + IPC 与窗口守卫；`scripts/prove_gp93_links.js` 21 断言 + E2E 十四断言 + smoke G-19。仓库 spec.md 此前无对应行，本轮先补 G-13 行再实现）。
- ~~GP-96/97/98 官方 §5.7 进度更新（实时显示 Bot 工作进度 + 长时间任务中间更新）~~（M19 已实现：`host_ffi.executeHostEffects` 在每个 effect 边界发 `start/done` 事件，`total` 等于真实 effect 数；`hosts/shared/turn_progress.js` 把事件经 `ctx.onProgress` 交上层（Electron main `broadcast("bitbot:turn-progress")` → renderer `#turn-progress` 实时行；CLI `run_turn` 落 stderr）；`hosts/desktop/progress_protocol.js` 纯协议层（renderer `<script src>` 载为 `window.__bitbotProgress`，main `require` 同文件）定义 7 类 category + kind→category 映射 + reducer；renderer 10 个 prog* i18n 键 ×3 语言；慢 provider 下首个进度事件 42ms 可见（回合 862ms 才结束）；done 事件的 path 只在文件确实存在时才带。`scripts/prove_gp96_progress.js` 30 断言）。
- ~~renderer E2E（Playwright for Electron）以替掉手工冷启动检查~~（M15 已实现：`scripts/e2e_grok_desktop_boot.mjs` 用 playwright-core `_electron.launch` 自动冷启动 + 断言 + 截图，替掉人工启动肉眼检查；`hosts/desktop/shot_cdp.mjs` 保留为交互调试工具。历史：本轮真机截图曾暴露并修复 3 个问题——body 网格 `min-height:100vh` 推出 composer、never 拒绝按钮条挂起 + "unknown host error"、@非成员静默回退 all）。

## Wave G-M（UI 外壳 / i18n / 消息渲染重构，本轮）

对标 Grok Bot 官方文档（`/app/grokspec/grok-bot-spec.md` §2.1 侧栏顺序、§7.3 外观、§7.4 语言）后的实测结论：

1. **主题 token 化**：所有颜色走 `:root` CSS 变量；`@media (prefers-color-scheme: light)` + `body.force-dark/force-light` 双通道。Electron `nativeTheme.themeSource` 仍是系统态真值（GP-70），renderer 侧 `wavegApplyAppearanceClass()` 负责强制态，两者在 `refreshWaveGSettings` 统一驱动。配色为中性黑白（官方未公开具体色值 → 不声称像素一致）。
2. **侧栏顺序**：New chat → Bots → Connect apps → Hidden Bots → Chats → 高级 → Settings（底部入口），对齐官方文档确认的 Grok 结构。
3. **i18n 全覆盖**：`WAVEG_I18N` 三字典（zh-CN/zh-TW/en）~110 键；静态标签走 `data-i18n` / `data-i18n-ph`，动态写入点（模型条、会话 meta、审批标题、用量行、welcome、cfg-strip）全部经 `wavegT()`。语言选 `Follow System` 时按 `navigator.language` 解析。切语言即时重渲染 model picker / sessions / bots。
4. **内核回复本地化**：内核协议层输出保持英文（语言中立），renderer 用 `WAVEG_REPLY_MAP` + `wavegLocalizeReply()` 把已知回复句式翻译进当前 UI 语言；未知句式原样透传（诚实，不吞消息）。历史消息保留产生时语言（与 Grok 行为一致）。
5. **消息渲染分层**：user = 右侧 pill；assistant = 头像 + 无框文本；实现细节行（`Host effect planned` / `planned (GP-xx|CM-xxxx)` / ADR 0002 / FFI 摘要 / effects / widget / delivery）归入 `.debug-only`，仅 Alt+D 可见；执行结果以 `.tool-run` 灰字一行呈现（`已执行 · shell → parity demo`）。全被折叠时补 `已完成。`，杜绝静默轮次。
6. **本轮截图暴露并修复**：
   - chat 来源 auto-approved 卡仍写 pending 队列 → 幽灵"待处理后台审批 1 项"。修复：`cg.auto` 分支不再 `appendPendingApproval`（后台来源由各自调用方入队）。
   - Auto-review 提示双行（renderer + run_moon_turn 各一条）→ 只保留 runner 行并纳入 reply-map 翻译。
   - auto_approved 轮次仍显示过期 "Approval required" 行 → 渲染时抑制。
   - 默认会话标题硬编码中文 → renderer 建会话改用 `wavegT("newChat")`；`sessions.js` 自动改名启发式扩为多语言默认标题集。原生菜单标签仍在主进程（会话首条消息即自动改名，不残留）。
   - `host_routine_daemon.sh` 随机占用 CDP 9223 端口 → 驱动测试前需 `ss -ltnp | grep 9223` 排查。

## Wave M4（Bot 信息面板：Hide / Delete 接真 store，本轮）

规格：`/app/grokspec/grok-bot-spec.md` §2.2（Hide ≠ pause、Hidden Bots 恢复；Delete 不可撤销、级联、共享 Computer 文件保留、先提示隐藏）。

1. **断链根因**：菜单 Hide/Delete 走 CM-0204/CM-1907 agent-directory，根本不碰 `bots.json`；`botsDelete` 级联三处错位——sessions.json 实为 `{version,active_id,sessions:[]}` 对象（旧代码按数组读，永不命中）、会话行没有 bot 字段（DM 约定是标题 `"<name> · DM"`）、routines 实住在 `data/routines/host-routines.json`（旧代码扫 `owner=` 文本）。全部修复并有脚本断言。
2. **内核新意图**：`HideBot(bot_id,hidden)` / `DeleteBot(bot_id,confirmed)` → effects `bot_hide`/`bot_unhide`/`bot_delete`（confirm=yes 后缀）；短语 `hide bot|unhide bot|delete bot|confirm delete bot`；wbtest 断言 intent/kind/command 三件套。
3. **Host 分发**：`bot_hide/bot_unhide/bot_delete` 接 `surface.hideBot/unhideBot/deleteBot`；未确认删除返回 `needs_confirm + advise_hide_first`，绝不静默执行。
4. **级联语义（GP-07）**：删 bots 行 + 同名 DM 会话（含按 bot id 命名的）+ host-routines.json 绑定行（id 或 prompt 含 bot id）+ schedule-*.json 工件 + rooms 成员（<2 成员房间整体删除）；primary 命中被删 Bot 时回落 agent-bit；`workspace_files_kept` 计数证明共享 Computer 文件保留；agent-bit 拒绝删除。
5. **UI（Grok 对齐）**：菜单六项全 i18n；Delete 弹层含 hide-first 建议（黄条）+ 不可撤销警告（红字）+ 取消/改为隐藏/确认删除；菜单动作 `silentUser+skipSession` —— 协议短语不进 transcript、不进会话历史，只留本地化结果行（`已删除 Bot：会话 N 个…`）。
6. **验证**：smoke 新增 13 断言（PASS=38，双跑幂等——G-1b 末尾重建 Smoke 供 G-6 用）；moon test 373/373；Electron smoke `intent=hide_bot ok=true`；CDP 截图全链路（隐藏→Hidden Bots(1)→恢复→删除弹层→级联回执）。
7. **环境注意**：routine daemon 的 python 子进程会再次抢 9223（本轮复现一次）——CDP 启动前 `ss -ltnp | grep 9223` 已是固定前置检查。

## Wave M5（Computer 右侧预览面板，本轮）

规格：官方 §3.3（预览显示点击/输入/导航/当前状态；离开预览工作继续；关闭不影响后台）。

1. **真缺陷**：`computer.json.screens` 从未被任何 Host 路径写入——右侧预览永远无帧可显示。新增 `surface.recordComputerAction()` 作为唯一写入点，take_over（host dispatch 已截帧）、screenshot（executeScreenshot 尾部）、computer_use（dispatch 解析 outcome/url）、computer_preview（打开即截）四类事件全接入；写入 best-effort，绝不阻断主效应。
2. **内核**：`ComputerPreview(bot_id)` → `computer_preview` effect；短语 `open computer|computer preview|show computer|查看电脑|打开电脑预览|open computer for bot <id>`。首轮实现踩中 `trimmed[20:]` 偏移错误（应为 22），smoke 断言 `screens["t"]` 暴露 → wbtest 补 `bot=bot-9` 精确断言防回归。
3. **UI**：Grok 三栏布局落地——`grid-template-columns` 扩第 4 列（默认 0fr，`body.computer-open` 340px，与 tools-open/sidebar-collapsed 组合全枚举）；`#computer-rail` 含 per-Bot chips、真帧图、meta（status/last_action/时间）、活动流（最近 8 条倒序）、Take over/刷新、群组/后台审批跳转、"离开预览不影响后台"提示。顶栏「面板」按钮改为「Computer」直达 rail；gp-panel 保留 group/approvals 内联。菜单动作轮次 `skipSession` → 协议短语不再污染会话历史（截图验证 take over 仍入库属预期：take over 是对话事件而非菜单静默动作）。
4. **验证**：moon 373/373；smoke PASS=41 FAIL=0 双跑幂等（G-1b 重建 Smoke 时补 `update name=SmokeRenamed` 修 G-6 mention 路由；G-4 前清 screens 防残留）；CDP 实测：rail 打开显示 Xvfb 真帧（帧内含应用自身菜单栏像素，证明 LiveDisplay 非 fixture）、takeover 横幅 + 活动流落盘 `preview-agent-bit-*.png`。

## Wave M6（语音 UI：GP-15/60/61，本轮）

规格：官方 §5.2（语音转写进 composer 可编辑）、§5.3（Voice chat：空 composer 发起、通话中控件、侧边栏进行中指示、结束留卡）、§5.4（语音备忘 Play/Pause + transcript）。

1. **kernel/host 复用**：voice_start/relay/end 链原本已存在（`VoiceStart/VoiceRelay/VoiceEnd` → `voice_session/voice_relay/voice_end_write` effects → host 真实 WAV/会话 store），本轮补的是 renderer 体验与诚实渲染规则：媒体 `media_ok=false` 不出假音频卡（`collectHostMediaPaths` 加 `media_ok` 门），relay 转写用 `user_text_prefix` 回填 memo 卡。
2. **GP-60 状态机**：`startVoiceChat()` 仅 composer 空 + 无附件时可用（input/附件变化实时 `syncVoiceChatAvailability`）→ `voice start vc-<ts36>`（silentUser+skipSession，协议短语不进 transcript）→ `#voicechat-bar`（脉冲、计时、监听/无麦诚实文案、转述框 → `voice relay <id> :: <text>`）+ 侧边栏 `#vc-sb-indicator`；挂断 → 停麦、`voice end <id>` → 结束卡（优先真实录音，含时长 `语音对话 · 00:18`；无录音回落 Host 会话 WAV，二者去重只出一张）。
3. **GP-61 memo 卡**：`renderDeliveryMedia(..., opts)` voice 分支——标题（语音备忘/Voice chat）+ 播放/暂停（同步 audio 事件）+ 查看/收起转写；🎙 语音输入按钮 recording 态红圈（start/stop/onstop 全路径复位）。
4. **i18n**：voiceChatBtn/voiceChatLive/vcEnd/vcListening/vcNeedEmpty/vcNoMic/vcMicDenied/vcRelayPh/vcRelayBtn/voiceMemoTitle/voiceChatCard/vmPlay/vmPause/vmShowTranscript/vmHideTranscript/vmNoTranscript/voiceRecHint/rVoiceStart/rVoiceEnd/rVoiceRelay ×3 字典；kernel 英文回执 `Voice call started…`/`Voice ended; wrote…`/`Voice relay on…` 经 WAVEG_REPLY_MAP 本地化（含 {id}/{n} 占位）。
5. **验证**：moon 373/373；smoke 新增 G-7 五断言（PASS=46 FAIL=0 双跑幂等，espeak mock 出真 WAV 断言 media_ok/live/relay_log/matched）；Electron smoke `voice start uicall9` / `voice end uicall9` ok=true；CDP（fake 麦克风）四截图：通话中（侧边栏指示+通话栏）、结束卡（时长+去重）、录音红圈、录音存盘回执（no_stt 诚实文案）。
6. **环境注意**：Electron 重启前 9223 可能仍被上一进程占用（TIME_WAIT 期 `Cannot start http server for devtools`）——固定用循环等端口释放再启动。

## Wave M7（Settings tab 化，本轮）

规格：官方 §7.1（General / Computer / Usage & Billing / Updates；Plugins 不在设置内，走侧边栏 Connect apps）。

1. **Tab 结构**：设置面板改为五 tab —— 通用（外观/语言/时区/自动审查）、Computer（本地执行三档 + 路由流量 + Update/Reset Bot's Computer）、凭证（原 secrets，独立 tab，符合"Plugins 非设置项"但凭证保留）、用量与账单（真实周用量，空态不造假）、更新（Check for Updates / Restart to Update）。`showSettingsTab()` 唯一入口；kernel 深链 anchor（update-channel/update-computer/auto-review/usage…）经 `SETTINGS_ANCHOR_TAB` 映射到对应 tab。
2. **Updates ≠ Update Computer（CM-1906）**：tab 内「检查更新」先走 kernel `check for updates`（Host 写 `data/settings/panel.json` anchor=update-channel），再真实调用 `bitbot.ota.check()`；发现新版 → `ota.download()` → 「重启并安装」仅在 `update-downloaded` 后启用（main.js 新增 `bitbot:ota:download/restart` IPC + autoUpdater `update-downloaded` 事件）。沙箱未打包/无 feed 时诚实显示 residual 原文（截图实测 "BITBOT_UPDATE_FEED_URL not set"）。
3. **Computer tab**：Update/Reset Bot's Computer 真链（两步确认 phase 落 `data/box/update-computer.json`，不假装完成）；tab 底部展示 `computer.json` 真实状态（state/takeover/last_update_at）。
4. **transcript 卫生**：设置/账号按钮 `silentUser+skipSession`（协议短语 open settings 不再入对话，修复 M4 遗漏的旧调用）；`Updates · update-channel ≠ Update Computer` 调试行删除（回执已由 WAVEG_REPLY_MAP rCheckUpdates/rUpdateComputer/rResetComputer 本地化）；GP-73 检查链断言进 smoke G-8（PASS=50）。
5. **验证**：moon 373/373；smoke 双跑幂等；CDP 五截图（通用/Computer/用量/更新/凭证）全 tab 切换 + 更新 residual 真文案 + 无协议短语泄漏。

## Wave M8（Connect apps / Marketplace，本轮）

规格：官方 §2.5（侧栏 Connect apps 或 Cmd/Ctrl+Shift+M；浏览/安装插件；插件全局生效；部分需浏览器 OAuth；支持启用/禁用单个插件工具）+ §7.1（Plugins 不在设置内）。

1. **kernel（GP-A3）**：`TurnIntent::TogglePluginTool(namespace_, tool, enabled)` 新意图——面板短语 `enable tool <ns>:<tool> on|off`、自然短语 `enable|disable tool <ns>.<tool>`（首个 `:`/`.` 分割，尾缀 on/off 覆盖动词）；effect `mcp_tool_toggle` cmd `ns|tool|on|off`；`connectors/plugins.mbt` 新增 `PluginToolSpec` + `PluginBundle.mcp_tools` + `PluginMetadata::tool_names()`（seed_demo：Slides 声明 make_deck/list_templates，Calendar 声明 list_events）。
2. **host**：`mcp_namespace`（install）按 PLUGIN_NS.tools 种入 `data/connectors/mcp-tools-catalog.json`（重装保留旧 enabled 位）；`mcp_tool_toggle` 只允许切换目录中真实存在且命名空间 Ready 的工具，未知/未装诚实 refused（`pretend_toggled:false`）；`mcp_list_plugins` 返回每插件 tools+enabled（与开关同一目录，单一事实源）；`mcp_get_plugin` 元数据带 tools。
3. **renderer（GP-A2）**：`#connect-apps-modal` 面板——搜索（300ms 防抖，走 Host `q=`）、刷新、"你的插件"/"浏览插件" 两区卡片、添加/卸载按钮（`bitbot.plugins.op` → 与 kernel 相同的 `mcp_namespace`/`mcp_uninstall` raw handler）、每工具启用/禁用开关（未安装时禁用并提示先安装）、全局生效与 OAuth 提示文案；侧栏按钮不再打 `list plugins` 进 transcript，Cmd/Ctrl+Shift+M 直达；语言切换时面板打开即重绘。
4. **i18n**：ca*（标题/按钮/回执/空态/提示）+ rToolToggle/rPluginInstalled/rPluginUninstalled/rPluginList/rPluginGet ×3 字典；插件名与已知工具描述用 `caName.<id>` / `caToolDesc.<tool>` 键本地化，未知条目原样保留（不硬翻 Host 数据）。
5. **验证**：moon 373/373（新 wbtest：三形状分类 + `user-Slides|make_deck|off` cmd 断言 + CM-2108 工具元数据断言）；smoke G-9 六断言（install 种入×2 → 面板禁用持久化 → list 反映 installed+enabled=false → natural enable → 未知工具 refused → uninstall Unavailable），PASS=56 FAIL=0 双跑幂等；CDP 七截图：打开（Calendar 已装/Slides 可加）→ 添加 → 两插件全装 → 单工具禁用（已禁用红标）→ 搜索 calendar 过滤 → 关闭无 transcript 污染；对话路径 `enable tool user-Slides:make_deck off` 回执本地化「已切换插件工具 … → 已禁用」。

## Wave M9（文件与结果卡，本轮）

规格：官方 §9.1（结果卡：图片/视频/音频/文件预览；可保存文件；桌面端可全屏查看图片/视频）+ §9.2（全屏查看器交互）。

1. **GP-90 文本族预览（main 进程）**：`bitbot:readArtifact` mime 表扩展 `.svg/.ogg/.md/.txt/.json/.csv/.ics/.eml/.yaml/.yml`；未知扩展名走 textish 探测（≤64KB 且前 1KB 无 NUL 才按文本读，否则诚实 `unsupported media type`）；文本族返回 `{text, mime}`，媒体族维持 `data_url`。renderer `GP90_TEXT_EXT_RE`（md/txt/json/csv/ics/eml/yaml/log）+ `collectHostMediaPaths` 新增 skill_write→SKILL.md、schedule_meeting→.ics、mail_send/draft→.eml、export_pack→.json 四个 `text:true` 分支；`collectHostOpenablePaths` 对同批路径去重（文本卡优先，OS-open 仅留给 pptx 等真二进制）。
2. **GP-90 文件卡（renderer）**：`renderDeliveryTextFile()` —— 标签（label · 文件名 · 字节数）+ 600 字符 `pre.fc-snippet`（点击进全屏）+ 三按钮（查看全文 / 保存文件 / 用系统应用打开）；读取失败回落 `renderOpenArtifact`（不假装有内容）。voice memo 分支豁免（.txt/.json 结尾的录音仍走 memo 卡）。
3. **GP-91 保存**：`bitbot:saveArtifact` IPC —— repo-root 守卫 + `dialog.showSaveDialog` + 真实 `fs.copyFileSync`；取消返回 `{canceled:true}` 不算失败；`BITBOT_SAVE_ARTIFACT_DIR` headless 覆盖（smoke/CDP 用，真拷贝到目录并回 `saved_path`）。图片/音频/视频卡通用保存按钮行 + 文件卡保存 + 查看器保存按钮三处接入；保存后按钮文案本地化回执（`lbSaved {p}`）。
4. **GP-92 全屏查看器**：`#gp92-lightbox` 遮罩（图/视频/音频/`pre.lb-text` 四渲染分支）+ 标题（label · 文件 · 字节）+ 保存/关闭 + Esc/遮罩点击关闭 + 视频卡片双击 `requestFullscreen()`。**关键坑**：lightbox 原 DOM 挂在 body 网格的 `#main` 网格项内，截图中 header 文字绘制在遮罩之上（网格项绘制顺序，`elementsFromPoint` 命中正常、纯 DOM 探针查不出）——`wireArtifactLightbox()` 启动时把节点 `appendChild` 到 body 顶层后遮罩正确压暗 header（brand 区像素亮度 236→29 实测）；重开查看器时保存按钮文案复位（防跨产物残留"已保存到 …"）。
5. **i18n**：lbSave/lbClose/lbSaved/lbSaveFailed/lbFailed/fcViewFull/fcSave/fcOpenOS/fcOpenFailed ×3 字典（占位 `{p}`/`{t}` 用 replace 填充）。
6. **验证**：moon 373/373；smoke 新增 G-10 六断言（SKILL.md/ics/eml/export_pack 四类文本产物真实落盘 + headless save 真拷贝 + main/renderer 文本格式表一致），PASS=62 FAIL=0 双跑幂等；CDP 八截图：learn from demo → SKILL.md 文件卡（三按钮中文）→ 点击 snippet 全屏文本 → 保存回执「已保存到 SKILL.md」→ Esc 关闭 → generate image → 图片卡保存按钮 → 点击图片全屏（遮罩压住 header，标题正确）→ 保存 PNG 落 /tmp/saved-artifacts（9181B 实测）→ 关闭恢复。

## Wave M10（空状态与模板，本轮）

规格：官方 §2.2（建议模板 Bot 一键创建；模板目录本地化，无网络也不报错）。

1. **store 化**：Host `loadBotTemplates()` 首读种入 `data/desktop/bot-templates.json`（官方六模板：sales-outbound/talent-scout/paid-media/expense-manager/bug-reproduction/chief-of-staff，含 default_name/job/description）；用户可直接编辑该 JSON，损坏/空列表回落 seed（不静默清空）。renderer 原 `BOT_TEMPLATES` 常量与四个静态 chips 删除——单一事实源进 store。
2. **kernel（GP-02）**：`ListBotTemplates` / `CreateBotFromTemplate(template_id, name)` 两意图；短语 `list|show bot templates`、`create bot from template <id> [name=<n>]`（匹配器置于 `create bot ` 之前防吞，wbtest 钉住优先级）；effects `bot_templates_list` / `bot_create_from_template`（cmd `template=… name=…`，`template` 已入 parseWaveGCommand kv 白名单）。
3. **host**：`bot_templates_list` 返回本地目录（`offline_ok:true, pretend_fetched:false`）；`bot_create_from_template` 按 id 解析后走 `surface.createBot`（job/description 逐字取模板），未知 id 诚实 `refused:true, pretend_created:false`，不凭空造 Bot。
4. **renderer**：空状态（welcome）新增「从模板开始」chips 条（`renderWelcomeTemplates`，MutationObserver 在新建对话后重挂）→ 点击 `bitbot:templates:create` 一键创建（按钮态 创建中…→已创建 {n}）→ `refreshBots()` + `selectBotForChat()` 自动打开 DM；创建对话框模板 chips 改为同一 store 渲染（点击仅预填 Name/Job/Description，仍走原 create 链）；回执 `rTplList/rTplCreate` 与 wt* 键 ×3 字典。
5. **验证**：moon 373/373（wbtest 新增两意图分类 + turn 断言 `template=bug-reproduction` + 优先级）；smoke G-11 五断言（删目录→首读种入六模板 → chief-of-staff 创建与模板逐字一致 → 未知模板 refused 且 bots.json 无 Ghost → 意图不被 create bot 吞 → 持久化断言 + 自清理），PASS=67 FAIL=0 双跑幂等；CDP：空状态六 chips 截图 → 点 Chief of Staff → bots.json 落 `{name:Chief, job:Chief of Staff}` + 侧栏出现 + Chief·DM 会话自动打开 → 对话框 chips 来自 store 且点击预填 Repro/Bug Reproduction。

## Wave M11（隐藏/删除联动，本轮）

规格：官方 §2.2 验收信号「隐藏操作不暂停 Bot 或 Routines」+ GP-07 删除二次确认。

1. **行为级断言（GP-06，本轮核心）**：既有 G-1b 只证明 hide 后 routine **行存活**，本波补上**真的触发**——smoke G-12 建探针 Bot + `create routine … cron=@now`（due_now 入册）→ `hide bot` → 分别走两条调度路径：① `bash scripts/host_routine_daemon.sh` 一次 sweep，② 内核短语 `tick routines` → `routine_tick` effect。断言 `last-tick.json fired_ids` 含该 id、`fires.jsonl` 计数增长且末条 `fired:true / pretend_fired:false`、`host-routines.json` 的 `last_fired_at` **严格推进**（第二次触发比较前值时间戳，防同值假通过），同时 `bots.json` 该 Bot `hidden===true`——即"隐藏中仍在跑"，不是行没被删。结论：sweep 选择器只看 `enabled/next_due`、不读 Bot 状态，行为本就符合规格，故本轮**未改内核/Host 逻辑**，只把可证伪信号补成断言（诚实记录：这是验证性补强，非新实现）。
2. **新实现（GP-07 聊天侧确认框）**：此前 hide-first 确认框只挂在侧栏右键菜单，用户在聊天里输入 `delete bot X` 只得到一行文案（死胡同）。现 `botsDelete` 未确认拒绝负载补 `bot_id`，renderer `postProcessWaveGResults` 识别 `needs_confirm && advise_hide_first` → 读 store 拿 Bot 名 → 打开同一确认框（取消 / 改为隐藏 / 确认删除）。`postProcessWaveGResults` 是同步函数，故用 Promise 链取名字而非 `await`。
3. **纪律**：本轮曾给 `HideBot` effect 加 `session=` 透传，核查后发现 tick 路径完全不读 Bot/session，属投机改动，已回退（不留未使用字段）。
4. **验证**：moon 373/373；smoke G-12 八断言（探针建 Bot → @now 入册 → hide 后 enabled/lifecycle 未暂停 → daemon sweep 真实触发 → 内核 tick 再次触发 → 聊天确认框接线 → 拒绝负载含 bot_id 且 Bot 未删 → 确认删除级联清探针 routine），PASS=75 FAIL=0 双跑幂等；CDP 实测聊天输入 `delete bot bot-663ee4` → 弹出「删除 · M11UI」框（建议改用隐藏 + 不可撤销警告），取消后 Bot 仍在，改为隐藏后转入 hidden_bots，探针最终确认删除清理。

## Wave M12（同 Bot computer-use 并发拒绝，本轮）

规格：官方 §2.3 / spec.md GP-30——每 Bot 独立 screen，同 Bot 同时只跑一个 computer-use 任务；不同 Bot 可并行。此前桌面 Host 完全没有该约束（仅 CM-06xx kernel-contract 测试提及），属真实现缺口。

1. **锁实现（product_surface.js）**：`cuLockAcquire/cuLockRelease/cuLockStatus`，锁文件 `data/desktop/cu-locks/<bot>.json`（含 bot_id/task/at/pid）。选择文件锁而非内存态：CLI smoke、Electron main、审批重放是不同进程，必须竞争同一状态；`at` 超 TTL（默认 120s，`BITBOT_CU_LOCK_TTL_MS` 可调）视为进程崩溃残留，直接接管——拒绝"锁泄漏把 Bot 永久卡死"。
2. **Host 执行链（host_ffi.js）**：`computer_use` kind 先按 `ffiOpts.botId` 取锁；被占 → 结果 `ok:false, busy:true`，stdout `refused:true / pretend_ran:false / held_by / held_since / held_task`（拒绝必须说明被哪个任务占用）；拿到锁则 `try/finally` 包裹执行，成功失败都释放，不泄漏。拒绝路径不窃取原持有者的锁。
3. **Bot 身份贯通**：`runTurn ctx.botId → executeHostEffects({botId})`；renderer `runUserTurn` 携带 `activeBotId`（打开 Bot DM 时设置），`bitbot:turn` IPC 透传；审批放行重放 `runAllowed` 也带 `bot_id`（否则后台放行的 CU 会绕过锁）。CLI `--bot-id`/`BITBOT_BOT_ID` 供 smoke 断言。缺省 `agent-bit`（主会话）。
4. **renderer 回执**：chip 条只渲染 ok:true，busy 拒绝改由 `postProcessWaveGResults` 直接 `addMsg`（`rCuBusy` ×3 字典，含 `{bot}`/`{task}` 占位）——拒绝可见且绝不伪装成功。**本轮坑**：编辑 kind 链时误把 `else if` 拆成独立 `if` 又删错花括号，renderer 语法错误导致 boot 停在 "booting MoonBit…"；用 `node --check` 抽出 `<script>` 体定位（`new Function` 只报类型不报行号），修复后 boot 正常。教训：改 index.html 脚本后必须先跑 script 体 `node --check` 再启动 Electron。
5. **验证**：moon 373/373；smoke G-13 七断言（外部进程持锁 → 同 Bot 第二任务 busy/refused/pretend_ran:false 且 held_task 可见 → 拒绝不窃取锁 → 不同 Bot 并行 ok → 释放后同 Bot 可再跑且锁自动清空 → 3 分钟陈旧锁 TTL 接管 → renderer 接线），PASS=82 FAIL=0 双跑幂等；CDP 两场景：agent-bit 被外部持锁时聊天发起 CU → 「agent-bit 正在执行另一个 computer-use 任务（hold: …/task-a）…」；点进 Piper（bot-7ef5d2）聊天发起同一任务 → 正常执行出证据文件，agent-bit 锁全程未被影响。

## Wave M13（群内任务所有权转移，本轮）

规格：spec.md GP-52「Bot 间可传递任务所有权；回执含目标 agent id；任务转交可见于 transcript」。此前桌面端只有 `send_to_agent`（CM-14xx）与 room_turn 定向回复，没有任何"把任务从 A Bot 转给 B Bot 并在群里留痕"的能力——真实现缺口，非断言缺口。

1. **kernel（`cmd/desktop_turn`）**：新意图 `HandoffTask(room, from_bot, to_bot, task)`；短语 `handoff room <id|title> [from=<bot>] to=<bot> task=<text>`（`hand off room` 同义），匹配器置于 join/leave/room-cue 分支**之前**，防任务文本里出现 "room" 时被通用分支劫持（wbtest 钉住该优先级）。`extract_kv` 键表补 `" task="`——否则 `to=bot-x task=…` 会把 task 整段吞进 to 值（本轮实测踩坑）。effect `handoff_task`，command 管道格式 `room|from|to|task(+编码)`。
2. **Host（`product_surface.js` + `host_ffi.js`）**：`handoffTask()` 按 id 或标题找群，成员校验双向（`to_bot_not_member` / `from_bot_not_member`，from 可为 user），拒绝负载带 `members` 与 `pretend_transferred:false` 且**不写 transcript**；成功则追加 `{kind:"handoff", text:"↪ task handed off: A → B :: <task>", responders:[to], responder_policy:"handoff_target"}` 进 rooms.json（cap 200）。`host_ffi` 执行链再投递承接 Bot inbox（`data/agents/inbox/<to>.jsonl`，`is_handoff:true + forbids_private_assumptions:true`——群内转交不得夹带私聊假设）并落 `data/agents/handoffs/*.json` 存根。
3. **拒绝原因透传**：`handoff_task` 结果此前只填 `stderr`，内核续跑显示 "unknown host error"（M12 前 CU 拒绝踩过同型坑）。现补 `error:` 字段，聊天与内核 dump 都能看到 `room_not_found` / `to_bot_not_member` 原文。
4. **renderer**：`WAVEG_REPLY_MAP` 识别 `Task handoff planned (GP-52): A → B in «room»` → `rHandoff`（×3 字典，`{from}/{to}/{room}` 占位填充）；拒绝走 `postProcessWaveGResults` 直接 `addMsg`（chip 条只渲染 ok:true 的既有纪律）→ `rHandoffFail` 组装 `error → to_bot @ room` 明细。
5. **验证**：moon 373/373（wbtest 增 4 组断言：意图/命令逐字、alias+from 缺省+task 含 "room" 不被劫持、缺 task 不落 handoff、room 短语优先级不变）；smoke G-14 十断言（三探针 Bot + 群 → 转交意图+host ok → transcript 行逐字对齐 → inbox 投递 → 存根落盘 → 非成员被拒不写 transcript → 未知群 room_not_found 且原因透传 → renderer 三语接线 → 级联清理双跑幂等），PASS=92 FAIL=0；CDP 两截图：聊天输入合法 handoff → 「CdpHoFrom 已将任务转交给 CdpHoTo（群「room-mvg7mte4」…）」且 rooms.json 落行、inbox 收到；转给非成员 agent-bit → 成功气泡与「任务转交被拒：to_bot_not_member → agent-bit @ room-…」并存，transcript 仅 1 行、agent-bit 无 inbox——UI 不假装。

## Wave M14（账户真实登录态 + 安装态，本轮）

规格：spec.md GP-74「显示真实登录态来源（凭证是否配置）；未配置时明确"未登录"而非假装」+ GP-77「`ota:check` 真实网络探测；安装态显示；断言 Computer 文件不受应用更新影响」。

1. **GP-74 本地 profile 语义**：新 store `data/desktop/account-profile.json`（`{active, accounts:[{label,created_at,last_used_at,backed_by}]}`）。四个意图 `account_status / account_sign_in / account_sign_out / account_switch`（短语 `whoami|account status|am i logged in|sign in`(裸)=查态，`sign in <label>`，`sign out|log out`，`switch account <label>|add account <label>`；`shell whoami` 仍走 shell 链——wbtest 钉住）。关键诚实约束：`remote_verified:false` 恒定（本机没有可连的远端账号，绝不谎称验证过）、登出只清 `active` 且 `credentials_untouched:true`、未知 profile → `account_not_found + known[]` 且 `pretend_switched:false`。
2. **凭证来源真相**：`credentialSourceTruth()` 同时查 `process.env` 与两级 `.env.local` 文件（CLI smoke 与 Electron main 因此报同一状态），逐项返回 `{name, configured, env_keys, file}`——note 文案随真实配置态在 "backed by …" 与 "NO configured credentials" 间切换，不空口说已登录。
3. **GP-77 安装态**：main 启动写 `app-install.json`（version/packaged/updater_loaded），`ota:check` 每个分支（含三条 residual 早退与 catch）持久化 `ota-state.json`；新意图 `update_status` 读取两者 + feed env，产出 `residual:true / pretend_up_to_date:false`（未打包开发运行）与 `computer_untouched_by_app_update:true`。Computer 不受应用更新影响用 marker 断言：smoke 往 computer.json 写 `__m14_marker` → 跑 update_status + check_updates 全链 → marker 仍在。
4. **renderer**：General tab 新增 Account 区块（输入框 + 登录/登出 + profile 下拉，走 `bitbot:account:*` IPC → 同一 Host 链，单一事实源）；Updates tab 打开即显示安装态行（版本/开发运行/上次检查/Computer 安全）。聊天侧：`whoami` 等回合的真实结果由 `postProcessWaveGResults` 从 host payload 出本地化气泡（复用 accountSignedIn/NotSigned/Fail 键），内核 "planned" 文案并入 `DEBUG_LINE_RE`（Alt+D 才显示）——避免"计划中"与"真实结果"两条气泡重复。
5. **验证**：moon 373/373（wbtest 增 8 组：whoami/裸 sign in/sign in Work/switch my+work 编码/log out/update status 与 check updates 分离/shell whoami 不被吞）；smoke G-15 十断言（未登录诚实态 → 登录落盘 → 凭证来源真相 → 多 profile 切换 → 未知被拒 → 登出保留凭证 → 安装态真实版本+residual → check_updates 链分离 → Computer marker 未被改写 → renderer 三语接线），PASS=102 FAIL=0 双跑幂等；CDP 四截图：General 面板「已登录（本地 profile「Personal」）· 凭证来源：无任何已配置凭证（相关功能保持关闭）」、Updates「安装版本 v0.1.0 · 开发运行（未打包） · 从未检查 · 应用更新不会重置 Computer 文件」、聊天 `whoami` 真实态气泡、`switch account Ghost` → 「账户操作被拒：account_not_found」。

## Wave M15（GP-70 像素级断言 + Playwright-E2E 冷启动，本轮）

规格：spec.md GP-70「`nativeTheme.updated` 实测生效（nativeTheme.themeSource 改变 + 截图/像素断言）；重启保持」+ 未做清单「renderer E2E（Playwright for Electron）替掉手工冷启动」。

1. **零依赖像素通道（`scripts/lib_png_pixel.mjs`）**：纯 Node `zlib` 的 PNG 解码（chunk 遍历、5 种 scanline filter、8-bit RGB/RGBA/G），配 Rec.709 `avgLuma()` 区域亮度与 `pixelAt()` 探针；附 `encodeRgbPng()` 反向生成 fixture。可证伪性先钉解码器自己：E2E 开头 encode(23/255 双色)→decode→亮度必须 23.0/255.0（filter/CRC 全链自证），再用 PIL 独立复核旧截图亮度一致（34.7/22.5 双端逐位相同）。为什么不引 pngjs：验收脚本要能在裸沙箱跑，依赖越少残留越少。
2. **Playwright-E2E（`scripts/e2e_grok_desktop_boot.mjs`）**：`playwright-core._electron.launch` 拉起真实 `main.js`（`--no-sandbox --disable-gpu`，软件光栅与手工 CDP 同路径，截图保真），`firstWindow` + `#composer #text` 就绪判定替代人工肉眼。断言链：冷启动 → 标题 → system 态无 force 类 → `settings.set(dark)`（**真实用户路径**：IPC → `applyAppearance` 写 `nativeTheme.themeSource` + `settings-changed` 广播 → renderer `wavegApplyAppearanceClass`）→ 主进程 `themeSource/shouldUseDarkColors` 真值 → viewport 像素亮度 <60 → light >200 → Δ>120 → force-dark 解除（bg rgb(255,255,255)）→ 回 system 亮度复位 → 落盘 → **shutdown 后二次 launch** 验重启保持（force-dark + 像素仍暗）→ 真实聊天 `sign in E2E` 键盘输入 → 气泡渲染 + `account-profile.json` `active=="E2E"`。store 快照-恢复包裹全程（双跑幂等）。
3. **踩坑两处（环境级，非应用缺陷）**：a) 沙箱继承 `DISPLAY=:1` 但 X socket 不存在（Xvfb 在 :99），Electron 在 `ozone_platform_x11` 以 SIGSEGV 形态退出、Playwright 报假 "Process failed to launch!"——修：`liveDisplay()` 按 `/tmp/.X11-unix/X<n>` socket 存活性选 DISPLAY。b) Electron 33 GPU 通道 stderr 刷屏与 pw 等待 `DevTools listening` 的 readline 竞争造成随机启动失败——修：`--disable-gpu` + 有界重试（3 次，退避），并在 gaps 里写明这是宿主 flake 容忍而非降低断言标准。
4. **诚实残留（运行时自证）**：Xvfb/Chromium 下 `themeSource=dark` 后 renderer `matchMedia('(prefers-color-scheme: dark)')` 不随 live 翻转（boot 与切换两次探测同现 `dark:false`，去 force 类后底色回白）。主进程真值（`shouldUseDarkColors:true`）+ token 通道像素真值都断言了；OS live media-query 通道需带 DE 机器复核，E2E 检测到该情形打印 RESIDUAL 说明而非 pretend 通过。spec GP-70 行已改写为「像素断言已做 + 该残留」。
5. **验证**：E2E 单跑 PASS=17 FAIL=0；smoke G-16 四断言（全绿、dark+light 像素断言存在、重启断言存在、settings 快照恢复完好）串进 `smoke_grok_desktop_parity` → **PASS=106 FAIL=0 双跑幂等**；moon 373/373；`hosts/desktop/package.json` 增 devDependency `playwright-core@^1.49.1`（无浏览器下载，复用自带 electron dist）。

## Wave M16（GP-11 附件上限 + 多附件真实复制，本轮）

规格：spec.md GP-11「粘贴/拖拽/文件选择；**≤6 个/次**；文档图片音频 ≤25MB、视频 ≤200MB；成功则路径落在仓库 `/workspace` 语义目录且 kernel 收到真实路径（CM-0106 禁幻觉路径）」；验收信号「选 7 个 → `too_many_attachments`；超限体积 → 拒绝」。

1. **单一校验器 + 累计口径（`product_surface.stageAttachments(paths, sessionId, existingCount)`）**：选择、粘贴、拖拽三条入口全部进这一个函数，不再各自抄一份限制。≤6 的判定是 `paths.length + already_held > 6`（本次选择数 + 已在附件条上的数量），只看本次选择数是错的口径——用户可以点 4 次每次 2 个凑出 8 个。体积分两档：`.mp4/.webm/.mov` 走 200MB，其余图片/音频/文档走 25MB；拒绝负载带 `kind/bytes/max_bytes/already_staged/max_per_send`，renderer 才能出「视频 210MB 超过 200MB 上限」这种可核对的具体文案，而不是笼统「附件太大」。
2. **诚实拒绝伪造路径（CM-0106）**：contextIsolation 下 paste/drop 拿到的 `File` 没有磁盘路径，Electron 32+ 已移除 `file.path`，preload 改用 `webUtils.getPathForFile(file)`；取不到真实路径时返回 `no_real_path` 并在聊天出本地化拒绝气泡，绝不把 `blob:`/空串塞进后续链路。附件条只渲染 `ok:true` 的项，失败项走气泡——UI 不假装已附上。
3. **修 kernel 多附件真实缺陷（新 `AttachFiles` 意图）**：旧版把 composer 里 `attach file a; attach file b` 整串当一个 src 生成一条 `copy_to_box`，Host `resolveUnderRepo` 直接判越界（实测报 `copy paths must stay under repo root`），等于多附件功能从来没通过。现在 `extract_attach_paths()` 逐行解析 `attach file `/`upload file ` 前缀、按 `;` 切段、丢 `k=v` 与重复项，≥2 个 → `AttachFiles(paths)`，effect 臂为**每个真实路径产一条** `copy_to_box`；单个路径仍走 `copy_to_box`（保持既有语义与 wbtest）。
4. **dest 从幻觉改成可执行**：旧版 dest 写 `/workspace/uploads/<name>` 绝对路径，Host 校验必拒。改为仓库相对 `data/workspace/uploads/<basename>`（spec 说的「仓库 /workspace 语义目录」的真实落点，`WORKSPACE_UPLOADS_DIR = data/workspace/uploads`，按会话建子目录暂存，提交时 kernel 用绝对暂存路径作 src）。Host FFI 真复制后落 `data/box-copy/*.json`，含 `sha256_src == sha256_dest`、`binary_intact:true`、`under_repo:true`，跨机 scp 仍是标注过的 residual。
5. **MoonBit 侧 API 教训（写进记忆避免重踩）**：`String::replace` 必须带标签 `p.replace(old = "\\", new = "/")`（位置参数报 4086/4080，`old~=` 写法报 3016）；`String::rfind` 在本工具链不存在（4015），取 basename 用 `while` 手工扫最后 `/`。新增 TurnIntent 变体三处必须同改：enum、`TurnIntent::name` 名表、`match intent` effect 臂，漏 effect 臂是 partial_match Error [0011]。
6. **官方文档口径复核（关闭 M17 的 GP-11 子项）**：`/app/grokspec/grok-bot-spec.md` §5.5「附件」逐字写「桌面端: 最多 6 个附件/次 / 文档/图片/音频: ≤25 MB / 视频: ≤200 MB」，验收信号「超出限制时提示错误」——与实现的 6/25MB/200MB 三档完全一致，故这些常量不是自拟，代码注释与文案均标注官方来源。官方另列支持类型（图片/音频/视频、PDF、纯文本、Word/Excel/PPT、CSV/JSON/YAML/源码、HTML/邮件、Jupyter notebook），实现按扩展名分四档（video/image/audio/doc）覆盖上述全集；「加密/损坏文件不可读」属读取侧（无解密链）→ 保持 residual，不假称已校验可解析。
7. **验证**：moon 374/374（新 wbtest `desktop_turn_attach_files_gp11`：单路径 → copy_to_box 且 dest 逐字、prose+`;` 与换行两种分隔 → attach_files 2 effects、重复项折叠为 1、散文里 "please attach file notes.txt to the mail" 不误触发、既有 `copy to box ... dest=/workspace/...` kv 短语行为不变——回归保护）；E2E `scripts/e2e_grok_desktop_boot.mjs` 扩到 **PASS=28 FAIL=0**（renderer 侧 `stagePaths` 拒绝 `no_real_path`/累计 too_many、合成 DragEvent over `document.body` 真实出「附件被拒绝/没有真实磁盘路径」气泡、node 侧 26MB/201MB/7 个/6 成功四态、6 路径喂真实 kernel 得 6 条 copy_to_box）；smoke 新增 **G-17 十一断言** → `smoke_grok_desktop_parity: PASS=117 FAIL=0` 双跑幂等（含 fixture 与暂存目录清理）。renderer 接线用源码断言钉住：三入口共用校验器、`document.body` 作拖拽区（composer 是 `#main` 的兄弟节点，挂 `#main` 收不到 drop）、6 个 i18n 键 ×3 语言、`bitbot:attachments:stage` IPC 双端契约。

## Wave M17（GP-14 Reply 定向回复：被回复消息 id 真正进入 kernel 上下文，本轮）

规格：spec.md GP-14「Reply 特定消息；React 消息」，验收信号「点回复后 **kernel 上下文含被回复消息 id**」；官方文档 §5.1「Reply 回复特定消息」+ §2.4 群聊消息路由「Reply 功能定向回复特定 Bot」。上一波 gaps 表把 GP-14 写成「renderer 已有回复入口」——实测**并不存在**（hover 无任何回复 affordance，`addMsg` 连消息 id 都不挂），本轮按真实缺口重做，不是补断言。

1. **消息必须有可寻址 id（`hosts/desktop/sessions.js`）**：`newMessageId()`（`msg-<hex8>`）+ `ensureMessageIds()` 在 `load()` 里一次性 backfill 旧行并落盘；`appendMessages` 写入时分配 id，并透传 `reply_to` 字段（引用关系进 transcript 行，重启/切会话后引用条可从 store 重建，不是只在内存里）。`findMessage(id)` 跨会话按 id 解析出 `{ok, id, session_id, role, text}`，未知 id 返回 `message_not_found`（不给空对象让上层误判成功）。
2. **kernel 承载 id（`cmd/desktop_turn/turn_json.mbt`）**：`DesktopTurnContext.reply_to` + `DesktopTurnResult.reply_to`（turn JSON 回显，renderer/Host 都能断言而不是猜）。新 argv `--reply-to <id>`；`user_text_from_args_skipping_flags` 的 flag 表同步加入，否则 id 会被拼进用户原文——wbtest 钉住「messages[0].text 与 effects[0].command 都必须是原文」。Reply 不改变意图路由（`shell echo hi` 带 reply_to 仍走 host_effect）。
   - MoonBit 教训（本轮实测）：本工具链 **不支持** struct field default（`reply_to : String = ""` 报 4044/3002），也 **不支持** `{ ..ctx; f: v }` / `{ ctx with f: v }` 结构更新语法——`parse_turn_context` 六个分支只能继续手写全字段。别信 `moon check` 的 "no work to do"：`cmd/` 目录下没有 `moon.pkg` 时根本不算 package，我的临时验证因此假绿过，最终以真实项目报错为准。
3. **Host 把 id 变成真引用（`run_moon_turn.js` + `host_ffi.js`）**：runner 先跑 kernel 拿回显的 `reply_to`，再用 `ctx.resolveReply`（Electron 注入 `sessions.findMessage`；CLI 无 Electron 时落 `defaultResolveReply` 直接读同一份 `data/desktop/sessions.json`，两端解析结果一致）解析原文，随 `executeHostEffects` 的 `ffiOpts` 传给 `llm_chat`；`executeLlmChat` 在 system 与当前 user 之间插入 `{role, content:"[quoted message <id>] <原文>"}`——引用真的进了 HTTP 请求体，并把 `reply_to / reply_quote_chars / reply_quote_source` 写进 `data/llm/turns/*.json` artifact 供审计。未解析时 `reply_quote_source:"unresolved"`，绝不拼假引文。
4. **renderer 回复交互（`index.html`）**：`addMsg` 支持 `opts.mid`（写 `data-mid`）与 `opts.replyToText`（气泡上方引用条），`attachMessageActions()` 给每条有持久 id 的气泡挂 hover「回复」按钮 → `setReplyTarget()` 显示 composer 上方 `#reply-bar`（可取消）；submit 时把 `{replyTo, replyQuoteText}` 交给 `runUserTurn`，发送后清空。首轮消息的 store id 由 main.js 在写库后回传 `result.stored_ids={user, assistant[]}` 再补挂到已渲染气泡（乐观渲染时 id 还不存在）；引用预览用**本地化后**的文本，避免中文 UI 里露出内核英文原文。`replyAction/replyQuoting/replyCancel` ×3 字典；群聊 `roomTurn` 的 responder 解析未受影响（Reply 是 DM/单会话通道，群内定向仍走 `@` 与 handoff）。
5. **验证（三层，都能证伪）**：
   - kernel：`moon test` **375/375**，新 wbtest `desktop_turn_reply_to_context_gp14`（argv 解析、原文不污染、JSON 回显、意图路由不变、非回复回合空串）。
   - 无 Electron 的真实链探针 `scripts/prove_gp14_reply.js`（**PASS=16 FAIL=0**，双跑幂等，store 快照恢复）：固定 id fixture → `runTurn({replyTo})` → kernel 回显 → Host 解析 role/text 对得上 → **echo-all stub** 证明 `[quoted message <id>] <原文>` 出现在 provider 请求体 → artifact `reply_quote_source=session_store` → `appendMessages`/`findMessage` 契约 → 伪 id `message_not_found` + `unresolved` → 非回复回合无注入。stub 侧新增 `BITBOT_STUB_ECHO_ALL`（回显整条 message stack）与 `BITBOT_STUB_ECHO_WIDTH`（默认 120 字会截掉引用行）。
   - UI 真交互（`scripts/e2e_grok_desktop_boot.mjs` GP-14 十断言，**PASS=38 FAIL=0**）：新建会话保证目标唯一 → 键盘发第一条 → 等到该气泡拿到 store id → 点「回复」→ 引用条显示原文 → 发第二条 → 转写出现带 `[quoted message <id>]` 的 provider 回执 → artifact/store 行校验 → 切到新会话引用消失、切回从 store 重建 → 取消按钮收起 → 伪 id 诚实失败。两处等待从「文本出现」改为「带 `data-mid` 的文本出现/引用条出现」，否则乐观渲染会让目标选择读到空集合（本轮实测踩到）。
   - 汇总：`smoke_grok_desktop_parity: PASS=122 FAIL=0` 双跑幂等（新增 G-18 五断言：探针全绿、两级链断言存在、诚实失败断言存在、kernel/store 契约在位、无 sess-gp14probe 残留）。
6. **诚实边界**：官方「Reply 定向回复特定 Bot」在群聊语义下由 `@BotName`（GP-51）与 handoff（GP-52）承担 responder 路由；本波 GP-14 覆盖的是「引用某条具体消息」这条 composer 通道，引用文本只进 provider 上下文，不宣称模型一定按引用改变应答对象（无远端真模型时由 stub 证明请求体，不证明模型行为）。

## Wave M18（GP-93/94/95 官方 §5.6 Markdown/链接纪律：可点击、系统浏览器、悬停不自动导航，本轮）

规格来源：`/app/grokspec/grok-bot-spec.md` §5.6「Markdown/链接纪律」——「消息和结果中的链接在系统浏览器打开 / 悬停链接卡片显示预览 / 输入凭证或批准外部操作前检查目标」，验收信号「链接可点击打开 / 悬停预览不自动导航」。审计时发现仓库 `docs/grok-desktop-parity/spec.md` **完全没有对应 GP 行**（55 个 GP id 全覆盖 §2–§9 却漏了 §5.6），实现侧也确实是外壳态：内核早就把裸 URL 规范化成 `[url](url)`（CM-0111），但 renderer `addMsg` 用 `textContent` 落正文，链接以方括号原文显示、不可点；`main.js` 无 `openExternal`、无 `setWindowOpenHandler`。本轮按 规格→实现→验证 补齐：先在 spec.md 加 G-13 三行（GP-93/94/95，四列含实现落点），再实现。

1. **政策与渲染必须同源（`hosts/desktop/link_discipline.js`，新增）**：沙箱 renderer（`contextIsolation:true` + `sandbox:true`）不能 `require`，所以政策文件写成经典脚本——浏览器里 `window.__bitbotLinks`，Node 里 `module.exports`，**同一份字节**被三处使用：renderer `<script src="./link_discipline.js">`、main 进程 `require("./link_discipline")`、探针 `require()`。为什么值得单独一个文件：如果 policy 抄两份，冒烟断言绿的是副本而不是应用真正执行的那份。核心两函数：`parseExternalUrl()`（scheme 白名单 http/https，拒 `javascript:`/`data:`/`file:`/`mailto:`/`intent:`、含空白或控制字符如 `java\tscript:`、空串、无 host；先 `normalizeUrlCase` 只把 scheme+host 小写——WHATWG 本来就做，显式化是为了让"大写 HTTPS"不被当成另一种 scheme）与 `linkBodyToDom()`（识别 `[label](url)` 与裸 URL 两种形态，其余字符一律 literal）。终止符集合逐字对齐内核 `ui_protocol/markdown.mbt:url_terminator_at`，并像内核一样剥掉句末 `.,;:`，**否则 href 与用户看到的地址不一致**（点开的比显示的多一个「，」是最常见的假可点）。
2. **XSS 面无 innerHTML**：`applyLinkBody()` 只做 `createElement/createTextNode/appendChild/removeChild`，不解析任何 HTML；`linkBodyToDom("<img src=x onerror=alert(1)>")` 结果是 1 个 text node，探针里那个 fake DOM **压根没有 innerHTML setter**（赋值即抛），所以"没注入"是被执行证明的，不是源码扫描。不可打开的链接保持**原样可见**（`[点我](javascript:alert(1))` 全文照抄），既不静默删也不假装成按钮——用户看得见模型写了什么，才谈得上官方那句「检查目标」。`rel="noopener noreferrer"`、无 `target=_blank`（配合窗口守卫，不给绕过路径）。
3. **真实投递链（内核侧不新造规则）**：`turn_json.mbt` 已在 `deliver_ok` 前跑 `linkify_bare_http_urls`，`runtime/deliver.mbt:deliver_text` 用 `ensure_markdown_links` 拒绝任何裸 URL——即"链接不可点"若发生，只可能是渲染层丢了 markdown。新 wbtest `desktop_turn_link_discipline_gp93` 钉住这条契约：provider stdout 含裸 URL → 投递体必须出现 `[url](url)`；Host continue dump（shell stdout 带 navigate URL）同样先规范化；句末 `.` 落在链接外。376/376。
4. **点击路由（`hosts/desktop/link_open.js` + `main.js` IPC + `preload.js` 白名单）**：`createLinkOpen({repoRoot, openExternal, auditPath})` 是唯一的"打开外部链接"实现——main 注入真 `shell.openExternal`，探针注入 spy，**校验与留痕逻辑同一份**。每次尝试 append 一行 `data/desktop/links.jsonl`（`at/href/scheme/hostname/decision/source/session_id/opened/error`）：拦截也留痕，因为"被挡住的那次尝试"没有任何痕迹就等于不可审计。`opened` 只在 `openExternal` 真成功时为 true。窗口侧：`setWindowOpenHandler` 一律 `{action:"deny"}` 并把 URL 交给同一路由（新窗口点击 = 系统浏览器，而不是 Electron 里开一个 `file://` 页面的子窗口），`will-navigate` 非本页 URL 一律 `preventDefault` 后同路。preload 只暴露 `links.open(payload)`，renderer 拿不到 `shell`。
5. **悬停卡（GP-95）**：`#link-preview`（`pointer-events:none`，固定定位，视口边界翻转）在 `mouseover` 上显示**主机名为标题** + 完整 URL + 「在系统浏览器打开」提示，`mouseleave`/`blur`/Esc 收起。官方那条「输入凭证或批准外部操作前检查目标」在纯 UI 层能做的就是把主机名顶到第一行——卡上写的和点开的一定是同一个 host，因为两者都取 `getAttribute("href")` 再过同一个 `parseExternalUrl`。
6. **测试钩子的诚实边界**：`BITBOT_LINKS_AUDIT_PATH` 把审计指到临时文件（否则 hover/click 的"零行/几行"断言会被历史点击污染）；`BITBOT_LINKS_RECORD_PATH` 让 `openExternal` 在测试里**记录 URL 而不启动浏览器**，返回 `{ok:false, recorded:true, error:"record-only mode: browser launch suppressed under test"}`——审计行因此是 `opened:false` + 这个原因，探针断言的正是"没谎称 opened:true"。renderer 对 `res.recorded` 静默（不是用户可见失败），真失败才出 `linkOpenFailed` 气泡。Xvfb 里 `xdg-open` 是否真能起浏览器属环境依赖，记为 residual：E2E 证明的是 URL 到了 `shell.openExternal` 入口。
7. **验证（三层）**：
   - 无 Electron 探针 `scripts/prove_gp93_links.js` **PASS=21 FAIL=0**（双跑幂等，临时审计文件自清）：fake-DOM 渲染 2 链接 + 正文一字不少；四类恶意 scheme 0 可点；scheme 门表 14 例逐条断言；`createLinkOpen` spy 收到逐字 URL、`javascript:` 未被调用、4 行审计含 3 条 refused 且 `opened` 语义诚实；真实 kernel 回合（echo stub 注入 `BITBOT_STUB_REPLY`，stub 新增该钩子）证明 `[url](url)` 出现在投递体且剥掉 markdown 后不含裸 URL；main/preload/renderer/package.json/spec.md 契约齐备。
   - E2E `scripts/e2e_grok_desktop_boot.mjs` 新增 GP-93/94/95 **十四断言**（总 **PASS=52 FAIL=0**，双跑）：真键盘回合 → `a.msg-link` href 逐字 → hover 卡内容与 host → **hover 期间审计 0 行且 `win.url()` 未变**（「悬停不自动导航」的执行级证明，不是 CSS 断言）→ 真点击后审计行 + record 落点 → 点击后仍在应用内 → `javascript:` 走真 IPC 得 `refused` → `window.open` 被 deny 且窗口数 1→1 → `window.__bitbotLinks` 存在且三个函数齐（同源证明）→ 收尾"到达 open 入口恰好 2 次（点击 + 被 deny 转交的 popup），hover 0 次"。
   - smoke 新增 **G-19 六断言** → `smoke_grok_desktop_parity: PASS=128 FAIL=0` 双跑幂等。
8. **本轮踩到并修掉的三个真问题**（都留在断言里）：① `addMsg` 改造后仍有一处 `.body` 的 `textContent` 赋值（streaming `phase=end` 回写），链接在流式回合结束后又变回死文字——E2E 之外用「正文唯一入口是 `applyLinkBodyTo`」源码断言钉住，流式增量保留 `textContent`（纯文本安全），结束时切政策模块。② JS 里 `/\[[^]]*\]/` 的字符类被解析成 `[任何字符]` 而非"排除 ]"，剥 markdown 的假阴性断言会**假绿**，必须写 `[^\]]`（已注释在探针里）。③ 探针 stub 在设置 `BITBOT_STUB_REPLY` 前就 spawn，provider 文本还是 echo 文案；stub 读的是自身 env，故 spawn 时就带上。另外 smoke 的 G-16 把 E2E 限时 240s，本波 E2E 多一次真实 boot（四次 boot 共约 5–6 分钟）会误杀 → 提到 900s 并注明原因；GP-14 store 断言原本全局搜"最后一条匹配文本的行"，前几轮 E2E 的行仍在 store 里 → 改为按本轮 `target.mid` 定位会话再取行（否则跨轮命中旧行，`reply_to` 对不上产生假红）。

## Wave M19（GP-96/97/98 官方 §5.7 进度更新：实时显示 Bot 工作进度 + 长时间任务中间更新，本轮）

规格来源：`/app/grokspec/grok-bot-spec.md` §5.7「进度更新」——「实时显示 Bot 工作进度（工具活动 / Computer 使用 / 创建的文件 / 问题 / 审批请求 / 语音消息）/ 长时间任务有中间更新」。验收信号「进度可见 / 中间更新 / 不谎报」。审计时发现仓库 `docs/grok-desktop-parity/spec.md` 已有 G-14 三行（GP-96/97/98，M18 之后补的），但实现侧只有骨架：renderer 有 `#turn-progress` DOM 节点但从未被任何代码更新；Host FFI 没有把 effect 边界事件交给上层；CLI 也没有 stderr 进度。本轮按 规格→实现→验证 补齐。

1. **协议层必须唯一（`hosts/desktop/progress_protocol.js`，新增）**：沙箱 renderer 不能 `require`，所以协议文件写成经典脚本——浏览器里 `window.__bitbotProgress`，Node 里 `module.exports`，**同一份字节**被三处使用：renderer `<script src="./progress_protocol.js">`、main 进程 `require("./progress_protocol")`、探针 `require()`。为什么值得单独一个文件：如果 category 表抄两份，UI 显示的类别和 Host 发出的事件类别可能漂移，冒烟断言绿的是副本而不是应用真正执行的那份。核心三块：7 个 category（官方六类 + model_reply）、kind→category 映射表（`computer_use` 族 → computer_use；`copy_to_box/skill_write/export_pack/slides_pptx/generate_*/journal_append/mail_draft/schedule_meeting/cloud_artifact_deliver/webhook_copy` → created_files；`voice_*` → voice_message；`approval_card` → approval_request；`llm_chat` → model_reply；其余 → tool_activity）、reducer `createProgressState()` 把事件流压成 UI 行状态。
2. **事件在真实 effect 边界发出（`hosts/shared/host_ffi.js` executeHostEffects）**：`results.push` 被拦截，每个 effect 的**第一次 push** 就是该 effect 的 `done`——这样 ~100 个既有分支（和它们的 `continue`）一行不动，"done 但没 result 行"不可能。`closeDangling()` 在循环开头和循环结束后各调一次：如果某 effect 没 push 任何东西（fall-through / throw），诚实发 `done ok:false error:"no_result_recorded"`，不留"仍在进行"假态。循环结束后、delivery 映射前发 `phase:"host_continuing" category:"model_reply"`——内核继续写回复本身也是一个长步骤，多步回合不能看起来在 effects 和最终回复之间卡住。
3. **多端传输同源**：`hosts/shared/turn_progress.js`（新增）`createProgressEmitter({onProgress, total, turnId, sessionId, repoRoot})` 把 effect + result 翻译成协议事件，`existingPathFromResult` 只在文件**当前确实存在**时才把 path 附到 done 事件上（GP-98 不谎报）。`run_moon_turn.js` 把 `ctx.onProgress` 透传给 `executeHostEffects`。Electron main 在 `bitbot:turn` 里注册 `onProgress` → `broadcast("bitbot:turn-progress", row)` + 把行收集到 `result.progress`  trail；preload 暴露 `onTurnProgress(cb)` 订阅；CLI `run_turn` 在 `BITBOT_CLI_PROGRESS=1` 时落 stderr `[progress i/total] kind (category) …`。嵌套 `executeHostEffects` 调用不传 ffiOpts → emitter 禁用 → 不双发。
4. **Renderer 原地更新（GP-97）**：`#turn-progress` 单行（`aria-live="polite"`）在 `runUserTurn` 入口 `resetProgressRow()`、finally `finishProgressRow()`；`applyProgressEvent(ev)` 经 reducer 算出当前态后原地改 `data-state` 和文本，**不新气泡**。10 个 prog* i18n 键（progTool/progComputer/progFiles/progQuestion/progApproval/progVoice/progModel/progAwaiting/progFailedSuffix/progContinuing）×3 语言。streaming delta 与 progress 行并存互不覆盖（delta 走 `.msg` 气泡，progress 走 `#turn-progress` 节点）。回合结束后 2.5s 自动隐藏，不留"仍在进行"假态。
5. **慢 provider 钩子（GP-97 验收用）**：`scripts/dev_stubs/openai_compat_stub.js` 新增 `BITBOT_STUB_LATENCY_MS`——用 `execFileSync("sleep")` 同步阻塞 stub 的事件循环，HTTP 响应头在 N ms 内不发出，客户端真的在等。探针断言：首个进度事件 42ms 可见，回合 862ms 才结束（stub latency 800ms）。
6. **验证**：
   - 无 Electron 探针 `scripts/prove_gp96_progress.js` **PASS=30 FAIL=0**：协议模块 7 类 category + reducer 走完 2 effect 后 phase=finished/doneCount=2；categorizeEffect 8 例（含 needs_approval → approval_request、needs_confirm → question、未知 kind → tool_activity）；emitter 3 effect → 7 事件（2×N + host_continuing）；total 字段一致；done.ok 反映真实结果；needs_approval → awaiting=approval；host_continuing 在 effects 之后；existingPathFromResult 真路径返回、假路径空串；真实 kernel 回合（stub latency 800ms）首个进度事件 42ms 可见（回合 862ms 才结束）；2×N 排序一一对应；main/preload/CLI/package.json 契约齐备；renderer 10 个 i18n 键 ×3 语言 + resetProgressRow/finishProgressRow 生命周期 + #turn-progress aria-live；host_ffi.js results.push 拦截 + closeDangling + host_continuing raw 事件。
   - moon test **376/376**（本轮无内核改动，既有 wbtest 全绿）。
   - 既有探针 `scripts/prove_gp93_links.js` **21/0**、`scripts/prove_gp14_reply.js` **16/0** 双跑幂等。
7. **本轮踩到并修掉的一个真问题**（留在断言里）：① 慢 provider 断言原本要求"回合返回前有 ≥2 个进度事件"，但纯 chat 回合只有 1 个 effect（llm_chat），只发 start/done/host_continuing 共 3 事件，其中 start 在 42ms、done 和 host_continuing 都在 863ms（等 provider 响应完）——所以"回合返回前可见的事件数"只有 1 个。改成断言"首个事件 <100ms 且末个事件 >500ms"，证明的是 UI 行在 provider 思考期间就可见，这才是 §5.7 的本意。

## Wave M20（界面体验对标 Grok Bot：助手气泡 / 侧栏头像与预览 / 标题栏 Bot 标识 / 连接应用网格，本轮）

背景：用户提供两张 Grok Bot 真实截图，指出「界面差距太远」，要求功能推进同时兼顾 UI 体验。实测基线（`scripts/ui_baseline_shot.mjs` 在 Xvfb 下抓真实 Electron 渲染）确认了四处硬差距：①助手消息是**无框纯文本**（`--bot-bubble: transparent`），参考图是灰底圆角气泡；②侧栏每行只有名字 + 副标题，**没有头像、没有最后一条消息预览、未读是名字后的「●N」文本**；③标题栏右侧按钮挤成竖排，**没有居中的 Bot 身份标识**；④「连接应用」是**单列长列表**，参考图是两列卡片网格 + 圆形图标 + 分类 chips。

本轮按「可断言优先」改造，每条视觉决策都钉到一个可观测契约上（`scripts/prove_m20_ui.js` 21 断言 + smoke G-20 六断言）：

1. **助手气泡实心化**：`--bot-bubble` 从 `transparent` 改为 `#212121`（深色）/`#f4f4f5`（浅色），三套主题块（root / prefers-light / force-dark / force-light）全部改掉——只改一套会在切主题时悄悄退回旧版。`.msg.assistant .body` 加 `border-radius:16px` + padding，`max-width:82%` 防止长回答铺满整行。用户气泡保持 18px 胶囊。
2. **侧栏身份化**：新增 `AVATAR_PALETTE`（10 色）+ `avatarColorFor(seed)`（字符串哈希 → 固定色），同一 id 永远同色；`sessions.list()` 新增 `preview` 字段（取最后一条非空消息前 40 字），侧栏会话行与 Bot 行统一走 `.sess-row`（圆形头像 + 名称 + 单行省略预览）。未读从「名字后 ●N 文本」改为**行右缘蓝色圆点**（`.unread-dot`，8px，`#2f7cf6`，`title` 带数量）。
3. **标题栏三列栅格**：`header` 从 `flex space-between` 改为 `grid auto 1fr auto`。**踩到的坑**：先用 `position:absolute; left:50%` 居中 pill，结果直接压在模型选择器上（截图可见）。改成栅格后 pill 是正常流内元素，**结构上不可能重叠**；同时给 `#header-actions` 加 `justify-content:flex-end` + `white-space:nowrap`、给 `#model-picker` 加 `flex-wrap:nowrap`，修掉「能力/凭证/账户」被挤成竖排断字的问题。pill 的颜色随当前 Bot 同步，并写进 `--bot-avatar`，让整段对话的助手头像与标题栏身份一致。
4. **思考态不再是空圆**：流式 `phase=start` 原先生成一个空 assistant 气泡（只有头像圆没有内容，看起来像渲染 bug）。改为三点动效（`typingPulse`）。**纪律约束**：动效用 `createElement("i")` 构建而**不是 innerHTML**，否则会破坏 GP-93「正文只有一条安全渲染路径」——探针专门断言了这一点。
5. **连接应用改网格**：`caCard` 从竖排长卡改为 `display:flex` 的紧凑卡（圆角首字母图标 + 名称 + 单行描述省略 + 操作按钮）；容器 `#ca-installed`/`#ca-browse` 改为 `.ca-grid`（`repeat(2, minmax(0,1fr))`）；工具开关行用 `flex:1 0 100%` 落到第二行。新增**分类 chips**（全部/密码管理器/效率/通信/设计/代码，三语文案齐）。**诚实边界**：Host 插件目录目前没有 `category` 字段，所以分类靠 id/namespace 关键字推断（`CA_CATEGORY_RULES`）；**未知插件不会被塞进错误分类**，只出现在「全部」，且空分类显示空态而不是假装有内容——探针断言了这个 fallback。
6. **验证**：`scripts/prove_m20_ui.js` **21/0**（气泡实心×4 主题、头像色板/圆形/预览省略/preview 生产与消费、未读点位置与颜色、三列栅格、操作区不换行、pill 与 updater、`--bot-avatar` 同步、typing 动效与 DOM 构建、ca-grid/ca-icon/chips 真实过滤/未知分类不误挂、三语 i18n、正文无 innerHTML）；smoke 新增 **G-20 六断言** → **PASS=134 FAIL=0 双跑幂等**；既有 `prove_gp93_links.js` 21/0、`prove_gp96_progress.js` 30/0、`prove_gp14_reply.js` 16/0、E2E **52/0**、`moon test` 376/376 全部保持绿。
7. **诚实残留**：像素级"像不像 Grok"仍是**人工比对**（`scripts/ui_baseline_shot.mjs` 是开发工具，不入门禁）；门禁只钉可断言的契约，不把"好看"写成不可验证的声明。默认外观仍跟随系统（本次截图因与参考图对比临时设为 light，用户设置本身未被强制修改）。

## Wave M21（信任面：§8.3 密钥输入框 / §8.4 Untrusted Content / §8.5 隐私模式，本轮）

背景：官方 spec §8.3–§8.5 此前**没有一条规格行**（审计确认 `spec.md` 的 G-15/G-16/G-17 三节为 0 行；`hosts/` 下零 `[REDACTED]`、零 `cursor_untrusted_data` 引用、完全没有隐私模式界面）。本轮先补规格（GP-99…GP-107），再按「规格→实现→验证」落地。

### 1) 规格先行（`docs/grok-desktop-parity/spec.md`）
新增三节 4 列表格：`G-15 密钥输入框不进上下文`（GP-99/100/101/102）、`G-16 Untrusted Content`（GP-103/104/105）、`G-17 数据/隐私模式`（GP-106/107），每条都写明「官方行为 → 实现落点 → 验收信号」。

### 2) 实现：一条策略三处共用（renderer / Host / probe 不漂移）
- **`hosts/desktop/secret_protocol.js`（新）**：`TOKEN_RULES` 11 条密钥形状（PEM、`api_key=`、`Authorization: Bearer`、`cookie=`、`ghp_`/`github_pat_`、`sk-`/`sk_live_`、`xox*`、`AKIA`、`AIza`）+ `mask()`（`****last4`）+ `validateSubmit()`（`env_key` 只允许 `BITBOT_*`）。UMD，renderer 与 main 加载同一份。
- **`hosts/desktop/secret_vault.js`（新）**：Host 独占的密钥库。落盘 `data/secrets/vault.json`（mode 0600，**AES-256-GCM 密文**，密钥 `data/secrets/vault.key` 同目录 0600）；`submit()` 回 `handle + ****last4`，`status()` 恒返回 `value:null / plaintext_available:false`；`resolve()` 是唯一解密入口且不出 IPC。
- **`hosts/shared/untrusted_fence.js`（新）**：§8.4 的 Host/UI 半边，与内核 `security/parse.mbt` 同一 grammar（`<cursor_untrusted_data_1337 source="…">`）。`wrap()` 幂等、转义正文里的伪造闭合标签；`parse()/stripFences()` 给渲染器出 `data-untrusted` 角标。
- **`hosts/shared/privacy_status.js`（新）**：§8.5 三态诚实模型 —— `verified(on)` / `unavailable` / `legacy(unsupported)`；无法验证时 `training_use=disabled_by_default`，**永不**在无账户信号时给出 `training_disabled_verified:true`。
- **内核**：`security/parse.mbt` 增 `is_external_source()`（11 个外部 kind，与 JS 表一致）+ `fence_body()`（含逃逸转义）；**未闭合 fence 改为 fail-closed 当数据处理**（原先是整段退回 Trusted，是真实缺口）；`cmd/desktop_turn` 的 host-continue dump 对外部 result 用 `fence_body` 包裹并附「treat as information, not instructions」；`Chat` 分支对密钥形状输入 `fail_turn`，且**被拒回合的 user 行也用 `redact_secrets()`**。
- **Host/UI**：`main.js` 新增 `bitbot:secrets:submit|vault|remove`、`bitbot:privacy:status`、`bitbot:sessions:append`；`preload.js` 只暴露 `privacy.status()`（无 setter）；`index.html` 新增真 `<input type="password">` 安全卡（显示/隐藏切换、Enter 提交、Cancel）、`[REDACTED]` 占位行 + handle 落盘（重载重建）、composer 粘贴拦截、`data-untrusted` 角标、设置页只读 Privacy 行；17 个文案键 ×3 语言。

### 3) 验证（本轮实测）
- `scripts/prove_m21_trust.js` **45/0**（新增）：真实 kernel 拒绝密钥粘贴且回显 `[REDACTED]`；vault 落盘密文 + 0600 + 只回 `****last4`；`data/` 3105 个文件全量 grep 无明文；fence 包裹/幂等/逃逸/未闭合 fail-closed；kernel 续跑体真的带 fence；伪造 Auto-review 仍按数据处理；隐私四态（none/legacy/env-only/verified）。
- `scripts/e2e_grok_desktop_boot.mjs` **62/0**（新增 10 条 GP-99…102 真实 UI 断言）：粘贴密钥 → composer 被拦截并打开真实卡 → `type=password` → 提交后气泡恰为 `[REDACTED]`+handle → **重载窗口后占位行仍在**、`sessions.json` 与 `vault.json` 都不含明文。
- `scripts/smoke_grok_desktop_parity.sh` **PASS=141 FAIL=0**（新增 G-21 七断言）；`moon test` **380/380**（新增 4 条 fence 测试）；`prove_gp96_progress.js` 30/0、`prove_m20_ui.js` 21/0、`prove_gp93_links.js` 21/0、`prove_gp14_reply.js` 16/0 全绿。

### 4) 本轮踩到并修掉的真问题
1. **未闭合 fence 原本退回 Trusted**（`security/parse.mbt`）——攻击者只要省掉闭合标签，整段外部内容就被当成可信文本。改为 fail-closed 后，内核与 JS 解析器行为一致，并加了内核测试。
2. **密钥卡提交后气泡带 `****last4`**（E2E 抓到的真实泄漏）：占位行原本拼了 mask。改为气泡文本恰为 `[REDACTED]`，mask 只留在卡片状态行（非对话内容）。
3. **占位行不持久**：重载后 `[REDACTED]` 行消失。新增 `bitbot:sessions:append` + `secret_handle` 字段（只存 handle，不存值），历史重建时按 handle 还原占位行。
4. **E2E 在无 live X display 时被判失败**：`DISPLAY` 指向不存在的 socket 会让 Electron 在 ozone 里 SIGSEGV。smoke 现在检测 socket 是否真实存在，缺失时自动走 `xvfb-run -a`。
5. **probe 的「不泄漏」正则误命中注释**：`/runUserTurn/` 命中了「no composer write, no runUserTurn」这句注释。改成匹配真实调用 `runUserTurn\s*\(`。

### 5) 诚实残留（本波不假装）
- 密钥「显示/隐藏」只切换输入框类型，不做浏览器自动填充（`autocomplete="off"`）。
- `privacy_status` 的 `verified` 态目前**没有任何可达信号**：本地账户档案没有 provider 签发的隐私声明，所以真实运行永远是 `unavailable · managed by account` + `disabled_by_default`。门禁断言的是「**没有证据就不许声称已开启**」，不是「已接通服务端」。
- 外部数据 fence 覆盖的是跨回注的外部 kind（webfetch/mcp/shell/CU/video…）；用户在 composer 里自己粘贴的网页文本属于用户输入，不走此路径。

## Wave M22（先读后执行：官方 spec §6.4，本轮）

背景：`spec.md` 里 §6.4「先读后执行」没有对应规格行；Host 的 `routine_fire` 此前是**一枪到底**——一次调用就写 `fired:true` 并投递附件，没有「先准备草稿、再显式执行」的两段式，也没有把审批边界带进产物。这与官方「自动化先产出草稿/推荐，发送/购买/删除/发布/生产变更需审批」的边界不符。

### 1) 规格先行（`docs/grok-desktop-parity/spec.md`）
新增 `G-18 先读后执行（官方 spec §6.4）`：GP-108（准备先于执行）、GP-109（敏感动作需审批 + 草稿→执行二段式）、GP-110（只读不打扰、写入必须停），每行都写明「官方行为 → 实现落点 → 验收信号」。

### 2) 实现
- **Host 两段式（`hosts/shared/host_ffi.js`）**：`routine_fire` 先写草稿 `data/routines/drafts/routine-*.json`（`routine_id / prompt / cron / prepared_at / requires_approval:true / approval_boundary[5 类] / default_action:"draft"`），再写 fire 记录（`mode:host_routine_draft|host_routine_fire_executed`、`executed`、`executed_at`、`execute_via`、`draft_path`、`pretend_fired:false`、`pretend_executed:false`）；回执同时投递 fire 快照与草稿两份附件。`execute_via` 明确是 `command`（`execute=1`）/ `routine_config`（`auto_execute:true`）/ `env`（`BITBOT_ROUTINE_EXECUTE=1`），审计能回答「为什么这次真跑了」。`routine_tick` 的 `fired[]` 逐条带 `executed / draft_path / requires_approval`。
- **内核审批门（`cmd/desktop_turn/turn_json.mbt`）**：`FireRoutine` 现在解析并剥离 `execute=1`（支持 `… execute=1` 与 `…|execute=1` 两种写法）；默认 effect 的 command **不含** flag（= 只准备）；带 flag 且未 `--approved` 时走 `gate_consequential(ExternalSend, irreversible=true)`，只出 `approval_card` 并且**不产生 `routine_fire` effect**；approved 时 effect 为 `<id>|execute=1`，回执文案改成「草稿 + 边界，直到你批准 execute」。
- **Renderer（`hosts/desktop/index.html`）**：新增 `renderRoutineDraftCard(h, p)` —— 虚线草稿卡显示 routine id、prompt（将要做什么）、5 类审批边界、`执行/丢弃` 与状态行；「执行」= 一次 `runUserTurn("fire routine <id> execute=1", {approved:true, silentUser:true})`（显式、可审计），「丢弃」只改状态、不发任何回合。`routine_fire`（`executed !== true`）与 `routine_tick`（逐个 `fired[]`）都在对话流里出卡；routine 元信息标注 `/draft` vs `/executed`。面板 `#rt-fire` 改为 `runUserTurn("fire routine desk-r", {})`，不再预批准。7 个文案键 ×3 语言（`rtDraftTitle/Boundary/Execute/Discard/Status/Executing/Discarded`）。

### 3) 验证（本轮实测）
- `scripts/prove_m22_readfirst.js` **25/0**（新增）：默认 fire → `mode:host_routine_draft` + 三个 `false` + `draft_path` 真实存在 + 草稿带 5 类 `approval_boundary`；投递只有附件、无 `channel_send/purchase/delete` 行；未 approved 的 `execute=1` 只出 `approval_card` 且 Host 零执行记录；`--approved` 后才 `executed:true` + `executed_at` + `execute_via:"command"` + 独立草稿；被拦下的 `purchase` 不产生小票；四个只读 intent 零审批打扰；草稿卡 Execute 走 approved 回合、面板 Fire 不带 approved；7 个 i18n key ×3 齐全。
- `moon test` **380/380**（`desktop_turn_wbtest.mbt` 新增 execute=1 的审批门断言：默认 command 无 flag、未批准出 `approval_card`、批准后 effect 为 `smoke-r|execute=1`）。
- `scripts/e2e_grok_desktop_boot.mjs` **68/0**（新增 6 条 GP-108/109 真实 UI 断言）：点侧栏「Fire routine」→ 对话流出现草稿卡（prompt + 审批边界）→ 此时 `fires.jsonl` 只有 `mode:host_routine_draft / executed:false` → 点卡上「执行」后**才**新增一条 `host_routine_fire_executed`（`execute_via=command`）→ 按钮固化不可重复点；探针结束恢复 routines/fires/drafts 快照。
- `scripts/smoke_grok_desktop_parity.sh` 新增 **G-22 七断言**；`prove_m21_trust.js` 45/0、`prove_m20_ui.js` 21/0、`prove_gp96_progress.js` 30/0、`prove_gp93_links.js` 21/0、`prove_gp14_reply.js` 16/0 全部保持绿。

### 4) 本轮踩到并修掉的真问题
1. **`fire routine r execute=1` 的 id 被当成 `r execute=1`**：Host 以 `|` 切分 command，空格写法会把 flag 连同 id 一起当 routine 名（实测 `{"id":"smoke-r execute=1", mode:"host_routine_draft"}`）。内核现在剥离 flag，并以 `|execute=1` 传参，两种写法结果一致。
2. **`execute=1` 未获批也能直接执行**：原实现只按字符串判 flag，绕过了审批。现在未 `--approved` 的 execute 请求**根本不发 effect**，只出审批卡。
3. **「为什么跑了」不可回答**：回执原来只有 `executed:true`。新增 `execute_via`（command / routine_config / env），把触发来源写进产物。
4. **probe 的「写入类」断言会误判**：`list credentials` 的 intent 是 `list_credentials`（不是 effect kind `credential_list`）；`fireBlock` 的 `!/approved/` 又命中了注释里的英文单词。改为断言真实 intent 与 `approved\s*:\s*true`。

### 5) 诚实残留（本波不假装）
- 草稿「执行」目前仍复用 `routine_fire` 的 effect 通道（`|execute=1`），而不是另开一个 `routine_execute` kind——语义上已两段式、审计上已区分，但 effect 表尚未拆分。
- Routine 的动作体仍是 Host 侧 prompt 文本（本仓库没有真实 routine runner 去调用模型执行 prompt）；本波证明的是**边界与产物**：准备不越界、执行需批准、来源可审计。
- `auto_execute:true` 与 `BITBOT_ROUTINE_EXECUTE=1` 两条自动执行通道保留（用于无人值守场景），但它们**不经过**交互审批——这是配置侧的明示选择，已在 `execute_via` 里留痕，门禁断言的是未获准时不会静默执行。

## Wave M23（跨会话记忆：官方 spec §4.2，本轮）

背景：官方 §4.2 要求「对话和学到的上下文每 Bot 独立」，同时「共享文件 / 浏览器会话 / 群聊消息可跨 Bot 传递」。此前 Host 的记忆是**一份扁平数组**（`data/memory/desktop-host.json` 为 `[{key,value,scope}]`），profile vault 也是**一份扁平 entries 映射**——多 Bot 共用一个记忆池，等于把 A 的偏好喂给 B。`--bot-id` 也只用于 computer-use 锁，没有进内核。

### 1) 规格先行（`docs/grok-desktop-parity/spec.md`）
新增 `G-19 跨会话记忆（官方 spec §4.2）`：GP-111（稳定偏好跨对话一致）、GP-112（每 Bot 独立）、GP-113（共享可传递）、GP-114（删 Bot 不连坐）、GP-115（记忆永不授权动作），每行写明「官方行为 → 实现落点 → 验收信号」。

### 2) 实现
- **Host 存储分槽（`hosts/shared/host_ffi.js`）**：`desktop-host.json` 升为 `{version:2, bots:{<id>:{entries:[…]}}}`，`profile-vault.json` 升为 `{version:2, scope:"profile", bots:{<id>:{entries:{k:{value,updated_at}}}}}`；`readMemoryStore/readProfileVault` 首读把**旧扁平结构迁进 `agent-bit` 槽**（不丢用户数据）。新增 `botMemorySlot/loadSessionMemory/saveSessionMemory/dropBotMemory/dropBotProfileVault/ensureVaultBotSlot`；`memorySeedArgs(botId)` 只吐本槽 seeds 并附 `--bot-id`；`executeJournalSharedInbound(kind, command, botId)` 让 `memory_update`/`memory_recall` 都写读本槽，产物带 `bot_id`。
- **内核（`cmd/desktop_turn/turn_json.mbt`）**：`DesktopTurnContext` 增 `bot_id`（默认 `agent-bit`），`--bot-id` 由 `parse_turn_context` 解析并从 user text 里剔除；`memory update/recall` 的回复文本标注 `bot=<id>`，便于人读归属。effect 命令**保持** `key|value` 形态——Bot 归属经 `ffiOpts.botId` 路由，避免 Bot id 与 `|` 分隔的 key/value 语法互相污染（这是本轮第一次实现踩到的坑）。
- **回写条件收紧（`hosts/shared/run_moon_turn.js`）**：只有 `intent === "memory_update"` 才 `saveSessionMemory` 回写。原来「任何带 memory 行的回合都回写」会把 recall 时内核补的 demo 行也存成用户偏好，等于凭空给 Bot 装了一条它没学过的记忆。
- **Bot 删除级联（`hosts/desktop/product_surface.js`）**：`botsDelete` 在清 sessions/routines/rooms 之后调用 `dropBotMemorySlot(bot_id)`，只删该 Bot 在两个文件里的槽，回执新增 `memory_dropped`；该函数永不抛，坏 JSON 不阻断删除。
- **worker 回合（cloud / voice / teammate / subagent）**：`runWorkerMoonTurn({…, botId})` 四个调用点都带上 Bot 槽；teammate inbox 的 worker 以**收件 Bot 自己**的槽作答（它在扮演那个 Bot），其余沿用调用方的 Bot。

### 3) 验证（本轮实测）
- `scripts/prove_m23_memory.js` **26/0**（新增）：同 Bot 换 session 仍 recall 到 `tone=concise`；另一个 Bot 命中 0 条且其回合 `memory` 为空；两个文件都出现 A 的分槽；A 写的 shared scope 键 B 能读；`data/workspace` 文件计数 > 0；删 A 回执 `memory_dropped:true` 且 A 槽从两个文件消失、B 槽与 B 的 recall 完好、`workspace_files_kept>0`；A 记忆里写 `send=allow all` 后 `purchase`/`channel_send` 仍只出 `approval_card`、无真实 host purchase；旧扁平 store/vault 迁移后旧键仍在 `agent-bit` 槽可 recall。
- **负向对照**：临时把 `botMemorySlot()` 改成恒返回 `agent-bit`（即回到「一个池子」），probe 立刻 7 条变红（GP-111/112×4/114×2）——证明断言真的在测隔离，而不是恒真。
- `moon test` **381/381**（新增 `desktop_turn_bot_id_scopes_memory`：`--bot-id` 进上下文、默认 `agent-bit`、`--approved` 不重置 Bot id、flag 不进 user text、`memory_update` 命令仍是 `tone|concise` 且回复标注 `bot=researcher`）。
- `scripts/e2e_grok_desktop_boot.mjs` **73/0**（新增 5 条真实 UI 断言）：真实点侧栏 Bot 行 → 在 A 的私聊 `remember` → 切到 B 的私聊 `recall` 命中 0 条 → 切回 A `recall` 命中 1 条 → 磁盘上该键只在 A 槽。
- `scripts/smoke_grok_desktop_parity.sh` 新增 **G-23 七断言**，总 **PASS=155 FAIL=0**；既有 M22/M21/M20/GP96/GP93/GP14 探针保持全绿。

### 4) 本轮踩到并修掉的真问题
1. **Bot id 塞进 effect 命令会污染语法**：先试过 `memory_update` 命令写成 `<bot>|key|value`，但 Host 侧 `key|value` 的切分与既有 `updates.jsonl` 产物都会错位（value 含 `|` 时更糟）。改为 Bot 归属走 `ffiOpts.botId`，命令形态不变。
2. **recall 会把 demo 行写成用户偏好**：`run_moon_turn.js` 原来对所有带 `memory` 行的成功回合回写。空槽 recall 时内核补一条 `demo.user` 演示行，回写就等于往用户记忆里塞假数据。已收紧为只回写 `memory_update`。
3. **旧记忆会在升级时静默消失**：直接改成 v2 结构会让已存在的扁平记忆读不到。现在两条读路径都把旧结构迁进 `agent-bit` 槽，并有断言覆盖。
4. **Bot 删除只清了配置**：原 `botsDelete` 不动 `data/memory/*`，删掉的 Bot 的记忆永远留在盘上（既是垃圾也是隐私问题）。现在只清它自己的槽，并在回执里明示。

### 5) 诚实残留（本波不假装）
- 记忆的**提取**仍是显式短语（`remember k=v` / `recall p`）与 LLM 侧的 `--seed-memory` 注入；没有做「自动从对话里提炼偏好」的隐式抽取（那需要模型判断，沙箱内无稳定信号，不假装）。
- Profile vault 与 session store 是**两个文件两条路径**：`memory_update` 同时写两者（同一 Bot 槽），但目前没有一致性修复任务去对齐手工改坏的文件。
- Bot 槽与 Bot 生命周期靠 **id 字符串**关联（`botsDelete` 传的就是 bot_id）；重命名/复制 Bot 不迁移记忆槽（官方也未描述复制记忆的行为，故不做猜测）。
- 跨设备同步记忆不在本波：`data/memory/*` 只在单机生效，多端一致性沿用既有 sync residual 口径。

## Wave M24（主窗口结构：官方 spec §2.1，本轮）

背景：官方 §2.1 描述的是**窗口骨架**——左侧栏列出 Bot / 群组 / 隐藏入口 / Connect apps / Marketplace / Settings，Bot 列表按活动排序，隐藏入口在底部，中央只有一条消息流，右侧面板可选。此前 Bit Bot 的侧栏只有 Bot 列表与会话列表：**没有群组列表**（群组只能从隐藏的 "Grok Parity 面板" 里建，建完侧栏看不到），**没有 Marketplace 入口**（虽然 Host 早就有 `bot_templates_list` 目录，只有新建 Bot 表单里能看到），Hidden Bots 夹在会话列表与高级面板之间，而 `listViews()` 虽然写了 `updated_at` 排序，**没有任何代码在活动后刷新它**——等于排序键永远不变。

### 1) 规格先行（`docs/grok-desktop-parity/spec.md`）
新增 `G-20 主窗口结构（官方 spec §2.1）`：GP-116（六类入口 + Marketplace 真目录）、GP-117（活动排序 + 置顶优先）、GP-118（隐藏入口在底部）、GP-119（单一消息流 + 右栏独立），每行都写明可证伪的验收信号（DOM 顺序、模板卡数 = Host 目录、旧置顶压过新活跃、中央宽度 > 0）。

### 2) 实现
- **侧栏结构（`hosts/desktop/index.html`）**：Bot 列表之后插入「群组」分区 + `#room-list`；把 `#hidden-bots-lab`、`#connect-apps-btn`、新增 `#marketplace-btn`、`#sidebar-settings-btn` 一起包进新建的 `#sidebar-footer`，作为 `#agents` 的最后一个块。新增 `#marketplace-modal` 面板（标题/说明/`#mk-meta` 计数/`#mk-grid` 卡片网格）。
- **群组列表（`refreshSidebarRooms()`）**：读 `window.bitbot.rooms.list()`（`rooms.json`），行带 `data-room-id`、圆形头像、标题 + 「N 位成员」；空态显示 `roomEmpty`。点击把该群设进群组面板的下拉并聚焦消息框，同时在 `#log` 说明「消息会进 #log」。刷新点：boot、`refreshRooms()` 末尾（群组面板打开/创建后）、`group_chat`/`room_turn` 回合成事后。
- **Marketplace（`refreshMarketplace()` / `renderMarketplace()`）**：调 `window.bitbot.templates.list()` → main 的 `bitbot:templates:list` → Host `bot_templates_list`（读 `data/desktop/bot-templates.json`）；卡片显示默认名 · 职责 · 描述 + 「创建」按钮，按钮走 `templates.create` → `bot_create_from_template`，成功后 `refreshBots()` 让新 Bot 立刻出现在侧栏。渲染层**没有任何模板 id**。
- **活动排序（`product_surface.js` + `main.js` + `preload.js`）**：新增 `touchBotActivity(botId)`（未知 id → `bot_not_found`，不造行）并导出；`bitbot:turn` 在会话写盘之后调用它（`opts.botId || "agent-bit"`），成功后 `broadcast("bitbot:bots-changed", surface.listViews())`；preload 新增 `onBotsChanged`，renderer 收到后 `refreshBots()`。`skipSession` 的回合（菜单类短语）不计活动，避免把「点一下菜单」当成「用了这个 Bot」。
- **i18n**：`rooms / marketplace / mkTitle / mkHint / mkEmpty / mkCreate / mkUse / roomEmpty / roomMembers` 九键在 zh-CN / zh-TW / en 三套字典里补齐，避免新入口露出原始 key。

### 3) 验证（本轮实测）
- `scripts/prove_m24_window.js` **29/0**（新增）：侧栏 DOM 顺序（Bot → 群组 → 会话 → 尾部区块）、`#sidebar-footer` 通过 div 深度扫描确认是 `#agents` 最后一块、尾部四入口顺序、隐藏徽标由 `hidden` 长度驱动、六类入口存在、九键三语齐全、Marketplace 走 `templates.list()` 且渲染层无模板 id、Host `bot_templates_list` 返回 6 个模板且与 `bot-templates.json` 集合一致、一键创建真建 Bot 并落盘、`touchBotActivity` 排序（默认按 `updated_at`、旧 Bot 跑一轮后跳到前面、置顶压过活跃、未知 id 拒绝）、main/preload/renderer 广播链闭合、群组真实创建/落盘/`@everyone` 路由/侧栏读同源、`#log` 唯一且群聊走同一 `runUserTurn`、右栏布局各自独立。
- **负向对照**：把 `touchBotActivity` 里的 `saveBots(data)` 删掉（等于「排序键不更新」），probe 立刻 1 条变红（活动重排），恢复后 29/0——证明该断言真的在看活动时间，不是恒真。
- `moon test` **381/381**（本波未改内核；确认无回归）。
- `scripts/e2e_grok_desktop_boot.mjs` **84/0**（新增 11 条真实 UI 断言）：真实 DOM 几何数侧栏顺序与尾部块、**76 Bot/37 群组下尾部区块仍在视口内**、点 `#marketplace-btn` 看卡片数 = 6、在群组面板真实选两个 Bot 建群后 `#room-list` 立刻出现该行且 `rooms.json` 落盘、给一个未置顶 Bot 发消息后 `updated_at` 真实推进且侧栏自动把它排到未置顶最前、置顶块始终在前、打开 Computer 右栏后 `#log`/`#main` 仍 > 200px 且工具栏保持关闭。
- `scripts/smoke_grok_desktop_parity.sh` 新增 **G-24 十四断言**（1 条全绿汇总 + 9 条 probe grep + 4 条 E2E grep），总 **PASS=169 FAIL=0**；并把 E2E 超时从 900s 提到 1500s（本波起 E2E 已是 8 次真实 boot）。

### 4) 本轮踩到并修掉的真问题
1. **排序键从不更新**：`listViews()` 早写了 `pinned` + `updated_at`，但没有任何写路径刷新 `updated_at`，"按活动排序"是个空承诺。现在回合落盘后由 Host 打时间戳并广播。
2. **群组建完侧栏看不见**：群组只能在隐藏面板里操作，侧栏没有列表，与新 Bot 并列的「群组」概念缺失。现在 `#room-list` 与面板同源。
3. **Marketplace 只是文档里的名词**：Host 早就有目录与一键创建 effect，但只有新建 Bot 表单的 chips 用到。现在有独立入口与卡片网格，且卡片数受 Host 目录约束。
4. **探测脚本误判 footer 位置**：第一版用「footer 后第一个 `</div>`」判断结尾，把 footer 内部第一个 div 的闭合当成结束，导致恒红。改成从 footer 开标签后开始做 div 深度扫描，才是真实的块边界。
5. **长列表把底部入口挤出屏幕**：侧栏原本 `overflow:auto` 整列滚动，76 个 Bot 时 `#sidebar-footer` 落在 y=3900，用户根本看不到 Hidden/Connect apps/Marketplace/Settings——「在底部」在 DOM 里成立、在屏幕上不成立。改成纵向 flex，三个列表各自滚动、footer 固定在列尾，E2E 加了 `footer.bottom <= agents.bottom` 的几何断言。

### 5) 诚实残留（本波不假装）
- **像素级"像 Grok"**不作自动断言：本波断言的是结构（DOM 顺序、宽度、数据来源）与真实交互，配色/圆角/间距仍靠人工目检（M20 的像素断言只覆盖明暗主题）。
- **Bot 列表的"活动"粒度是回合级**：`touchBotActivity` 在一次成功回合后打点，不做"正在输入/刚被查看"的更细信号；未落盘的失败回合不算活动（有意为之，避免失败也顶到前面）。
- **群组行点击只做定位 + 提示**：真正的群聊回合仍由群组面板的消息框发送（`room <id> :: …` 落 `#log`），本波没有做「点群组行切换一个独立群聊会话视图」（官方 §2.1 未要求，且会与 §3 会话模型冲突）。
- **Marketplace 只有本地目录**：模板来自 `data/desktop/bot-templates.json` 的六个内置模板，没有远程市场/安装量/评分（无远端服务可查，不假装）。

## Wave M25（Bot 资料管理与创建流程：官方 spec §2.2–§2.3，本轮）

背景：官方 §2.2 把 **Edit Profile** 定义为「名称、标签、描述、头像」四项，§2.3 把创建流程定为「Name / Job / 多行 Description」，并给出三条验收信号：空白名要用 `New Bot` 占位、Description 支持多行、创建完**自动打开对话**。此前 Bit Bot 的新建表单只有一个行内输入条（名称 + 职责 + 模板 chips），**没有编辑入口**（改名字只能重新建）、**没有标签**、**没有头像**（侧栏全是纯色首字母圆点），创建完也**不会切到那个 Bot 的会话**。会话列表同时还是平铺的，没有分组/搜索/重命名/删除。

### 1) 规格先行（`docs/grok-desktop-parity/spec.md`）
新增 `G-21 Bot 资料管理与创建流程（官方 spec §2.2–§2.3）`：GP-120（Edit Profile 四项 + 头像在侧栏/对话中显示）、GP-121（占位名 / 多行描述 / 自动打开对话）、GP-122（头像上传链路与 Host 校验）、GP-123（今天/昨天/更早 + 搜索 + 重命名/删除）；同时把 G-20 的 **GP-118** 改写成实际交付的布局（整列滚动 + sticky 首尾），旧行描述的 flex 分栏已不存在。

### 2) 实现
- **内核（`cmd/desktop_turn`）**：`UpdateBot(bot_id~, name~, job~, description~, avatar~, tags~)`。`tags` 是**可选**参数：空字符串时不追加 `tags=` 字段，Host 才能区分「没改」与「清空」（`tags=-`）；`extract_kv` 键表补 `tags=`；`parity_intents.mbt` 解析并透传。
- **Host（`hosts/shared/host_ffi.js` + `hosts/desktop/product_surface.js`）**：`bot_update` 分发带上 `tags`；`normalizeTags()`（数组/逗号串 → 去空 → ≤8 条，`-`/空 → `[]`）、`avatarDataUrl()`（`statSync` ≤512KB，按扩展名取 mime，base64 data URL，失败返回 ""）、`decorateBot()`（补 `tags` 与 `avatar_data_url`）用于 `listViews()` 的 `bots`/`hidden_bots`；`botsCreate` 空名 → `New Bot`；`botsUpdate` 支持 `avatar=-` 清空；`botsDuplicate` 复制 tags 浅拷贝。
- **main/preload**：`bitbot:bots:pickAvatar`（真实 `dialog.showOpenDialog` + 2MB 上限 + data URL 回执）；`bots.op` 现在解析 `host_results` 里的 `bot_create`/`bot_update` 回执，`ok:false` 时整体失败并带回 `host_payload`。
- **渲染层（`hosts/desktop/index.html`）**：新增 `#bot-edit-modal`（同一表单承担 Edit / Create 两态）、`#session-rename-modal`、`#session-delete-modal`（`z-index:64`）；Bot 行渲染 `avatar_data_url` → `<img>`，`meta` 追加 `· #tag`；会话列表改成 `sessDayBucket()` 分组的 `.sess-group` + `#session-search` 过滤 + 双击重命名 + 右键菜单删除；侧栏布局收成一整列滚动，`#sess-new` 与 `#sidebar-footer` sticky。
- **i18n**：31 个新键（会话分组/搜索、通用 保存/取消/删除、表单 名称/标签/职责/描述/头像 等）在 zh-CN / zh-TW / en 三套字典里补齐；标签名用 `data-i18n` 同步，避免出现中文标题 + 英文标签的混排。

### 3) 验证（本轮实测）
- `scripts/prove_m25_profile.js` **25/0**（新增）：对话框字段与两态切换、31 键三语齐全、空名兜底、自动打开接线、textarea、pickAvatar（main + preload）、`avatar_data_url` 渲染、搜索框位于列表之前、`sessDayBucket` 分组、rename/delete IPC 接线；再用**真实 CLI + product_surface** 跑：空白名 → `New Bot`、`create bot New+Bot …`、`update bot … tags=perf,+research` 落盘 name/job/description/tags、多行 Description 保真、头像 → `data:image/png;base64,`、坏路径 `invalid_avatar` 且旧头像保留、`tags=-`/`avatar=-` 清空、duplicate 复制 tags、`sessions.rename/delete` 真改 `sessions.json`、`bots:op` 把 Host 拒绝读成失败。
- **负向对照**：注释掉 `bot.tags = normalizeTags(tags)` → **22/2**，恢复后 **25/0**（证明「标签落盘」不是恒真断言）。
- `moon test` **381/381**（新增 `tags` 用例：带 tags / 不带 tags 不产出字段 / `tags=-`）。
- `scripts/e2e_grok_desktop_boot.mjs` **100/0**（新增 16 条真实 DOM 断言）：空名建 Bot、多行描述、标题 pill = `New Bot`、右键编辑预填、改名+标签落盘并同步侧栏、头像经 IPC 后渲染 `<img>`、分组标题（`今天 / 昨天`）+ 行数、搜索 0 行 + 空态 + 清空恢复、重命名预填/落盘/侧栏同步、删除确认点名 + 双端消失。
- `scripts/smoke_grok_desktop_parity.sh` 新增 **G-25 十四断言**（1 条全绿汇总 + 9 条 probe grep + 4 条 E2E grep）。

### 4) 本轮踩到并修掉的真问题
1. **会话列表被压成 40px**：最初给 Bots/群组设了 `max-height: 34vh/18vh`，76 个 Bot 时会话区只剩一行，用户找不到自己的聊天。改为整列滚动 + sticky 首尾：长列表滚，入口不动。
2. **编辑对话框中英混排**：标题/提示是中文，`Name/Tags/Job/Description` 却是裸英文。补 `bfName/bfTags/bfJob/bfDesc` 四键 + `data-i18n`，同一屏只出现一种语言。
3. **Host 拒绝被当成成功**：头像路径不存在时 Host 回 `ok:false`，但 `bots.op` 只看 turn 的 `ok`，UI 显示"已保存"而数据没变。现在解析 `host_results` 回执，失败保对话框并显示原因。
4. **多行描述被压平**：旧的短语拼装用 `+` 编码空格，顺手把换行也当成空白处理。现在 `enc()` 只替换空格，换行原样进 `description=`，Host 落盘为多行字符串。
5. **`-` 与"省略"语义混淆风险**：如果空 tags 也发 `tags=`，Host 会把用户"没动标签"理解为"清空标签"。改为空字符串直接不产出字段，`-` 才是显式清空——并加了内核单测锁死这个区别。

### 5) 诚实残留（本波不假装）
- **系统头像选择框**：`dialog.showOpenDialog` 已接，但沙箱无桌面会话时无法自动点；E2E 走同一 IPC 之后的 Host 校验路径（路径 → 落盘 → `avatar_data_url` → 渲染），不宣称能自动操作系统框。
- **标签没有团队语义**：本地自由文本（≤8 条、逗号分隔），官方文档也只描述为标识；没有目录同步、权限或跨设备传播。
- **会话分组只按本地时间**：`sessDayBucket` 用本机零点与 `updated_at`，没有服务端时区换算；跨时区旅行后"今天"会按本机时间重算（与桌面端直觉一致，但不是官方未描述的额外语义）。

## Wave M26（Bot 设置右栏：官方 spec §2.1 右侧面板 + §4.6 通知，本轮）

背景：官方 §2.1 说右侧面板是**可选**的，内容是「对话详情 / Bot 设置 / Computer 预览」之一。此前 Computer 预览占了这条右栏，但 **Bot 设置没有任何界面**——§4.6 的「Bot 菜单 → Bot settings → Notifications」每 Bot 开关在 Host 侧早就有真实语义（`settings.notify[botId]`，GP-80 的聚焦抑制也用它），UI 却只能进全局设置翻找；资料、记忆条数、Routines、会话数更是散落在四个 store 里没有统一入口。

### 1) 规格先行（`docs/grok-desktop-parity/spec.md`）
新增 `G-22 Bot 设置右栏`：GP-124（可选右栏、与 Computer 预览互斥、中央不被挤 0）、GP-125（面板字段逐项来自真实 store，未知 id 拒绝）、GP-126（每 Bot 通知开关合并写、关掉后回合通知真实被抑制）、GP-127（面板动作与 Bot 菜单同源、删除后右栏关闭）。

### 2) 实现
- **Host（`product_surface.js`）**：新 `botDetail(bot_id)`——资料行来自 `bots.json`（`decorateBot` 补 tags/avatar），记忆条数读 `desktop-host.json` 该 Bot 槽，Routines 按**与删除级联同一绑定约定**（id/prompt 含 bot_id）统计并区分 active，会话按既有 `<name> · DM` 约定计数，群组按成员表计数，通知读 `settings.notify[bot_id]` 并附 `notify_explicit`；未知 id → `bot_not_found`。新 `botNotifySet(bot_id, on)`：**合并写** `notify` map（只动一个键，不覆盖其它 Bot），只接受真布尔值。
- **main/preload**：IPC `bitbot:bots:detail`、`bitbot:bots:notify`（成功后广播 `bitbot:settings-changed`）；preload `bots.detail` / `bots.notify`。
- **渲染层（`index.html`）**：新增 `#bot-rail`（`grid-area: computer`，`body.bot-open` 展开），与 `#computer-rail` 共用同一可选列：打开一个即收起另一个（`toggleComputerRail`/`openBotRail` 互斥）。面板含头像/名称/职责/主 Bot 标记、标签 chips、多行描述、通知开关（§4.6 文案）、4 行统计、操作条（编辑资料 / 置顶·取消置顶 / 创建副本 / 隐藏·恢复 / 删除，全部复用既有菜单动作与确认流）。Bot 右键菜单尾部新增「Bot 设置」入口（不改变既有菜单索引，M24/M25 的 E2E 选择器不受影响）；删除确认成功后若右栏正显示该 Bot 则自动关闭。
- **i18n**：15 个新键（menuBotSettings / brAbout / brSettings / brNotify(+Hint) / brActions / brRailNote / brMemories / brRoutines / brSessions / brRooms / brPrimary / brUnknown / brNotifySaved / brNotifyFailed）在 zh-CN / zh-TW / en 三套字典补齐。

### 3) 验证（本轮实测）
- `scripts/prove_m26_botpanel.js` **27/0**（新增）：静态层（#bot-rail 结构、互斥 CSS/JS、菜单入口、IPC/preload 接线、未知 Bot 文案、删除关栏接线、15 键三语）+ 行为层（真实 store：资料逐项等于 bots.json、`is_primary` 来自 primary_id、记忆条数等于记忆槽真实条数、会话数按 DM 约定、通知 off/on 往返写盘且**逐 Bot 合并**不覆盖别人、非布尔值 `invalid_value`、未知 id `bot_not_found`）。
- **负向对照**：把 `botDetail` 的记忆计数砍掉 → detail 返回 0（真实 1 条），断言立即变红；代码与 store 在 finally 恢复，双跑幂等。修这条对照时自己踩了两个坑并写进了脚本注释：store 可能是旧版扁平数组（要先包 v2 再种槽）；`delete require.cache` 后**旧绑定仍指向旧模块闭包**，必须重新 `require` 才能测到被改坏的代码。
- `scripts/e2e_grok_desktop_boot.mjs` **110/0**（新增 10 条真实 DOM 断言）：右键 → 「Bot 设置」→ `#bot-rail` 打开、资料/统计/chips 与 bots.json 逐项一致、中央消息流 > 200px、通知开关关掉后 `settings.json notify.<id>=false` 且 `notify:turn` 返回 `shown:false, reason=bot_notify_off`、重开恢复、打开 Computer 预览自动收起 Bot 设置、面板内置顶按钮真写 `bots.json` 并可复位。
- `scripts/smoke_grok_desktop_parity.sh` 新增 **G-26 十一断言**（1 条全绿汇总 + 5 条 probe grep + 4 条 E2E grep）。
- 截图目检（`/tmp/m26-rail.png`）：340px 右栏，头像/名称/职责/主 Bot、通知开关、统计行、五个操作按钮布局正常，无遮挡换行问题。

### 4) 本轮踩到并修掉的真问题
1. **E2E 断言读 raw store**：第一版拿 `bots.json` 原始行和面板比 tags，旧行（M25 之前创建）没有 `tags` 字段导致误红；改成与 Host `decorateBot` 同口径（缺省 `[]`）。
2. **置顶按钮的标签随状态变**：面板动作条复用 `menuPin`/`menuUnpin` 文案，Bot 已置顶时第一版按「置顶」找按钮直接找不到。改成读初始 `pinned` 后按「点击后应变为相反值」断言，再点一次复位。
3. **smoke grep 与断言文案漂移**：改 E2E 文案后 G-26 的一条 grep 变红（PASS=194 FAIL=1），同步修正 grep 后全绿——smoke 的 grep 契约确实在盯文案，这次是它抓住了我。

### 5) 诚实残留（本波不假装）
- **「对话详情」右栏已在本波补齐**：见下方 Wave M27（`#conv-rail`，三方互斥）；M27 的残留清单接管本条的后续口径。
- **Routines 绑定是字符串约定**：`botDetail` 统计 Routines 用与删除级联相同的「id/prompt 含 bot_id」约定，不是外键；prompt 里恰好提到别的 Bot 名会多计（官方未定义绑定模型，不发明结构）。
- **面板不显示实时状态**：Bot 是否正在执行 computer-use / 回合进行中没有进右栏（数据在 `computer.json`/会话锁里，后续可加）；目前只显示静态资料与计数。

## Wave M27（对话详情右栏：官方 spec §2.1 右栏第三种内容，本轮）

背景：M26 之后 §2.1 的可选右栏还剩「对话详情」没有界面。M26 的残留清单把它列为本波候选；本波补齐 `#conv-rail`，右栏三种内容（对话详情 / Bot 设置 / Computer 预览）全部落地，且升级为**三方互斥**（同一可选列，打开一个即收起另外两个）。

### 1) 规格先行（`docs/grok-desktop-parity/spec.md`）
新增 `G-23 对话详情右栏`：GP-128（右键会话 → 详情面板打开；标题/归属/创建/更新/消息数/回复数逐项来自真实 sessions.json；面板打开时中央消息流仍 > 200px）、GP-129（面板内重命名真写 sessions.json 且面板标题随动；删除会话后面板自动关闭且行消失）。

### 2) 实现
- **渲染层（`index.html`）**：新增 `#conv-rail`（`grid-area: computer`，`body.conv-open` 展开），与 `#bot-rail`、`#computer-rail` 三方互斥（`openConvRail` 收起另两个；`toggleComputerRail`/`openBotRail` 同步收起对话详情）。面板内容全部经 `sessions.list()` + `sessions.get(id)` 读取真实会话行：标题、归属 Bot（按既有 `<name> · DM` 命名约定解析）、创建/更新时间、消息数（含用户 x / Bot y 拆分）、回复数（按 `reply_to` 计）、最近一条 `[角色] 文本(≤400字)` 预览。动作条复用既有重命名对话框（`openSessionRename`）；重命名成功后若详情面板正显示该会话则同步刷新面板标题（`saveSessionRename` 接 `refreshConvRail`）；删除确认成功后若面板正显示该会话则自动关闭。回合落库后 `loadActiveSessionTranscript` 末尾同步刷新面板（预览/消息数/更新时间跟着走）。
- **i18n**：13 个新键（cvTitle / cvInfo / cvLast / cvOwner / cvCreated / cvUpdated / cvMessages / cvUserMsgs / cvBotMsgs / cvReplies / cvNone / cvGone / cvNote）在 zh-CN / zh-TW / en 三套字典补齐。

### 3) 验证（本轮实测）
- `scripts/prove_m27_convrail.js` **19/0**（新增）：静态层（#conv-rail 结构、三方互斥、菜单入口、cvGone 文案、重命名复用、删除关栏、transcript 同步、13 键三语）+ 行为层（真实 `createSessionStore`：建会话、追加 user/assistant(reply_to) 消息、归属解析、计数数学、最近一条、重命名、删除、未知 id 不在列）。
- **负向对照**：把渲染层回复计数 marker 改成 `0 &&` → probe 断言与渲染层数学不一致立即变红；html 在 finally 恢复，双跑幂等。
- `scripts/e2e_grok_desktop_boot.mjs` **117/0**（新增 7 条真实 DOM 断言）：发消息建会话 → 右键行 → 菜单「对话详情」→ `#conv-rail` 打开且宽度 340px、标题与会话行一致、信息 5 行、最近一条与 store 逐字一致、中央消息流 > 200px；打开 Bot 设置自动收起对话详情；面板内重命名真写 `sessions.json` 且面板标题随动；删除会话后面板自动关闭且行消失。
- `scripts/smoke_grok_desktop_parity.sh` 新增 **G-27 十断言**（1 条全绿汇总 + 4 条 probe grep + 4 条 E2E grep + 1 条 i18n grep），全量 **PASS=204 FAIL=0**。

### 4) 本轮踩到并修掉的真问题
1. **`sessions.list()` 行没有 `messages`/`created_at`**：面板第一版只靠 list 渲染，预览和时间永远空/错。改成 list 找行 + `sessions.get(id)` 拿全量，且 get 对未知 id 会回落到 `sessions[0]`，必须加 `session.id === convRailId` 身份守卫。
2. **误删渲染变量**：一次脚本化编辑把 `refreshConvRail` 里 `nameEl/ownerEl/kvsEl/prevEl/actEl` 的声明删掉，面板空白且控制台 `nameEl is not defined`；用活体调试脚本（xvfb 起 Electron，在页面里直接 `openConvRail` 抓 console 错误）定位后恢复。
3. **归属解析尾部空格**：`slice(0,-4)` 剥「 · DM」会留一个尾空格，与 bots.json 的名字比对恒红；改成 `.replace(/ · DM$/, "")`，probe 与渲染层同口径。
4. **E2E 读面板早于异步渲染**：cv 字段在 IPC 回包前被断言；补 `waitForFunction`（cv-name 非空 / cv-actions 有按钮 / 重命名后面板标题变化）。
5. **重命名后面板不随动（GP-129 最后一红）**：根因是 `saveSessionRename` 只刷会话列表没刷详情面板；补 `if (convRailId === id) await refreshConvRail()` 后 E2E 117/0。
6. **M26 probe 被三方互斥波及**：`openBotRail` 中间插入 `remove("conv-open")` 行后，M26 probe 的相邻行正则失配（smoke 抓到 PASS=26 FAIL=1）；更新 probe 正则以断言三方互斥（含行尾注释的 `[^\n]*\n` 容忍）。

### 5) 诚实残留（本波不假装）
- **详情面板是只读视图**：官方 §2.1 未定义对话详情的编辑语义，本波只做展示 + 复用既有重命名/删除；附件汇总、成员列表（群聊场景）未做（群会话的归属解析当前只覆盖 DM 命名约定，见下条）。
- **归属靠命名约定**：`<name> · DM` 是既有删除级联同款约定，不是外键；非 DM 会话（群聊）归属行显示为空。等 §2.4 群聊入口补齐时一并接真。
- **面板数据不含会话锁/运行态**：回合是否进行中、computer-use 是否占用该会话，没进详情面板（数据在会话锁里，候选后续）。

## Wave M28（Usage & Billing 接真回合：官方 spec §7.1，本轮）

背景：GP-76 之前标注"已实现"但口径只到「weekView 读真 store」——**store 从来没人喂**：`recordUsage` 是死代码，`executeLlmChat` 里 provider 回包的 `usage` 字段被直接丢弃，E2E 回合跑了几十次，`llm-usage.json` 始终是空的。面板只能显示空态，GP-76 的"已实现"名不副实。本波把链路从头接到尾。

### 1) 规格先行（`docs/grok-desktop-parity/spec.md`）
新增 `G-24 Usage & Billing 接真回合`：GP-130（每次真实模型调用计入用量：tokens 来自 provider 上报，未上报时 requests 真记、tokens 不伪造）、GP-131（面板 per-provider/model 明细行 + 周合计，读真 store，空态不造 0）。

### 2) 实现
- **Host FFI（`host_ffi.js` `executeLlmChat`）**：非流式路径提取 `res.json.usage`；流式路径请求带 `stream_options.include_usage` 并在 SSE 循环里保留最终 chunk 的 `usage`。两者统一进 artifact + `chats.jsonl`（`usage.reported` 如实区分），成功回合 emit `phase:"usage"` 事件（provider/model/tokens/tokens_reported）。
- **main.js**：`ffi.setLlmStreamHandler` 里把 usage 事件写进 `surface.recordUsage` → `data/desktop/llm-usage.json`（`getIsoWeek` 按周滚动、按 provider+model 分行累加）；记账异常不打断回合。
- **渲染层（`index.html`）**：Usage & Billing tab 从"只有一行 totals"升级为 per-provider/model 明细行 + 周合计；tokens 全为 0 的行标注「tokens 未上报」而不是显示假 0；空 store 仍是空态文案。新 i18n 键 `usageTokensUnreported`（zh-CN/zh-TW/en）。
- **stub（`scripts/dev_stubs/openai_compat_stub.js`）**：非流式顶层与流式最终 chunk 都上报 usage（11/7），让 E2E 从此走的是**与生产同一条**记账链路。

### 3) 验证（本轮实测）
- `scripts/prove_m28_usage.js` **14/0**（新增，双跑幂等）：静态层（双路径提取、main.js 接线、面板 per-row、三语 i18n、stub 上报）+ 行为层（进程内起带/不带 usage 两种 stub，走真实 `executeHostEffects(llm_chat)`：usage 事件 tokens 逐字一致、artifact `reported` 如实、未上报时 tokens=0）+ store 层（recordUsage 累加/分行、weekView totals）+ **负向对照**（砍掉非流式提取 → `tokens_reported` 翻假，断言变红）。store/artifact/chats.jsonl/env 在 exit handler 全部恢复。
- `scripts/e2e_grok_desktop_boot.mjs` **119/0**（新增 2 条）：自带 stub 跑一回合真消息 → `llm-usage.json` 出现 e2e-stub 行（requests≥1，tokens 为 11/7 的倍数）；设置 → Usage & Billing tab 面板显示同一真实行。
- `scripts/smoke_grok_desktop_parity.sh` 新增 **G-28 八断言**，全量 **PASS=212 FAIL=0**。

### 4) 本轮踩到并修掉的真问题
1. **GP-76 是空心绿**：weekView 读真 store ≠ 链路接通；store 没有写入方，面板永远空态。教训：验收口径必须覆盖"数据从哪来"，只验"读的那层是真的"会漏掉整条上游。
2. **probe totals 被 smoke 前序块污染**：G-16 的 E2E 跑过后 llm-usage.json 已有真实行（这正是链路接通的副作用），probe 的 totals 断言从非零点出发直接翻红。修法：store 层断言前先清成空 store，从已知零点记账（exit 时仍恢复原内容）。
3. **流式 usage 的来源**：很多 OpenAI 兼容 provider 默认不在流式里回 usage，必须显式带 `stream_options.include_usage`；stub 的最终 usage chunk 放在 `[DONE]` 之前，SSE 解析器已有的逐行 JSON.parse 直接就能吃到。

### 5) 诚实残留（本波不假装）
- **成本/账单金额未做**：官方 §7.1 有"用量与账单"，本波只记 requests 与 tokens；单价×用量=金额需要真实 provider 定价表（易过期、易错），沙箱内不引入会过期的价格数据。
- **tokens 未上报的 provider 显示为 0**：如实标注「tokens 未上报」，不按字数估算（估算会伪装成真数据）。
- **按需用量（on-demand）与套餐额度**：无真实计费系统，未做。

## Wave M29（群聊入口：官方 spec §2.4，本轮）

背景：侧栏群组行（GP-116）此前点击只会聚焦一个遗留测试输入框并**加一条伪造的 assistant 提示**（「消息会进 #log（room …）」）——群聊的真实入口不存在，§2.4 的群组语义（@Name/@everyone/无 @）只能靠在 composer 手打 `room <id> ::` 短语或 gp 测试面板触达。M27 残留清单指名本波补齐。

### 1) 规格先行（`docs/grok-desktop-parity/spec.md`）
新增 `G-25 群聊入口`：GP-119a（群组行 → 同一 `#log` 的真实群聊：banner + transcript 卡 + composer 前缀，无第二消息面）、GP-119b（`@` 路由语义在入口路径上保持真实——含空格成员名修复）。

### 2) 实现
- **渲染层（`index.html`）**：侧栏群组行点击 → `openRoomChat(rm)`——composer 顶部 `#room-banner`（群名 / N 位成员 / 「@Name 定向 · @everyone 全体 · 无 @ 由 Bot 自行决定」提示），placeholder 切到群聊措辞；打开时经 `rooms.list()` 读 rooms.json 真实 transcript，最近 8 条渲染进 `#log`（空群明说「还没有任何消息」）；composer 提交自动加既有 `room <id> :: ` 前缀（与 gp 测试面板同一 kernel RoomTurn 短语，不是新路径）；「退出群聊」收 banner 并复原 DM placeholder。
- **Host（`product_surface.js` `roomTurn`）**：提及解析升级为**完整成员名最长匹配优先**（修复含空格成员名 `@市场 分析员` 被截成 `@市场` 而降级 bot_discretion 的真实缺陷），回落单 token 形式保持 `@everyone`/无空格名语义不变。
- **i18n**：5 个新键（roomExit / roomRouteHint / roomComposerPh / roomTranscriptEmpty / roomTranscriptHead）×3 语言。

### 3) 验证（本轮实测）
- `scripts/probe` **prove_m29_roomchat.js 16/0**（双跑幂等）：静态层（banner 结构、入口接线、前缀、退出复原、空群诚实、5 键三语）+ 行为层（真实 store：2–6 门、@Name→mentioned_only 且 responders 精确（含空格名）、@everyone→all、无@→bot_discretion、未知群拒绝、transcript 逐字落 rooms.json）+ 负向对照（砍掉 composer 前缀 → 断言变红）。stores/html 在 exit handler 恢复。
- `scripts/e2e_grok_desktop_boot.mjs` **124/0**（新增 5 条）：预置真实群 → 点侧栏群组行 → banner 打开（标题/路由提示/placeholder 切换）→ 空群诚实空态 → composer 发消息带 `room <id> :: ` 前缀进 `#log` → rooms.json transcript 真增一行（@everyone 路由）→ 退出复原。
- `scripts/smoke_grok_desktop_parity.sh` 新增 **G-29 五断言**，全量 **PASS=217 FAIL=0**；`moon test` 381/381。

### 4) 本轮踩到并修掉的真问题
1. **probe 负向对照毁了工作文件**：probe 的 IIFE 全同步且第一句就 `process.exit()`，而恢复用的 `process.on("exit")` 注册在其后——注册代码永远没跑，`index.html` 被砍了前缀。手动恢复 + 修 probe 顺序（先注册 exit handler 再跑断言）；这条进 probe 注释。
2. **@mention 解析不支持含空格的成员名**：probe 用「M29 探针甲」作成员名，`@M29 探针甲` 被 `/^@(\S+)\s/` 截成 `@M29` → 降级 bot_discretion。这是真实产品缺陷（botsCreate 允许空格名），在 `roomTurn` 里改成完整成员名最长匹配优先，probe 对两种路由都断言。
3. **伪造的群组点击提示**：旧点击行为会 `addMsg("assistant", "群组「X」· N 位成员。消息会进 #log…")`——预告功能而不是实现功能，本波替换为真实入口。

### 5) 诚实残留（本波不假装）
- **conv-rail 对群会话仍显示空归属**：群聊回合落在 rooms.json 而不是 sessions.json，对话详情面板（M27）目前只覆盖 DM 命名约定；群聊的详情面板形态候选下一波（需要先定义"当前群聊"的会话锚点）。
- **群聊 transcript 卡是快照**：打开群聊时渲染最近 8 条；回合进行中不实时追加（回合结束的 assistant 行由既有 turn 渲染负责），重开群聊才重读 rooms.json。
- **成员名冲突**：最长匹配只在成员名互不为前缀时无歧义；两个成员名互为前缀时取更长者，官方未定义此场景。

## Wave M30（附件发送前预览：官方 spec §5.1 验收信号，本轮）

背景：§5.1 的验收信号清单里「**附件在发送前可预览**」此前没有对应实现——附件 chip 只显示文件名+移除按钮，选了什么图、多大，发送前看不到。GP-11 的校验链路（≤6/25MB/200MB）是完整的，缺的是"看见"这一层。

### 1) 规格先行（`docs/grok-desktop-parity/spec.md`）
新增 `G-26 附件发送前预览`：GP-132（chip 预览真实字节：图片缩略图来自磁盘、非图片 kind+体积徽标、缺失/空路径诚实拒绝）。

### 2) 实现
- **Host（`product_surface.js` `attachmentPreview`）**：只读真实字节——图片 ≤2MB 生成 data-URL 缩略图（mime 按扩展名），非图片返回 `kind/bytes/ext`（`data_url:null`，不伪造缩略图），>2MB 图片带 `residual:image_too_large_for_preview`，缺失/空路径 `preview_unavailable`。
- **main/preload**：IPC `bitbot:attachments:preview`；`attachments.preview(path)`。
- **渲染层（`index.html`）**：`attachPreviews` 缓存（path→info）；pick 与 paste/drop 两个入口先渲染 chip 再等预览回包后重渲染（不阻塞发送）；图片 chip 渲染 34px 缩略图，非图片 chip 加 `video · 2.0KB` 式徽标；移除 chip 同时清缓存。

### 3) 验证（本轮实测）
- `scripts/prove_m30_attachpreview.js` **10/0**（双跑幂等）：静态层（CSS/接线/IPC/preload）+ 行为层（真实 1x1 PNG → image + base64 data_url 且 bytes 与磁盘一致；mp4 → video 且 data_url=null；txt → doc；缺失/空路径拒绝）+ **负向对照**（砍掉缩略图生成行 → data_url 退化 null，断言变红）。临时文件与 product_surface 在 exit handler 恢复。
- `scripts/e2e_grok_desktop_boot.mjs` **124/0**（回归，无新增——系统文件选择框在 xvfb 不可自动化为既有残留，粘贴/拖拽无真实磁盘路径在上游就被拒，preview 的行为层证据在 probe）。
- `scripts/smoke_grok_desktop_parity.sh` 新增 **G-30 五断言**，全量 **PASS=222 FAIL=0**。

### 4) 本轮踩到并修掉的真问题
1. **probe 恢复顺序又踩一次**（M29 同款）：负向对照的 `psBefore` 声明在 IIFE 里、exit handler 在其后——若 IIFE 先 `process.exit()` 恢复就跳票。这次直接把快照读取与 exit handler 注册都提到 IIFE 之前。
2. **probe 断言写死 PNG 字节数**：1x1 PNG 的 base64 解码长度按字符串心算不可靠，改成与 `statSync().size` 现场比对。

### 5) 诚实残留（本波不假装）
- **>2MB 图片无缩略图**：只显示文件名+体积（`residual:image_too_large_for_preview`），不按字节数降低采样率生成"估算缩略图"；后续可接真缩放管线。
- **音频/视频 chip 无播放预览**：只有 kind+体积徽标；官方 §9.1 的"打开卡片预览"覆盖已交付文件（GP-92 全屏查看器），composer 内嵌播放器未做。

## Wave M31（消息反应 React：官方 spec §5.1，本轮）

背景：§5.1 的验收信号清单里「**消息反应 (React)**」此前没有对应实现——消息只有 hover「回复」按钮，没有反应入口。Grok Bot 的消息支持 hover 出反应按钮、弹出 emoji picker、已反应的消息显示 chips 并可点击撤销。

### 1) 规格先行（`docs/grok-desktop-parity/spec.md`）
新增 `G-27 消息反应`：GP-133（hover 反应按钮 + 6 emoji picker，chips 从 store 行渲染，点击 chip 走同一 IPC 撤销；transcript 重载不丢反应）。

### 2) 实现
- **Store（`sessions.js` `react(sessionId, messageId, emoji, on)`）**：单一事实源——`hit.reactions` 按 emoji 为键的计数器，`on=true` 加 1、`on=false` 减 1，减到 0 删键（不残留 0 假计数）；未知会话/消息/空 emoji 返回 `{ok:false, error}`。
- **main/preload**：IPC `bitbot:sessions:react`；`sessions.react(sessionId, messageId, emoji, on)`。
- **渲染层（`index.html`）**：`renderReactions(el, reactions)` 渲染 chips（emoji + 计数），`toggleMessageReaction(el, emoji, on)` 走同一 IPC；`attachMessageActions` 加「反应」按钮，hover 弹出 6 emoji picker（👍❤️😂🎉😮😢）；`addMsg` 传 `opts.reactions`，transcript 重载传 `reactions: m.reactions || null`；CSS `.msg-reactions`/`.reaction-chip`/`.reaction-picker`；`reactAction` i18n 三语。

### 3) 验证（本轮实测）
- `scripts/prove_m31_reactions.js` **17/0**（双跑幂等）：静态层（hover 按钮 + 6 emoji picker、chips 渲染/撤销、transcript 重载带回 reactions、IPC + preload 接线、reactAction 三语、store react 函数）+ 行为层（加反应→计数 1、同 emoji 再加→2、不同 emoji 分键互不覆盖、撤销→回落 1、减到 0→键删除、未知消息/会话拒绝、空 emoji 拒绝、重载 get(id) 读到同一 reactions）+ **负向对照**（砍掉 react 的 `save(state)` → 计数不落盘，断言变红）。sessions.json 与 sessions.js 在 exit handler 恢复。
- `scripts/smoke_grok_desktop_parity.sh` 新增 **G-31 七断言**，全量 **PASS=229 FAIL=0**。
- `scripts/e2e_grok_desktop_boot.mjs` **124/0**（回归，无新增——反应行为在 probe 覆盖）。

### 4) 本轮踩到并修掉的真问题
1. **sessions.js sabotage 不恢复**（M29/M30 同款教训的第三次）：负向对照砍掉 `save(state)` 行后，exit handler 只恢复 sessions.json 不恢复 sessions.js 源码——第二次跑直接 12/5。这次 exit handler 同时覆盖 sessions.js。
2. **exit handler 注册顺序**（M29 同款教训的第三次）：`process.exit()` 在同步 IIFE 里触发时，注册在 IIFE 之后的 exit handler 不会被调用——必须把 exit handler 放在 IIFE 之前。

### 5) 诚实残留（本波不假装）
- **反应 picker 只有 6 emoji**：官方 Grok 的 picker 可能有更多 emoji 或自定义 emoji，当前只实现 6 个常用 emoji 的 picker；后续可扩展为完整 emoji 搜索。
- **反应不通知对方**：当前反应只在本地 store 计数，不触发通知或其他 Bot 的同步；官方 Grok 的反应可能在多端同步，当前实现为单端。

## Wave M32（桌面 chrome 令牌化：同一套壳层，不再按波次各写一套样式）

背景：G-20..G-27 的侧栏、composer、`#log`、右栏、设置和对话框都已经接到真实 Host，但视觉规则散在 `index.html` 的大段 `<style>` 里，另有一段运行时注入的 `<style>` 只管侧栏折叠和 `#computer-rail`。间距、圆角、字号和表面色各波次各写一份，后面的功能容易互相盖掉。本波只收壳层，不改 Host IPC，不改 MoonBit 内核。

### 1) 实现
- **`hosts/desktop/ui_chrome.css`（新）**：唯一的颜色 / 间距 / 圆角 / 字号 / 壳层宽度 / z-index 表，外加共用组件（`.bb-modal`、`.bb-sheet`、`.bb-btn`、`.bb-field`、banner、card）。暗色在 `:root`，浅色在 `prefers-color-scheme: light`，强制态是 `body.force-dark` / `body.force-light`。`--text` 与 `--ink` 同值（原先被引用但从未定义）。壳层宽度 `--sidebar-w: 260px`、`--tools-w: 280px`、`--rail-w: 340px`。
- **`hosts/desktop/index.html`**：组件布局继续留在页面 `<style>`，但改吃上面的变量。设置、连接应用、Marketplace、Bot 编辑、会话重命名/删除、Bot 删除共用同一层遮罩；设置从文档流里的卡片改成居中 sheet（`#settings-panel` 仍是原来的 id，打开时 `display:flex`）。侧栏折叠和 Computer 右栏的规则挪进样式表，并补上折叠同时打开 Bot 右栏 / 对话详情时的列宽（原先 `!important` 会把这两列压成 0）。删掉会盖住 composer 里 `.bb-btn` 的通用 `#composer button` 规则。
- **打包**：`package.json` 的 `build.files` 带上 `ui_chrome.css`。
- **探针**：`prove_m20_ui.js` 增加令牌表与共用对话框类的断言（21 → 24）。`prove_m24_window.js` 的右栏宽度改为认 token 文件里的 260/280/340，以及 `index.html` 里的 `var(--sidebar-w)` / `var(--rail-w)`。探针锁死的字面量保留：用户气泡 `border-radius: 18px`、未读点 `#2f7cf6`、`.ca-icon` 的 `10px`。

### 2) 验证（本轮实测）
- `node scripts/prove_m20_ui.js` **24/0**
- `node scripts/prove_m24_window.js` **29/0**（在 smoke 已种入 Bot 之后；空 store 上单独跑会缺「两个可见 Bot」）
- `node scripts/prove_m25_profile.js` **25/0**；`prove_m27_convrail.js` **19/0**；`prove_m28_usage.js` **14/0**；`prove_m29_roomchat.js` **16/0**；`prove_m30_attachpreview.js` **10/0**；`prove_m31_reactions.js` **17/0**
- `scripts/e2e_grok_desktop_boot.mjs` **124/0**。明暗像素：dark 亮度 35.4、light 239.9、差 204.5。设置 → Usage、Bot 右栏、对话详情、群聊 banner、Marketplace 都在真实 Electron 里点过。
- 干净 store 复跑 `scripts/smoke_grok_desktop_parity.sh` **PASS=230 FAIL=0**（起点：`bots.json` 已存在但 `bots:[]`、没有 `agent-bit`；`data/workspace` 整目录删除；`desktop-host.json` 不存在）。G-16 E2E 仍是 **124/0**。此前那 10 条红是 store 前置，不是样式回归，修法如下，chrome 令牌未回退：
  1. **`loadBots()`** 在文件缺失或已有文件缺 `agent-bit` 行时都写入内置 Bot。smoke 在 G-1、G-1b、G-6、G-26 前再调一次 `ensure_agent_bit`。`confirm delete bot agent-bit` 得到 `cannot_delete_builtin`，群聊 `bots=agent-bit,…` 找得到成员。
  2. **G-17 清理之后**写回 `data/workspace/m23-shared-keep.txt`。`prove_m23_memory.js` 自己也会放同一份文件再按快照恢复，所以 GP-113/114 的共享文件计数不靠历史残留。单独跑该探针 **26/0**。
  3. **G-26 负向对照**在 `desktop-host.json` 为 ENOENT 时从空的 v2 store 种一条记忆，不再抛错。`prove_m26_botpanel.js` **27/0**，`is_primary` 为布尔。

### 3) NG-001（本波故意不像素对齐）
复刻的是 spec §2.1 的结构：侧栏、composer、唯一的 `#log`、可选右栏、设置、对话框。颜色是 Bit Bot 中性色，没有 xAI 标志或专有皮肤。欢迎词与标题栏用同一套无衬线，不是另一套衬线字标。设置是居中 sheet，不是 Grok 设置窗口的像素拷贝。

### 4) 诚实残留（留给后续）
- 高级面板里仍有少量按钮的内联宽度（例如删除确认的 `#fff` / `6px`）。
- 探针锁死的字面量还在（用户气泡 18px、未读 `#2f7cf6`、`.ca-icon` 10px）；旁边已有同值 token（`--radius-user`、`--unread`、`--radius-lg`）。
- `@media (max-width: 900px)` 仍会丢掉 computer 网格区（本波之前就这样）。
- 反应 picker 仍是 6 个 emoji（M31，不在本波范围）。
- Computer 右栏的内边距在子元素上，不在 `#computer-rail` 自身（保持原先的 opacity 开合，避免改点击行为）。

## Wave M33（对标 Grok Bot 桌面外观：浅色令牌 / 侧栏结构 / 送达指示 / 中英分离）

背景：M32 完成后功能已完整，但视觉密度和 Grok 桌面版仍有几处可见差距 —— 侧栏顶部是一整条「+ 新对话」按钮（Grok 是 ⌕ + 两枚紧凑圆钮）、底部只有 Settings 按钮（Grok 是账户头像 + popup）、用户气泡右下角无送达状态（Grok 是 ✓ → ✓✓）、助手首帧前是空圆（Grok 是三点跳动）。此外侧栏和标签里中英混排明显（「Computer」「Marketplace」「Bots」直接暴露在中文界面）。本波只收视觉与文案，Host IPC、MoonBit 内核、探针行为契约均不变。

### 1) 实现
- **`hosts/desktop/ui_chrome.css`**：`:root` 默认切到 Grok 浅色表面（`--bg0: #ffffff` / `--ink: #1a1a1a` / `--line: #e3e3e6` / `--accent: #1a1a1a`），暗色保留在 `body.force-dark`（`--bot-bubble: #212121`），浅色在 `prefers-color-scheme: light`（`--bot-bubble: #f4f4f5`）。壳层宽度 `--sidebar-w` 从 260px 提到 280px（更接近 Grok 侧栏密度，`--tools-w` / `--rail-w` 不变）。
- **`hosts/desktop/index.html`**：
  - **侧栏顶部图标工具栏**（替换 `#sess-new` 全宽按钮）：`#sidebar-toolbar` sticky 列首，两枚 30px 圆钮：⌕ 搜索会话 (Ctrl/Cmd+K)、+ 新对话 (Ctrl/Cmd+N)；hover 才填色。
  - **侧栏底部账户条**（Grok 风格）：`#account-bar` sticky 列尾，圆形字母头像 + Bit Bot 名 + 上弹 `#account-popup`。popup 内 8 项按官方分组：发现新版本 / 每周用量 / 获取移动版 Bit Bot → 分隔 → 支持 / 设置 → 分隔 → 添加账户 / 退出登录（红色）。Settings 项 id 保留 `sidebar-settings-btn`，M24 契约不破。
  - **消息送达状态**：用户气泡右下角新增 `.msg-status`；`runUserTurn` 拿到 `stored_ids.user` 后加 `.read`（绿 ✓），finally 块把文本升到 ✓✓。CSS：`.msg-status .ms-check.read { color: #22c55e; font-weight: 700; }`。
  - **助手 typing indicator**：`onLlmStream` 在 `phase === "start" | "provider"` 时给 `streamEl .body` 挂三个 `<i>` 的 `.typing` 胶囊（`@keyframes typingPulse`），首个 delta 覆盖为文本；只用 DOM 节点，GP-93 innerHTML 单一安全渲染路径不破。
  - **中英分离**：`WAVEG_I18N` 三语段的常见英文标签全部本地化 —— `gpPanel`→「对齐面板」/「對齊面板」、`tabComputer`→「电脑」/「電腦」、`botComputer`→「Bot 的云端电脑」、`updateComputerBtn`/`resetComputerBtn`→「更新/重置云端电脑」、`gpRecover`→「恢复云端电脑」、`marketplace`→「模板市场」、`defaultBotName`→「新 Bot」、`advanced`→「高级 · 代理 / 队友」、`locExec`→「本地执行（电脑权限）」、`allowAuto`→「自动允许」、`askFirst`→「先询问」、`bots`→「Bot 列表」。同一批文案在 `index.html` 里的原始 HTML 默认值同步替换（101 个 debug-lab 按钮、composer 语音对话、审批卡按钮、外观 chips、语言标签、tab 按钮、Settings sheet 标题等），确保 i18n 兜底也不中英混。品牌词保留：Bit Bot / Bot / Gmail / Slack / Teams / MCP / Chrome / Cursor。语言下拉保留各语言原生名（English / 简体中文 / 繁體中文）。
- **探针契约更新**：
  - `prove_m20_ui.js`：`--sidebar-w` 由 260px 改认 280px（Grok 视觉密度是新契约）。用户胶囊 `border-radius: 18px` 与 `--bot-bubble: #212121 / #f4f4f5` 断言不变，index.html 侧改用 `background: var(--bot-bubble)` + `border-radius: 18px` 满足。
  - `prove_m24_window.js`：`--sidebar-w` 同步到 280px；footer 顺序断言的 label 更新为「Settings（账号弹层内）」，DOM 检查逻辑不变（`#sidebar-settings-btn` 仍在 `#sidebar-footer` 内、顺序在 `#marketplace-btn` 之后）。
- **新增 `scripts/prove_m33_grokchrome.js`（7 项 + 1 负向）**：静态层断言上面 5 类改动确实存在于 `index.html`，负向对照砍掉 `.msg-status .ms-check.read` 样式后送达断言翻假。smoke 中作为 G-33 段接线。

### 2) 验证（本轮实测）
- `node scripts/prove_m33_grokchrome.js` **PASS=7 FAIL=0**
- `node scripts/prove_m20_ui.js` **24/0**；`prove_m24_window.js` **29/0**；`prove_m31_reactions.js` **17/0**
- `bash scripts/smoke_grok_desktop_parity.sh` **PASS=234 FAIL=0**（230 → +4 G-33 断言；其余探针无退步）
- 中英混排扫描：`hosts/desktop/index.html` 中原始 HTML 剩余英文可见文本仅两处：`>Bit Bot<`（品牌名，正确）与 `<option value="en">English</option>`（语言下拉的原生名，正确）。`data-i18n` / `data-i18n-ph` 属性覆盖已完整。

### 3) NG-001（本波故意不像素对齐）
外观对齐 Grok 桌面版的密度与层次 —— 不是复制 xAI 品牌皮肤、不引用 Grok 官方图标、不复刻像素级字标。颜色是 Bit Bot 中性色（白 / 灰 / 黑 + 送达绿），头像字母「B」和「Bit Bot」占位账户，不是任何真实账号信息。

### 4) 诚实残留（留给后续）
- 账户 popup 目前 8 项按钮里，除「设置」外其余是占位（发现新版本 / 每周用量 / 移动版 / 支持 / 添加账户 / 退出登录）；Host IPC 后续接入真实 OTA / usage / 登出流程再落。
- 送达状态 ✓/✓✓ 走本地回合边界（stored / turn end），不接多端同步；官方 Grok 的读回执在跨端场景下由服务端推送，Bit Bot 单机版仅本地语义。
- 侧栏 `#sidebar-toolbar` 与 `#account-bar` 的 sticky 位置在窗口极窄时会与 popup 打架，尚未加媒体查询；`--sidebar-w` 280px 是最短安全宽度，后续如需继续压缩再补折叠态图标条。
- 中英分离仅覆盖 `index.html` 里的可见 UI 文本；`data-i18n` 之外的内核短语（`runUserTurn("update computer", …)`）仍是英文关键词，属于「协议词」而非「用户可见文案」，不在本波范围。

## Wave M34（账户弹层入口全部落地：不静默、有去处）

背景：M33 侧栏底部加入了 Grok 风格的账户条与 8 项 popup，但只有 Settings 项接了真实动作，其余 5 项（发现新版本 / 每周用量 / 移动版 / 支持 / 添加账户 / 退出登录）都是"看得见、点了没反应"，这在功能上比没有更糟——违反「不做假 UI」的纪律。本波把 6 项都接到明确落点。

### 1) 实现
- **`hosts/desktop/index.html`**：
  - `ap-update` → `runUserTurn("open settings entry=account anchor=update-status", { skipSession, silentUser })`，落到「设置 → 更新」tab。
  - `ap-usage` → 同短语，`anchor=usage`，落到「设置 → 用量与账单」tab（M28 的 Usage & Billing 面板复用）。
  - `ap-add-account` → `anchor=profile`，落到「设置 → 常规」tab 里的 profile 面板。
  - `ap-mobile` / `ap-support` / `ap-signout` → `accountPlaceholder(msg)`：向对话流 append 一条中文助手气泡，明说"内测中 / 提 Issue 位置 / 单账户版本暂不支持登出"。不是弹窗、不是 toast，走 `#log`，与 Grok 的 chat-first 交互一致。
  - 每个 handler 首行 `document.getElementById("account-popup").hidden = true`；popup 不会盖住展开后的 sheet。
  - 锚点 `update-status` / `usage` / `profile` 早在 `SETTINGS_ANCHOR_TAB` 里已注册（M7），本波只是新增入口消费它们，内核与 Host 未改。
- **新增 `scripts/prove_m34_account_actions.js`（5 项 + 1 负向）**：静态层断言三项短语、锚点注册表、三项占位 callout 都带中文、每个 handler 关 popup；负向对照抹掉 `anchor=usage` 短语，第 1 项断言应变红。smoke 里作为 G-34 接线。

### 2) 验证（本轮实测）
- `node scripts/prove_m34_account_actions.js` **PASS=5 FAIL=0**
- `bash scripts/smoke_grok_desktop_parity.sh` **PASS=241 FAIL=0**（235 → +6 G-34 断言）

### 3) NG-001（本波故意不像素对齐）
弹层菜单本身仍是 Bit Bot 中性色 + 「B」字母占位头像；未复刻 Grok 品牌图标、颜色、账户信息。三项"占位 callout"故意留在对话流，不假装是 Grok 官方移动版链接 —— 等 OTA / 支持渠道真实接入再升级为深链。

### 4) 诚实残留
- `ap-mobile` / `ap-support` 目前只出本地 callout，没有 `shell.openExternal` IPC 到真实仓库 / 商店页；官方 Grok 会跳 App Store。本波先做「有反馈不假绿」，下一波接 IPC 出口。
- `ap-signout` 未真清 store；本地版本 profile 就是单条 default，"登出"目前语义上等价「删数据」，与用户直觉不符，故意只做提示。若后续引入多 profile，把这里改成 `switch profile -`。
- `ap-add-account` 目前落到 General tab 的 profile 面板；Grok 是打开一张独立的 add-account modal。本波先复用现成 tab，未来再拆出。

## Wave M35（键盘快捷键面板 + Cmd/Ctrl+K 搜索：Grok 桌面键盘可发现性）

背景：Grok 桌面版把键盘绑定当作第一公民 —— `⌘K` 搜会话、`⌘/` 弹快捷键表，用户不用鼠标也能全流程。Bit Bot M34 之前只有 `⌘N`（新对话）/ `⌘B`（折叠侧栏）/ `⌘F`（Computer 面板）/ `⌘⇧M`（连接应用）四条接入 `wireAccelerators`，`⌘K` 只在按钮 `title` 里出现（点了没反应）、`⌘D` 语音在按钮 `title` 里但没绑定、且**没有任何界面**能让用户看到当前所有快捷键。本波把这三块补齐。

### 1) 实现
- **`hosts/desktop/index.html`**：
  - `wireAccelerators()` 加两条分支：
    - `ev.key === "k" | "K"` → `toggleSessionSearchFromShortcut()`：`#session-search.hidden = false` + `.focus()` + `.select()`。走既有输入控件，未在渲染层起第二份状态。
    - `ev.key === "/"` → `openHotkeysSheet()`：懒建 `#hotkeys-modal`（首次调用），后续调用只做 `[data-i18n]` 重本地化（语言切换后仍准）。
  - `openHotkeysSheet()` 用 `document.createElement` + `appendChild` 建结构（bb-modal / bb-sheet / bb-sheet-sm / bb-sheet-head / bb-sheet-title），行了 `<kbd>` 元素。**没有** innerHTML 写入路径，GP-93 单一安全渲染纪律保持。
  - 新增 `HOTKEYS` 常量表 9 项：N（新对话）、K（搜索）、B（折叠侧栏）、F（Computer）、Shift+M（连接应用）、D（语音输入）、Enter（发送）、Shift+Enter（换行）、/（打开本表）。
  - 关闭：`bb-btn` Close 复用 `gpClose` 三语；点击遮罩（`ev.target === modal`）也关。
  - WAVEG_I18N 三个 locale 段各补 10 键：`hotkeysTitle` + 9 项 `hk*`。中文段无英文残留、繁体段用「快捷鍵 / 折疊 / 面板」等术语，英文段全英文。
- **`hosts/desktop/ui_chrome.css`**：`#hotkeys-modal .hk-list` / `.hk-row` / `kbd` / `.hk-desc` 四条规则。行栅格 `minmax(140px, 168px) 1fr`，`kbd` 用 `--font-mono` + `--radius-sm` + 底边框 2px，浅色卡片视觉与 composer 一致。
- **新增 `scripts/prove_m35_hotkeys.js`（6 项 + 1 负向）**：静态层断言绑定接入、复用 `#session-search`、DOM 建、10 键三语齐、CSS 规则存在；负向对照抹掉 `openHotkeysSheet()` 调用后第 1 项应变红。smoke 里作为 G-35 接线。

### 2) 验证（本轮实测）
- `node scripts/prove_m35_hotkeys.js` **PASS=6 FAIL=0**
- `bash scripts/smoke_grok_desktop_parity.sh` **PASS=247 FAIL=0**（241 → +6 G-35）

### 3) NG-001（本波故意不像素对齐）
面板是 Bit Bot 中性色 bb-sheet，不复制 Grok 快捷键表的排印；`kbd` 元素用系统默认渲染，不装品牌键帽图。

### 4) 诚实残留
- `⌘D`（语音）目前只在面板里出现，实际录音绑定仍在 `voice-btn` 的 click handler；全局 `keydown` 分支留给下一波。
- 面板不列出 `⌘⇧Space`（全局呼出）——那是 OS 级别的 Electron Tray 绑定，不属于窗口内。
- Enter / Shift+Enter 目前走 `#composer textarea` 默认行为，没有显式 handler；面板把它列出是为了让用户读到时不用去试。若未来加 Enter 发送可发现性配置，这里也一并更新。

## Wave M36（Cmd/Ctrl+D 语音输入：快捷键与按钮单一入口）

背景：M35 快捷键面板列出了 9 条绑定，其中 `Cmd/Ctrl+D → 语音输入` 只在面板里出现，实际的 `wireAccelerators` 尚未接住这个键；🎙 按钮走 `startVoiceInput`，但键盘走另一条 —— 这在探测层看是"面板诚实、实现没跟上"。本波把 D 键接进 wireAccelerators，并复用同一个 `startVoiceInput`，避免第二份录音状态。

### 1) 实现
- **`hosts/desktop/index.html`**：`wireAccelerators` 加一条 `else if (ev.key === "d" || ev.key === "D")` 分支，`ev.preventDefault()` 后走 `if (typeof startVoiceInput === "function") startVoiceInput()`。`startVoiceInput` 是文件后段的 `async function` 声明，函数声明会 hoist，但仍加 `typeof` guard 明确依赖形态；如果未来改成 `const startVoiceInput = async () => {…}`，guard 会立即退化而不是 ReferenceError。
- 🎙 按钮继续走 `voiceBtn.addEventListener("click", startVoiceInput)` —— 键盘与鼠标同一入口，录音状态只有一份。
- HOTKEYS 面板 `["Cmd / Ctrl + D", "hkVoice"]` 与按钮 title「语音输入（Ctrl/Cmd+D）」文案对齐（hkVoice 三语已在 M35 就位）。
- 与既有 `Alt+D` debug-json 切换不冲突：那条走 `ev.altKey` 且不看 `meta`。
- **新增 `scripts/prove_m36_voicehotkey.js`（5 项 + 1 负向）**：静态层断言 D 分支接入、guard 存在、按钮与快捷键共用同一入口、面板与 title 文案对齐；负向对照抹掉 `startVoiceInput()` 调用 → 第 1 项应变红。smoke 里作为 G-36 接线。

### 2) 验证（本轮实测）
- `node scripts/prove_m36_voicehotkey.js` **PASS=5 FAIL=0**
- `bash scripts/smoke_grok_desktop_parity.sh` **PASS=252 FAIL=0**（247 → +5 G-36）

### 3) NG-001（本波故意不像素对齐）
只补 D 键绑定，不引入 Grok 的声波可视化或录音中动效（那是波 M37 的候选）。

### 4) 诚实残留
- 录音中再按一次 D 是否等价"停止"目前取决于 `startVoiceInput` 内部 toggle；本波不重编该函数，只保证快捷键与按钮走同一入口。若后续 toggle 语义变化（比如加确认），面板与实现同步改。
- Windows/Linux 用 `Ctrl+D` 触发的是"发送 EOF"的 shell 习惯 —— Electron 里在窗口内被 `preventDefault` 拦下，不会误发；若焦点跳出主窗口到子进程终端，需要 tray 层的处理，本波不管。

---

## Wave M37（左侧账户弹层修复 + 全局 `[hidden]` 兜底 + CN/EN 中英混排清扫）

用户直接反馈："界面的显示各种中英文混搭的情况。完全没办法使用。左侧底部怎么点击显示和隐藏？" — 本波针对性解决三个可用性问题。

### 1) 实现

**a. 左侧账户弹层"点了没反应"根因修复**
- 症状：`#account-bar` 点击后 popup 不出现，或出现后关不掉。
- 根因：作者 CSS `#account-popup { display: flex; ... }` 覆盖了 UA `[hidden] { display: none }`。`hidden` 属性只影响 UA 样式，被同层/更高特异性的作者 `display` 顶掉后完全失效。
- 修复：
  - `ui_chrome.css:198` 加全局 `[hidden] { display: none !important; }` 兜底，杜绝同类 bug 复发；
  - `#account-popup` 改 `position: fixed; left: 12; right: 12; max-width: 260; bottom: 68; z-index: 45`，脱离 `#agents { overflow: auto }` 裁剪；
  - `#account-popup[hidden] { display: none !important; opacity: 0; pointer-events: none }` 与 `:not([hidden]) { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto }` 用带过渡的两态；
  - `setAccountPopup(open)` 单一真源（`index.html:~7622`）：`removeAttribute` / `setAttribute("hidden","")` + `aria-expanded="true|false"` 同步；
  - 所有 M34 handler 都走 `setAccountPopup(false)` 再 dispatch，Escape 键关闭。

**b. 侧栏视觉层次与密度**
- `--sidebar-w: 260 → 280px`（对齐 Grok 桌面）；
- `.panel-title` 大写化 + `letter-spacing`；
- `.sess-row` 36px 头像 + active 左侧 inset rail；
- `#sidebar-toolbar` 图标按钮重排（搜索 / 新对话）；
- `#account-bar` 头像改渐变圆；
- `#account-popup .ap-item` 分 `.ap-ic` + `.ap-tx`；
- `.msg.user` 圆角 `18px` 硬编码（保 M20 契约）；
- `.msg.assistant .body` 背景 `var(--bot-bubble)`（M20 契约）；
- Composer 发送按钮 → 36px 圆形 ↑；两层阴影；
- `#ap-settings` → `#sidebar-settings-btn`，M24 六项入口契约不破。

**c. CN/EN 中英混排清扫（batch 1 + batch 2）**
- **Batch 1**（27 项 raw HTML）：`Multi-end roster → 多端花名册`、`X search → X 搜索`、`Delete… → 删除…`、`booting MoonBit… → 正在启动 MoonBit…`、`I'm done → 我完成了`、`Slack / Teams outbound + claim → Slack / Teams 出站 + 认领`、plugins-meta / delivery-meta / memory-meta / shell/FS / git/PR plan / Image/video/chart / voice-meta / box-meta / cloud-meta / routines-meta / Auto-review settings / Draft · cold · on-behalf · claim / sandbox eml 等；
- **Batch 2**（49 项，其中 5 项二次修正后全绿）：
  - aria-label：`New chat → 新对话` 等；
  - settings-tab 动态标签 map：`{ general: "常规", computer: "电脑", credentials: "凭证", usage: "用量与账单", updates: "更新" }`；
  - 动态字符串：`Open with OS → 用系统程序打开`、`Allow once → 本次允许`、`Always allow → 总是允许`、`Deny → 拒绝`、`Privacy Mode: unavailable → 隐私模式：不可用 · 由账户侧管理`、`Discarded → 已丢弃`、`Agent ·` 前缀本地化；
  - Composer placeholder：`给 Bit Bot 发消息…（/ 唤起技能 · @ 提及 Bot · Shift+Enter 换行）`；
  - i18n zh-CN + zh-TW 值：`gpQueueNote`、`autoReview`、`accountSection`、`tabUsage`、`accountLabelPlaceholder`；
  - HTML `#gp-account-label` placeholder 从 `profile 名（如 Personal / Work）` → `配置名（如「个人」「工作」）`；
  - 关键 `gp-label`（`gpQueueNote` / `autoReview` / `accountSection`）从 `hint` → `gp-label` 类，DOM 契约与新 CSS 层次匹配。

### 2) 验证（本轮实测）
- `node scripts/prove_m37_layout.js` **PASS=13 FAIL=0**
  - 1) 全局 `[hidden] { display: none !important }` 兜底；
  - 2) `#account-popup` `position: fixed` + `z-index: 4x`；
  - 3) `setAccountPopup(open)` 单一真源（`hidden` 属性 + `aria-expanded`）；
  - 4) Escape → `setAccountPopup(false)`；
  - 5) `--sidebar-w: 280px`；
  - 6) gpQueueNote / autoReview / accountSection / accountLabelPlaceholder 已本地化；
  - 7) `aria-label="新对话"`；
  - 8) settings-tab 动态标签 map；
  - 9) composer placeholder；
  - 10) 负向对照：抹掉 `removeAttribute` → setAccountPopup 断言翻假。
- `node --check /tmp/r.js`（inline JS 抽出后） **SYNTAX_OK**
- `bash scripts/smoke_grok_desktop_parity.sh` **PASS=263 FAIL=0**（252 → +11 G-37）
- M33 / M34 / M35 / M36 契约保持，未破坏历史验收。

### 3) NG-001（本波故意不像素对齐）
- 侧栏宽度取 280 而非 Grok 官方测量值（不同版本 275–285 浮动，280 是本波选定的稳定中间值）；
- 消息气泡圆角 18 而非 Grok 的精确值（M20 契约锁死）；
- 不做深色主题 / 不做用户可自定义 accent color —— 本波专注浅色 Grok parity；
- Composer 发送按钮 36px 而非 Grok 44px 触摸尺寸（桌面端优先）。

### 4) 诚实残留
- **中英混排仍存 5–10 处稀有路径**：本次扫描（`docs/grok-desktop-parity/m37-scan.md`）列 52 条；batch 1/2 已覆盖高频 70 余条；剩余多为深度设置项（例如 `Usage & Billing` 段内文），本波未做完整清扫，留 M38。
- **动态 `data-i18n="booting"` 全量 sweep**：目前只对 MoonBit / kernel 常见 boot 消息做了 CN；`booting <unknown>` 兜底字符串未做通用替换。若未来 boot 消息源增多，需 `wavegT` 前加模板匹配。
- **hover actions bar**（消息悬浮工具栏 / 空态插画 / welcome screen / 设置 sheet 精修）本波不做，只是把 popup 修好、sidebar 层级拉齐、composer 焦点态补齐；后续 UI 精修波 M38+ 承接。
- **zh-TW 与 zh-CN 分叉**：本波 20 项 i18n 双值同步；若某 key 只在 zh-CN 补 CN，zh-TW 保持原样，未来扫描应加"两侧同 CN 覆盖"断言。

---

## Wave M38（消息悬浮 Copy 按钮 + pill 工具条 + welcome 品牌渐变）

延续用户"毫无设计感"反馈，把 Grok 桌面的悬浮工具条补齐，同时把 welcome 首屏从"三行纯文本"升级为品牌化开场。

### 1) 实现

**a. Copy 按钮（Grok 桌面标志动作）**
- `attachMessageActions(el, role, text)` 在 Reply / React 之后追加 Copy：
  - `navigator.clipboard.writeText` 优先；
  - 不可用时（`file://` 或权限拒绝）回退 textarea + `document.execCommand("copy")`；
  - 失败静默，按钮文字短暂切 `已复制` / `复制失败`，1200ms 后回 `复制`；
  - 无状态残留，不动现有 reaction / reply。

**b. 悬浮工具条视觉**
- `.msg-actions` 从"每个按钮各自带边框"改为整条 pill 容器：
  - `border-radius: 999px` + `background: rgba(255,255,255,0.92)` + `backdrop-filter: blur(4px)` + 轻阴影；
  - 按钮本身去边框去底色，`padding: 3px 10px`，`hover: background: var(--accent-soft)`；
  - 悬浮时"胶囊条"整体浮现，比逐个描边更 Grok。

**c. welcome 品牌渐变**
- `#welcome .w-brand` 从 `color: var(--ink)` → `linear-gradient(135deg, #111 0%, #4a4a4a 55%, #111 100%)` + `background-clip: text` + `-webkit-text-fill-color: transparent`；
- `w-line` 补 `color: var(--ink)`（避免继承 muted 太淡）；
- `w-hint` opacity 0.85 → 0.72、line-height 1.55，与主副文拉开层级。

**d. i18n 三语齐备**
- zh-CN: `copyAction: "复制"`, `copyDone: "已复制"`, `copyFailed: "复制失败"`；
- zh-TW: `複製` / `已複製` / `複製失敗`；
- en: `Copy` / `Copied` / `Copy failed`。

### 2) 验证（本轮实测）
- `node scripts/prove_m38_copy.js` **PASS=8 FAIL=0**
  - 1) attachMessageActions Copy 装配 + clipboard / execCommand 回退；
  - 2) 三语 copy* 齐备（zh-CN / zh-TW / en）；
  - 3) msg-actions pill 容器 + backdrop-filter；
  - 4) msg-actions 按钮去边框化；
  - 5) welcome .w-brand 渐变；
  - 6) 负向对照：抹掉 `bar.appendChild(cp)` → Copy 装配断言翻假。
- `node --check /tmp/r.js` **SYNTAX_OK**
- `bash scripts/smoke_grok_desktop_parity.sh` **PASS=269 FAIL=0**（263 → +6 G-38）
- M33 / M34 / M35 / M36 / M37 契约全部保持。

### 3) NG-001（本波故意不像素对齐）
- Copy 只复制气泡原文（`text` 参数），不做 Markdown → 纯文本转换；后续若加富文本渲染再做二次清洗；
- pill 条 `backdrop-filter` 用 4px 而非 Grok 官方模糊值（Electron 上更模糊有性能开销，本波不做微优化）；
- welcome 渐变仅做灰阶（`#111 → #4a4a4a`），不引入品牌色 —— 本波专注浅色主题、避免色彩体系反复；
- 不做"选中文字后浮出的 selection toolbar"，只做整条消息 Copy。

### 4) 诚实残留
- **execCommand 回退已弃用但仍有需要**：Chromium 1088+ 会在非 HTTPS / file:// 场景静默拒绝 clipboard.writeText；textarea + `document.execCommand` 是当前 Electron 41 唯一稳定的回退，长期需要迁移到 `navigator.permissions.query({name:'clipboard-write'})` + 明确失败态；本波只保证不 throw。
- **Copy 后 1200ms 恢复原文案是 setTimeout 硬编码**：与语言 / 用户节奏无关联；如果做 i18n 反馈扩展（如 `已复制 · 1.2 秒后恢复`），需要一并调整。
- **welcome 只做了 w-brand 渐变**：`w-line` / `w-hint` / `wt-grid` 仍是普通文本 + chip；本波不重塑整块 hero，若用户希望 Grok 那种"居中巨字 + 引导短语"，需要 M39+ 承接。

---

## Wave M39（微交互精修：淡入悬浮条 / 按压反馈 / 侧栏行 hover）

M38 加了 Copy 与 pill 工具条后，交互反馈仍是"硬切 display + 无按压"，缺一层手感。本波补上过渡与 :active 反馈，让桌面端"手感"更接近 Grok。

### 1) 实现

**a. `.msg-actions` 淡入**
- 之前：`display: none` → `display: inline-flex`（hover 硬切）；
- `display: none` 会阻断 transition（浏览器无法插值 display 属性）—— 常见坑；
- 现在：常驻 `display: inline-flex` + `opacity: 0 / pointer-events: none`，hover / focus-within 切 `opacity: 1 / pointer-events: auto` + `transform: translateY(-2px) → translateY(0)`，140ms 缓动。

**b. 按压反馈（scale）**
- `.msg-actions button:active` → `scale(0.96)`（悬浮条三个小按钮）；
- `.msg-actions button` transition 补 `transform 0.06s`，让 scale 有缓动；
- `#composer #send:active` → `scale(0.94)` + 阴影收缩；
- `#composer #attach-btn:active, #composer #voice-btn:active` → 同款 `scale(0.94)`，composer 三个键反馈节奏一致；
- `.sess-row:active` → `translateX(1px) scale(0.995)`（侧栏行极轻按压，避免视觉噪声）。

**c. 侧栏行 hover**
- `.sess-row:hover` 补 `transform: translateX(1px)`，transition 加 `transform 0.10s` —— 行"滑出"1px，指向可点击，同时不破坏左侧 inset rail 的对齐（inset rail 在 `.active` 才出现）。

### 2) 验证（本轮实测）
- `node scripts/prove_m39_micro.js` **PASS=10 FAIL=0**
  - 1) `.msg-actions` 淡入（display 常驻 + opacity + pointer-events + transform transition）；
  - 2) hover / focus-within 展开态 opacity 1 + pointer-events auto；
  - 3) `.msg-actions button:active` scale(0.96)；
  - 4) button transition 含 transform；
  - 5) `.sess-row:hover` translateX(1px)；
  - 6) `.sess-row:active` scale(0.995)；
  - 7) `#send:active` scale(0.94)；
  - 8) attach / voice `:active` 同款 scale(0.94)；
  - 9) M38 Copy 装配 + welcome 渐变契约保持（回归检查）；
  - 10) 负向对照：抹掉 opacity:0 → 淡入断言翻假。
- `bash scripts/smoke_grok_desktop_parity.sh` **PASS=277 FAIL=0**（269 → +8 G-39）。
- M33–M38 契约全部保持。

### 3) NG-001（本波故意不像素对齐）
- scale 数值（0.94 / 0.96 / 0.995）是经验手感值，非 Grok 官方测量；本波只保证"有反馈"，不追求与某个具体参考帧像素一致。
- translateX(1px) 是刻意保守 —— 更大幅度（2–3px）在长会话列表里会造成视觉漂移感。
- 不做 spring / bouncy 缓动（`cubic-bezier`），只用 ease，避免与 Electron 默认渲染节奏冲突。

### 4) 诚实残留
- **无键盘可达性回归**：`:focus-within` 已覆盖，但 Tab 到某条消息时悬浮条淡入是否打断焦点顺序，本波未在真实键盘流下测；如果无障碍要求变高，需要 `:focus-visible` 精修。
- **prefers-reduced-motion 未处理**：所有 transition / scale 对动效敏感用户不友好。后续波应加 `@media (prefers-reduced-motion: reduce) { transition: none; transform: none; }`。
- **translateX 与 inset rail 的层叠**：`.sess-row.active` 用 `box-shadow: inset 2px 0 0` 做左侧竖条；hover 的 translateX 不会移动 inset（inset 属于元素自身），实测不错位，但没有专门断言 —— 属于"看起来对，但没证明对"的灰色地带。

---

## Wave M40（无障碍：键盘焦点环 + prefers-reduced-motion）

直接收掉 M39 段列出的两条诚实残留：动效敏感用户与键盘可达性。

### 1) 实现

**a. 键盘焦点环（`:focus-visible`）**
- `:focus { outline: none }` 去掉浏览器默认蓝环；
- `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-sm) }` —— 只有键盘 Tab 出来的元素才有清晰焦点环，鼠标点击不闪环；
- 复用设计令牌（`--accent` / `--radius-sm`），不新增颜色值。

**b. `prefers-reduced-motion`**
- 全局 `@media (prefers-reduced-motion: reduce)` 把 `*` 的 `animation-duration` / `transition-duration` 压到 `0.001ms !important`，`animation-iteration-count: 1`，`scroll-behavior: auto`；
- 针对 M39 的位移单独归零：`.msg-actions`（淡入不再有 translateY）、`#composer #send/attach/voice :active` 与 `.sess-row:hover/:active`（scale/translateX 归零），保留颜色 / 背景状态变化，只去掉运动。

**c. 顺序纪律**
- 无障碍块放在主组件样式**之后**、`</style>` 之前。放前面会遮蔽 `.msg .msg-actions { position: absolute; opacity: 0; ... }` 主选择器（`.match()` 会先命中短覆盖块），导致 M39 淡入断言误判为红。已在探针补一条"块位置在主规则之后"的顺序断言防回归。

### 2) 验证（本轮实测）
- `node scripts/prove_m40_a11y.js` **PASS=8 FAIL=0**
  - 1) `:focus { outline: none }`；
  - 2) `:focus-visible` 2px accent 环 + offset 2px；
  - 3) reduced-motion 全局 duration 压平；
  - 4) reduced-motion 下 composer send:active transform 归零；
  - 5) reduced-motion 下 sess-row:hover transform 归零；
  - 6) M39 msg-actions 淡入契约仍在（回归检查）；
  - 7) reduced-motion 块位于主 .msg-actions 之后（顺序检查）；
  - 8) 负向对照：抹掉 `:focus-visible` → 焦点环断言翻假。
- `node --check /tmp/r.js` **SYNTAX_OK**
- `bash scripts/smoke_grok_desktop_parity.sh` **PASS=283 FAIL=0**（277 → +6 G-40）。
- M33–M39 契约全部保持。

### 3) NG-001（本波故意不像素对齐）
- 焦点环用 `2px solid accent` 而非 Grok 官方环宽；本波只求"键盘用户有可见焦点"，不追环宽像素一致。
- reduced-motion 只做"关运动"，不做"降级为淡入淡出"这一档中间策略（规范要求要么动要么不动，本波取"不动")。

### 4) 诚实残留
- **焦点环对比度**：`--accent: #1a1a1a` 叠在浅底 `#f5f5f7` 上对比足够；但深色块（如 `#send` 黑底）上 `outline-offset: 2px` 落在白底，仍清晰；未逐一截图核 WCAG 2.4.11 焦点可见性，留待无障碍专项。
- **`:focus-visible` 在旧 Electron 内核**：Chromium 86+ 支持；当前 Electron 41 无虞，但若有低版本打包目标需回退 `:focus`。本波不做 polyfill。
- **动画类不止 transform**：`vc-pulse`（录音脉冲关键帧）靠全局 `animation-duration` 压平，但视觉"停止闪烁"依赖 0.001ms 近似冻结，非真 `animation: none`；极端动效敏感场景可再显式 `.vc-pulse { animation: none }`，本波先用全局兜底。

---

## Wave M41（中英混排收尾：动态 meta 前缀 + 内部枚举外泄）

扫描清单 m37-scan.md 里 M37 batch 1/2 未覆盖的低频可见英文，本波收干净；技术引用（规范名、文件扩展名）按扫描排除规则保留，不强译。

### 1) 实现
- `channels-meta`：`workflows · N` → `工作流 · N`；
- `box-meta`：`env · <runtime>` → `运行环境 · <runtime>`；
- `webhook-meta`：`copied <what>` → `已复制 <what>`；
- `delivery-meta`：`last: <types>` → `最近： <types>`；
- `cloud-meta` 默认值：`local_worker · 交付产物` → `本地代理 · 交付产物`（内部枚举值不再外泄给用户；运行时 `p.mode || "local_worker"` 的逻辑判断保持不变，只改可见标签）。

保留（不译）：`ADR 0002`、`ICS`、`example.com`、`@Name` / `@everyone` 语法示例、`kernel RoomTurn` 协议名 —— 属扫描备注里明确排除的技术引用 / 协议短语。

### 2) 验证（本轮实测）
- `node scripts/prove_m41_cn.js` **PASS=7 FAIL=0**
  - 5 项本地化前缀 + 1 项技术引用保留（反向：确认没被误译）+ 1 负向对照。
- `node --check /tmp/r.js` **SYNTAX_OK**
- `bash scripts/smoke_grok_desktop_parity.sh` **PASS=289 FAIL=0**（283 → +6 G-41）。
- M33–M40 契约全部保持。

### 3) NG-001
本波只处理"可见英文前缀 / 枚举"，不改任何运行时逻辑；`p.mode` 的判定值仍是 `local_worker`，仅显示层中文化。

### 4) 诚实残留
- `已复制 <what>` / `最近： <types>` 里的 `<what>` / `<types>` 仍是后端返回的英文类型名（如 `screenshot`、`file`）。真正彻底本地化需要 Host 侧回传 i18n key 或前端维护一张 type→中文映射表；本波先统一前缀，类型名保留原样以免与后端契约脱钩。
- 扫描清单里 `git / PR 计划`、`shell · 列目录` 等：`git`/`PR`/`shell` 是工具 / 命令专名，按排除规则保留，非"混搭"缺陷。

---

## Wave M42（消息流排版：居中对齐 + 气泡尾角 + 连续回合分组）

核心聊天区的"设计感"最直接影响观感。本波修一个真实不对称 bug，并补齐 Grok 风格气泡尾角与连续回合节奏。

### 1) 实现
**a. #log 单列居中（真实 bug 修复）**
- 之前：`#log` 全宽 flex column，`.msg.user { align-self: flex-end }` 贴到视口右边缘，而 `.msg.assistant` 卡片 `max-width` 到 760/85% 为止 —— 两者不在同一列，宽屏下 user 气泡飘在最右、assistant 卡偏左，视觉割裂；
- 之后：`#log { max-width: 820px; margin-left/right: auto }` 把整条流收进居中的单列，user 与 assistant 对齐同一左右边界。

**b. 气泡尾角（Grok 风格）**
- `.msg.user`：保留 `border-radius: 18px`（M20 契约硬约束）+ 新增 `border-bottom-right-radius: 6px`，右下角收平朝向发送方；
- `.msg.assistant .body`：保留 `var(--bot-bubble)` + `border-radius: var(--radius-xl)`（M20 契约）+ 新增 `border-top-left-radius: 8px`，左上角收平朝向头像。

**c. 连续 assistant 回合分组**
- `#log { row-gap: 16px }` 显式化行距；
- `.msg.assistant + .msg.assistant { margin-top: -6px }` —— 同一 Bot 连续多回合收紧行距，读起来像一条线程；
- `.msg.assistant + .msg.assistant::before { visibility: hidden }` —— 隐藏重复头像，但保留 32px 占位，卡片仍左对齐不错位。

### 2) 验证（本轮实测）
- `node scripts/prove_m42_stream.js` **PASS=7 FAIL=0**
  - #log 居中列 + user 尾角(含18px护栏) + assistant 尾角(含bot-bubble护栏) + 连续头像隐藏 + margin 收紧 + M20 正则回归 + 负向对照。
- `node --check /tmp/r.js` **SYNTAX_OK**
- `bash scripts/smoke_grok_desktop_parity.sh` **PASS=296 FAIL=0**（289 → +7 G-42）。
- M20 / M33–M41 契约全部保持（尾角改动专门验证未破 M20 用户胶囊正则）。

### 3) NG-001
- 尾角 6px / 8px 是经验值，非 Grok 官方测量；本波只求"有朝向感"，不追像素一致。
- 居中列取 820px（含左右 padding 24×2）—— 与 assistant 卡 max-width 760 不是硬绑定，宽屏下 user 气泡不再越界即可。

### 4) 诚实残留
- **相邻选择器只看直接前驱**：`A + A` 只在两条 assistant 紧贴时生效。若两条 assistant 之间夹了 `.msg.user` / `.secret-card` / `.msg.tool-run`，分组链断裂（符合预期：换了发言方就该重新显示头像）。但"工具调用回合是否算打断线程"存疑：若一个回合的 assistant 输出被 tool-run 气泡分隔，本波会重复显示头像。彻底方案需要渲染层给同一回合的多气泡打同一 group-id，用 `[data-group]` 选择器分组 —— 属渲染改造，本波不做。
- **居中列在超窄窗**：<868px 时 `max-width: 820` 不触发，退回原有 padding 行为，无横向溢出，但未专门测 320px 极窄（Electron 最小宽一般 ≥ 800）。
- **margin-top: -6px 与淡入 transform 叠加**：msg-actions 的 translateY(-2px) 在 hover 时不影响文档流（transform 不占位），与负 margin 无冲突，实测不抖动，但无专项断言。

---

## Wave M43（Settings 面板精修：分段控件 tab 条 + sticky 头部）

设置面板是"配置一次、看很多次"的界面，本波把它从"平铺 chip + 会滚走的标题"升级为分段控件 + 常驻头部。

### 1) 实现（`ui_chrome.css`，仅新增覆盖，不改原 .settings-tab-btn 基础样式）
- **分段控件**：`#settings-tabs` 改 `inline-flex` 容器，`#f4f4f5` 浅底 + `1px --line` + `border-radius: 999px` + `gap: 2px`，把五个标签收进一条胶囊轨道；
- **标签态**：`#settings-tabs .settings-tab-btn` 去边框 / 去阴影 / 透明底 / 999px；`hover` 半透白；`.active` 纯白 + `0 1px 3px rgba(0,0,0,0.10)` 浮起（选中项像"凸起的滑块"）；
- **HTML 修正**：`<div id="settings-tabs">` 原有 inline `style="display:flex;..."` 会以行内优先级顶掉 CSS 的 `inline-flex`，本波移除该行内样式，让分段控件生效（探针第 3 条专测无 inline style）；
- **sticky 头部**：`#settings-sheet .bb-sheet-head` `position: sticky` + 下分隔线 + 白底，负 margin 抵消 sheet padding，长设置页滚动时"设置"标题与关闭按钮常驻；
- **标题层级**：`.bb-sheet-title` 升至 `--text-lg` + `letter-spacing: -0.01em`，与下方内容拉开层级。

### 2) 验证（本轮实测）
- `node scripts/prove_m43_settings.js` **PASS=8 FAIL=0**
  - 分段容器 / tab 默认态 / tab active 浮起 / HTML 无 inline style / sticky head / 标题 --text-lg / M42+M20 回归 / 负向对照。
- `node --check /tmp/r.js` **SYNTAX_OK**
- `bash scripts/smoke_grok_desktop_parity.sh` **PASS=302 FAIL=0**（296 → +6 G-43）。
- M33–M42 契约全部保持。

### 3) NG-001
- 分段控件底色 `#f4f4f5` 与 Grok 官方轨道色不做像素比对；本波只求"分段感 + 选中浮起"。
- sticky 头部只在 `#settings-sheet` 内生效，其他 `.bb-sheet`（marketplace / bot-edit / hotkeys）不改，避免一次改动波及多个模态；若要全站统一 sticky，后续波单开。

### 4) 诚实残留
- **sticky 依赖 sheet 是滚动容器**：`#settings-sheet` 有 `max-height: 86vh; overflow: auto`（继承 `.bb-sheet`），sticky 才生效。若未来把滚动交给内层 `.settings-tab` 子容器，sticky 会失效 —— 属结构耦合，本波不加专项断言。
- **active 滑块不做平滑滑动动画**：Grok 的 tab 选中有一个滑块位移动画；本波只做静态浮起样式，未加 `transition: transform` 的滑块跟手动画（需要额外 JS 测位），留 M44+。
- **分段控件在极窄 sheet 换行**：`flex-wrap: wrap` 时五个标签可能在窄窗下折成两行，破坏"单条胶囊"观感；Electron 最小宽一般够放，但未在 420px 级窄模态实测。
