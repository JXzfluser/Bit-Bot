# Grok Bot 桌面端对等 — 现状差距审计（Wave G 验收后）

> 口径：**已实现 = 有可证伪验收信号且本轮实测通过**；**残留 = 行为真实存在但依赖本沙箱不可达的外部条件（按诚实残留纪律标注，不 pretend）**；**未做 = 本波范围内尚未接线，如实列出**。
> 验收证据：`scripts/smoke_grok_desktop_parity.sh` PASS=25 FAIL=0；`moon test` 373/373；Electron 冒烟 `BITBOT_DESKTOP_SMOKE_TURN="create bot Piper job=scout description=Watch+the+market" xvfb-run npm start` 退出码 0 且 `bots.json` 出现 Piper；renderer 冷启动（xvfb + ELECTRON_ENABLE_LOGGING）console 无 JS 错误。
> 基线：`cursor/grok-bot-parity-desktop-v2`，kernel Wave G 提交 `3f49b4b` + Host/Desktop 对等提交。

## 逐条状态

| ID | 状态 | 说明 |
|----|------|------|
| GP-01 | 已实现 | create bot → `bot_create` → `bots.json` 落盘（smoke G-1）；renderer 侧边栏 + Cmd/Ctrl+N 新建。 |
| GP-02 | 未做 | 建议模板一键创建本波未接线（renderer 无模板目录入口）；列入未做清单。 |
| GP-03 | 已实现 | update bot name/job/description 持久（smoke G-1）；头像无效路径由既有 CM-0202 门拒绝。 |
| GP-04 | 已实现 | pin 持久（smoke G-1）；renderer 置顶区排序读取 store。 |
| GP-05 | 已实现 | duplicate → `Smoke copy` 持久（smoke G-1）；不复制对话历史（store 语义仅配置）。 |
| GP-06 | 部分 | `hide_agent`/unhide 走既有 CM-0204 链；Hidden Bots 恢复入口在 renderer 存在。Routines 在隐藏后仍触发的断言沿用 CM 既有测试，未进本脚本。 |
| GP-07 | 部分 | delete 级联（bots/sessions/routines）与共享文件保留沿用 CM-1907 既有实现；"先提示改用隐藏" 为 renderer 文案。二次确认脚本断言未进本波。 |
| GP-08 | 已实现 | set primary 持久（smoke G-1）。X 入站模拟路由沿用既有 CN inbound 测试。 |
| GP-10/11/12/13/14 | 已实现/部分 | Composer 多行/附件≤6（IPC attachments）/`/`技能/`@`提及已有；GP-13 群内 `@BotName` 路由本轮实测（smoke G-6）。 |
| GP-15 | 已实现 | 语音输入：🎙 recording 态（红圈）→ MediaRecorder → `bitbot.voice.ingest` 真实落盘 `data/desktop/voice/*.wav`；无 STT 时诚实提示补文字（不伪造转写）。getUserMedia 链已用 `--use-fake-device-for-media-stream` CDP 实测（录音→存盘回执截图）。 |
| GP-20 | 已实现 | 审批卡结构化：操作/参数/目标 kv 行 + secret 提示；不可映射类别隐藏 Always。 |
| GP-21 | 已实现 | 三按钮全链实测：基线弹卡→always allow 规则落盘→同 pattern 自动执行（`yes:approval_rule`）；Deny 走 pending 匹配 + `approvals.log.jsonl` 回执。 |
| GP-22 | 已实现 | ask-first 优先实测（smoke G-3：allow+ask 冲突不自动）。规则持久在 `approval-rules.json`。 |
| GP-23 | 已实现 | 过期语义实测：expired 后 allow_once 拒绝（`approval_expired`）、always/deny 仍可（smoke G-3）。 |
| GP-24 | 已实现 | 五类门经 `waveGApprovalCardGate`/`waveGApprovalGate`；Destructive 不可 always-allow（映射为 null，UI 隐藏按钮）。 |
| GP-25 | 已实现 | secret 提示 + 掩码 store 沿用 `.env.local` 0600 既有验收。 |
| GP-30 | 已实现 | 每 Bot screen 状态在 `computer.json screens` 呈现（takeover/preview/screenshot/CU 全链路写入）；同 Bot 并发拒绝沿用 CM-06xx 测试，未进本脚本。 |
| GP-31 | 已实现 | Grok 式右侧 Computer 预览 rail（`#computer-rail`，3s 帧轮询 + 活动流 + per-Bot chips）；`open computer` → `computer_preview` effect 只读截帧、不暂停后台；screens 落盘断言进 smoke G-4（PASS=41）。沙箱 DISPLAY 真帧已由 Xvfb 截屏验证（preview-*.png 非空且入面板渲染）。 |
| GP-32/33/34 | 已实现 | `take over` → `takeover.active=true`、`i'm done` → false+handback 实测（smoke G-4）；banner 文案含"密码/验证码/2FA 请在本机输入，不要贴进对话"。 |
| GP-35 | 已实现 | recover 仅错误态：非 error 时被拒且不假装恢复（smoke G-4 grep）。update/reset 沿用 CM-1903/1904。 |
| GP-36 | 已实现 | 三档实测：never → `host_approval_card_refused` 不执行；always → `via=local_execution_always` 自动；ask 弹卡。**本轮修复**：kernel 把裸 `local execution never|always`（Grok 设置页原语）误路由为 legacy on/off（`never` 反而=启用 machine use），已在 `parity_intents.mbt` 修正并加 4 条内核测试断言。 |
| GP-37 | 残留 | `route_traffic` 开关持久 + UI 显示真实生效状态；真代理生效不可达 → renderer 显示 honest residual 文案。 |
| GP-40/41 | 已实现 | 草稿卡（New Email / New Slack Message）可编辑，Send→真实 approved 回合再编码；Discard→不落出站。仅当卡类别为 ExternalSend 时渲染（不从任意文本臆造草稿）。 |
| GP-42 | 已实现 | kernel 判定未变（CM-0306），UI 不代客批准。 |
| GP-50 | 已实现 | 2 成员建立 / 1 成员拒绝 `members_2_to_6` 实测（smoke G-6）；名称可改持久（rename 走 rooms store）。 |
| GP-51 | 已实现 | `@BotName`→mentioned_only、`@everyone`→all、无@→bot_discretion 实测（smoke G-6，transcript 落 rooms.json）。 |
| GP-52 | 部分 | `send_to_agent` 沿用 CM-14xx；群内 reply 定向 UI 有、内核所有权转移断言未进本波。 |
| GP-53 | 已实现 | `escalations:"dm-only"` 实测出现在 room_turn 结果；审批卡只进 pending 队列/私聊，不进 transcript。 |
| GP-60/61 | 已实现 | GP-60 Voice chat：composer 为空才可发起（非空/有附件禁用按钮，实测）→ 通话栏（脉冲+计时+监听文案+转述框）+ 侧边栏"语音对话进行中"→ 挂断后对话留 Voice chat 卡（真实麦克风录音优先，含时长）。GP-61 memo 卡：播放/暂停 + 转写展开（relay user_text 回填）。kernel→host 链断言进 smoke G-7（PASS=46）。 |
| GP-70 | 已实现 | appearance dark 持久实测 + boot 时 `applyAppearance` 读取持久值（smoke G-5）；nativeTheme 像素断言未做（依赖截图基线，未列本波）。 |
| GP-71 | 已实现 | language 持久 + renderer `wavegLangApply` 关键文案切换（zh-CN/zh-TW/en）。 |
| GP-72 | 已实现 | timezone 持久 + `process.env.BITBOT_TZ` + 守护进程重启（smoke G-5）。 |
| GP-73 | 已实现 | 规则 CRUD 持久、团队规则 locked 行不可删（`rule_locked`）。 |
| GP-74 | 残留 | 显示真实凭证配置态；未配置明确"未登录"，不伪造远端账号。 |
| GP-75 | 已实现 | 见 GP-35/37。 |
| GP-76 | 已实现 | `usage.week` 读取 `llm-usage.json` 真实统计；无数据渲染空态而非 0 假数（smoke 未断 UI，store 层实测）。 |
| GP-77 | 残留 | `check_updates` 真实网络探测已有（OTA feed env）；沙箱网络受限 → UI 显示探测失败 residual，不假装最新。 |
| GP-80/81/82 | 已实现 | 聚焦抑制（BrowserWindow focus 态）+ 侧边栏未读 + `setBadgeCount` + 点击通知激活 session（`wireFocusSession`）；系统 Notification 在 xvfb 无通知总线环境下不弹出属平台限制，逻辑分支以 store/badge 状态实测。 |
| GP-90/91/92 | 部分 | artifact 预览/保存沿用既有链；全屏查看未进本波验收。 |
| GP-A1 | 已实现 | Cmd/Ctrl+B 折叠（renderer accelerator + 主菜单 + `sidebar_collapsed` 持久）；Cmd/Ctrl+N 新对话（菜单模板 broadcast `bitbot:menu-new-chat`）。 |
| GP-A2/A3 | 部分 | Hidden Bots/Connect apps 入口存在；Plugins 启停沿用 `mcp_list_plugins` 既有验收。 |

## 已知坑与纪律（本波实测结论）

1. **key=value `+` 编码**：kernel `extract_kv` 在已知 key 词处截断且不解码 `+`；renderer 自由文本进 phrase 前必须 `encodeURIComponent` 再把 `%20→+`（`encodeURIComponentVal`），否则 `description=Watch+the+market` 会截吞。bot name、room title、规则 pattern 都吃这条。
2. **审批卡词法**：`"<Class> :: <summary> :: <reason>"`；规则匹配串 = summary 去掉 `"<kind>: "` 标签前缀（`cardRuleCommand`），pattern 词汇 = `kind:*` / `kind:prefix*` / exact。`Always allow` 持久化 `entry.kind + ":*"`。
3. **kernel 先于 Host 弹卡**：chat 流的 consequential shell 由内核 `gate_consequential` 先出 approval_card，Host 对 `shell` kind 的门只在 `runAllowed` 重放/非卡路径生效——两层门并存，验收分别覆盖。
4. **拒绝不静默**：never/refused 路径 renderer 显示固定诚实文案（"被你的设置直接拒绝，未执行"），host_results 无执行条目；deny 回执写 `approvals.log.jsonl`（`executed:false`）。
5. **测试残留卫生**：`data/desktop/*.json*` 全部 gitignore；脚本运行前后必须清 bots/rooms/rules/settings，避免跨 run 污染。
6. **回归脚本环境依赖**：`smoke_grok_parity_scenario.sh` 的 voice 段隐式要求 TTS 二进制（espeak mock 或 ffmpeg sine），无 ffmpeg 的纯沙箱会在 `voice_relay` 断言处红——这是脚本级环境耦合，不是 Host 行为回归（`mode` 字符串由 `replyMedia.tool` 决定，属既有设计）。本波未改该脚本，运行它时注入 `BITBOT_ESPEAK_BIN` 即可。

## 未做清单（后续波次）

- GP-02 `bot-templates.json` store 化 + 模板一键创建的脚本断言。
- GP-06/GP-07 隐藏不暂停 Routines、删除二次确认的自动化断言。
- GP-30 同 Bot computer-use 并发拒绝的桌面端专项断言。
- ~~GP-15/GP-60 真麦克风链路~~（M6 已用 `--use-fake-device-for-media-stream` 实测 getUserMedia→MediaRecorder→落盘全链）。
- GP-52 群内所有权转移 transcript 断言。
- GP-70 nativeTheme 像素级断言。
- GP-90/92 预览格式扩展与全屏验收。
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
