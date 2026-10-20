# Grok Bot 桌面端对等 — 现状差距审计（Wave G 验收后）

> 口径：**已实现 = 有可证伪验收信号且本轮实测通过**；**残留 = 行为真实存在但依赖本沙箱不可达的外部条件（按诚实残留纪律标注，不 pretend）**；**未做 = 本波范围内尚未接线，如实列出**。
> 验收证据：`scripts/smoke_grok_desktop_parity.sh` PASS=25 FAIL=0；`moon test` 373/373；Electron 冒烟 `BITBOT_DESKTOP_SMOKE_TURN="create bot Piper job=scout description=Watch+the+market" xvfb-run npm start` 退出码 0 且 `bots.json` 出现 Piper；renderer 冷启动（xvfb + ELECTRON_ENABLE_LOGGING）console 无 JS 错误。
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
| GP-10/11/12/13/14 | 已实现/部分 | Composer 多行/附件≤6（IPC attachments）/`/`技能/`@`提及已有；GP-13 群内 `@BotName` 路由本轮实测（smoke G-6）。 |
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
| GP-37 | 残留 | `route_traffic` 开关持久 + UI 显示真实生效状态；真代理生效不可达 → renderer 显示 honest residual 文案。 |
| GP-40/41 | 已实现 | 草稿卡（New Email / New Slack Message）可编辑，Send→真实 approved 回合再编码；Discard→不落出站。仅当卡类别为 ExternalSend 时渲染（不从任意文本臆造草稿）。 |
| GP-42 | 已实现 | kernel 判定未变（CM-0306），UI 不代客批准。 |
| GP-50 | 已实现 | 2 成员建立 / 1 成员拒绝 `members_2_to_6` 实测（smoke G-6）；名称可改持久（rename 走 rooms store）。 |
| GP-51 | 已实现 | `@BotName`→mentioned_only、`@everyone`→all、无@→bot_discretion 实测（smoke G-6，transcript 落 rooms.json）。 |
| GP-52 | 已实现 | `send_to_agent` 沿用 CM-14xx；本轮补齐 Bot→Bot 任务所有权转移：`handoff room <id|title> [from=<bot>] to=<bot> task=<text>` → `handoff_task` 意图 → Host 写群 transcript（回执含 to_bot/responders，规格信号"转交可见于 transcript"）+ 任务投递承接 Bot inbox；非成员/未知群诚实拒绝（`pretend_transferred:false`，不写 transcript）。smoke G-14 十断言。 |
| GP-53 | 已实现 | `escalations:"dm-only"` 实测出现在 room_turn 结果；审批卡只进 pending 队列/私聊，不进 transcript。 |
| GP-60/61 | 已实现 | GP-60 Voice chat：composer 为空才可发起（非空/有附件禁用按钮，实测）→ 通话栏（脉冲+计时+监听文案+转述框）+ 侧边栏"语音对话进行中"→ 挂断后对话留 Voice chat 卡（真实麦克风录音优先，含时长）。GP-61 memo 卡：播放/暂停 + 转写展开（relay user_text 回填）。kernel→host 链断言进 smoke G-7（PASS=46）。 |
| GP-70 | 已实现 | appearance dark 持久实测 + boot 时 `applyAppearance` 读取持久值（smoke G-5）；nativeTheme 像素断言未做（依赖截图基线，未列本波）。 |
| GP-71 | 已实现 | language 持久 + renderer `wavegLangApply` 关键文案切换（zh-CN/zh-TW/en）。 |
| GP-72 | 已实现 | timezone 持久 + `process.env.BITBOT_TZ` + 守护进程重启（smoke G-5）。 |
| GP-73 | 已实现 | 规则 CRUD 持久、团队规则 locked 行不可删（`rule_locked`）。 |
| GP-74 | 已实现 | Account 面板 + `whoami / sign in <label> / sign out / switch account <label>` 全链：本地 profile store（data/desktop/account-profile.json）+ 真实凭证来源清单（env 与 .env.local 双查，llm/slack/gmail/outlook/dingtalk/feishu/wecom）。未登录明确 "not signed in"，登录态附 backed_by；未知 profile `account_not_found + known[]` 拒绝（`pretend_switched:false`）。smoke G-15 六断言。 |
| GP-75 | 已实现 | 见 GP-35/37。 |
| GP-76 | 已实现 | `usage.week` 读取 `llm-usage.json` 真实统计；无数据渲染空态而非 0 假数（smoke 未断 UI，store 层实测）。 |
| GP-77 | 已实现 | `ota:check` 真实网络探测不变；新增安装态持久化（main boot 写 data/desktop/app-install.json，ota:check 各分支写 ota-state.json）→ `update_status` 意图读真实 version/packaged/residual（未打包 `residual:true, pretend_up_to_date:false`），Updates tab 打开即显示「安装版本 v0.1.0 · 开发运行（未打包）· … · 应用更新不会重置 Computer 文件」；smoke 用 computer.json marker 断言 check_updates/update_status 链全程未改写 Computer 状态。 |
| GP-80/81/82 | 已实现 | 聚焦抑制（BrowserWindow focus 态）+ 侧边栏未读 + `setBadgeCount` + 点击通知激活 session（`wireFocusSession`）；系统 Notification 在 xvfb 无通知总线环境下不弹出属平台限制，逻辑分支以 store/badge 状态实测。 |
| GP-90/91/92 | 已实现 | readArtifact 文本族（md/txt/json/csv/ics/eml/yaml + ≤64KB 无 NUL 探测）文件卡；saveArtifact IPC 真拷贝（headless 覆盖）；GP-92 全屏查看器（图/视频/音频/文本，Esc/遮罩关闭）。见 Wave M9。 |
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
- GP-70 nativeTheme 像素级断言。
- ~~GP-90/92 预览格式扩展与全屏验收~~（M9 已实现文本族文件卡 + saveArtifact + 全屏查看器，CDP 实测）。
- renderer E2E（Playwright for Electron）以替掉手工冷启动检查。当前已有 `hosts/desktop/shot_cdp.mjs`（CDP 驱动真实控件 + 视口截图，dev-only）做冒烟级验证；本轮真机截图暴露并修复了 3 个问题：body 网格 `min-height:100vh` 导致长对话把 composer/审批条推出视口、never 拒绝后三按钮条仍挂起 + kernel 显示 "unknown host error"、@非成员静默回退 all（现为 bot_discretion）。

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
