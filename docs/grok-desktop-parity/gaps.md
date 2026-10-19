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
| GP-15 | 部分 | 语音转写进 composer 依赖真麦克风；沙箱内以 `voice_end_write` 链验收，getUserMedia 未测（残留）。 |
| GP-20 | 已实现 | 审批卡结构化：操作/参数/目标 kv 行 + secret 提示；不可映射类别隐藏 Always。 |
| GP-21 | 已实现 | 三按钮全链实测：基线弹卡→always allow 规则落盘→同 pattern 自动执行（`yes:approval_rule`）；Deny 走 pending 匹配 + `approvals.log.jsonl` 回执。 |
| GP-22 | 已实现 | ask-first 优先实测（smoke G-3：allow+ask 冲突不自动）。规则持久在 `approval-rules.json`。 |
| GP-23 | 已实现 | 过期语义实测：expired 后 allow_once 拒绝（`approval_expired`）、always/deny 仍可（smoke G-3）。 |
| GP-24 | 已实现 | 五类门经 `waveGApprovalCardGate`/`waveGApprovalGate`；Destructive 不可 always-allow（映射为 null，UI 隐藏按钮）。 |
| GP-25 | 已实现 | secret 提示 + 掩码 store 沿用 `.env.local` 0600 既有验收。 |
| GP-30 | 部分 | 每 Bot screen 状态在 `computer.json screens` 呈现；同 Bot 并发拒绝沿用 CM-06xx 测试，未进本脚本。 |
| GP-31 | 残留 | 帧轮询/预览已接（3s poll + `computer:frame`）；沙箱 DISPLAY 下帧为 honest residual 文本（无 pretend 帧），真机断言"帧变化"未测。 |
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
| GP-60/61 | 部分 | voice_session/relay 链在 `smoke_grok_parity_scenario.sh` 验收；renderer 录音依赖真麦克风（残留）。 |
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
- GP-31 真 DISPLAY 帧变化断言；GP-15/GP-60 真麦克风链路。
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
