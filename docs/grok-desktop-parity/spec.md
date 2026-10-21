# Grok Bot 桌面端对等 — 详细规格与验收（可证伪）

> 编号规则：`GP-xx`（Grok Parity）。每行 = 官方行为（来源 spec §）+ 实现落点 + 验收信号（脚本可断言）。
> 术语沿用官方：Bot / Computer / Routine / Skill / Plugin / Take over / Auto Review / Approval / Draft / Voice memo / Voice chat / Group chat / Connect apps。

## G-1 Bot 生命周期（spec §2.2–2.3, §4）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-01 | Create new Bot：Name + Job + Description（多行），创建后自动打开对话 | Host `bots` store（`data/desktop/bots.json`）+ kernel `create_bot` intent + renderer 表单；`Cmd/Ctrl+N` | 输入名 → store 落盘含 name/job/description/created_at；侧边栏出现该项；对应 session 激活；kernel 回合 intent=create_bot 且 effects 回填 |
| GP-02 | 建议模板 Bot 可一键创建 | Host 内置模板目录 `data/desktop/bot-templates.json`（Sales Outbound/Talent Scout/Paid Media/Expense Manager/Bug Reproduction/Chief of Staff，来自官方产品页） | 选模板 → 生成 Bot 的 job/description 与模板一致；无网络也不报错（本地目录） |
| GP-03 | Edit Profile：名称/标签/描述/头像可改，改后立即影响侧边栏与信息面板 | `update_agent_profile`/`update_avatar`（CM-0201/0202 已有）接到 store + renderer | 改名后 `bots.json` 与侧边栏文本一致；头像路径无效 → 拒绝且不改（CM-0202） |
| GP-04 | Pin/Unpin：置顶 Bot 固定在列表最上 | store `pinned: bool` + renderer 排序 | toggle 后 list 顺序改变且持久（重启仍在顶部） |
| GP-05 | Duplicate：生成 `{name} copy`，携带配置，不复制对话历史/learned memory/chat attachments | Host `duplicate_bot` | 新 Bot 的 job/description == 源；messages 为空；memory 不含源条目；名称规则正确 |
| GP-06 | Hide from sidebar：不删配置、**不暂停 Bot 与 Routines**；可在 Hidden Bots 恢复 | `hide_agent` 已有（CM-0204）→ 接 store hidden 标志 + `unhide_bot` 新 | 隐藏后不出现在主列表但 id 仍可寻址（可发消息）；其 Routine 下次 tick 仍触发；恢复后可见 |
| GP-07 | Delete：不可撤销；移除配置+对话+Routines；**共享 Computer 文件保留**；UI 必须先提示"建议改用隐藏" | `delete_agent` 已有（CM-1907）→ 补级联与保留断言 | 二次确认后：bots/sessions/routines 条目消失；box 工作区文件仍存在且可读；未确认时拒绝执行 |
| GP-08 | Primary Bot：接收 `@bot on X` 标签任务 | store `primary: id` + Host X inbound 路由 | 设置 primary 后，模拟 X 入站落到该 Bot 会话；未设时落默认 agent-bit |

## G-2 Composer 对等（spec §5.1–5.2, §5.5）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-10 | 多行输入；Enter 发送；`Cmd/Ctrl+Enter` 亦发送；`Shift+Enter` 换行 | renderer `<textarea>` | 断言 Shift+Enter 不触发 turn；多行文本原样进 kernel user 消息 |
| GP-11 | 附件：粘贴图片/链接/文本、拖拽、文件选择；**≤6 个/次**；文档图片音频 ≤25MB、视频 ≤200MB | IPC `attachments:pick`（dialog.showOpenDialog）+ 校验 + 复制到工作区 | 选 7 个 → 拒绝并报 `too_many_attachments`；超限体积 → 拒绝；成功则路径落在仓库 `/workspace` 语义目录且 kernel 收到真实路径（CM-0106 禁幻觉路径） |
| GP-12 | `/` 引用保存的 Skill（弹菜单列出可用 Skills） | IPC `skills:list`（已有 `list_skills`）+ renderer 补全 | 输入 `/` 出现菜单，项来自 Host store；选中后消息带 skill 引用并走 skill 门控（先 Read 再执行 CM-05xx） |
| GP-13 | `@` 提及 Bot/群组/Routine/Connector | renderer 补全 + kernel mention 解析 | `@BotName` 在群聊路由到该 Bot；`@routine` 引用真实 id |
| GP-14 | Reply 特定消息；React 消息 | 已有 react/pin（CM-21xx）接 renderer | 点回复后 kernel 上下文含被回复消息 id |
| GP-15 | Start voice input：按钮或 `Cmd/Ctrl+D`，转写填 composer **可编辑后发送** | renderer getUserMedia→WAV→Host `voice_end_write` | 语音结果写入 composer 而非直接发送；取消不产生 turn |

## G-3 审批与 Auto Review 对等（spec §5.8, §8.1）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-20 | 审批卡显示：提议操作、输入参数、目标系统 | renderer `#approval` 扩为结构化卡（kind/command/target） | 卡内三字段与 kernel effect 一致；无字段则不显示空壳 |
| GP-21 | **Allow once / Always allow / Deny** | IPC `approvals:decide` + kernel `--apply-host-results approved`；`Always allow` 落规则库 | Always allow 后同 pattern 第二次不再弹卡（规则命中 allow_automatically）；Deny 后 effect 不执行且回执记录 deny |
| GP-22 | 规则持久 + "Ask first 优先于 Allow automatically" | Host `data/desktop/approval-rules.json` + `security` 判定顺序 | 同时存在冲突规则时判 ask；规则重启后仍生效 |
| GP-23 | 后台任务（Routine/触发器/Bot 间消息）审批 ~10 分钟过期显示 Expired，仍可选 always-allow | Host pending-approvals 队列 + `expired_at` | 时间注入过期后卡状态=expired，不自动放行；过期项仍允许 always allow |
| GP-24 | Auto Review 覆盖：shell/插件调用/Computer 使用/自动化写入/委派 | `security.AutoReviewGate` + Host 执行前门 | 五类各一例被闸门拦截（block verdict），且拦截原因可读 |
| GP-25 | 密钥输入框：掩码、不进对话、模型不可见 | Host secrets store（已有 `.env.local` mode 0600）+ 组装点排除 | 提交密钥后 session memory / kernel prompt 快照中不含明文（grep 断言）；UI 显示 `****last4` |

## G-4 Computer 视图与 Take over（spec §3）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-30 | 每 Bot 独立 screen；同 Bot 同时只跑一个 computer-use 任务 | `agents/computer_use` 单实例约束（CM-06xx）+ renderer 多 screen 切换 | 同 Bot 并发第二任务被拒并说明；不同 Bot 可并行 |
| GP-31 | Computer 预览显示点击/输入/导航/当前状态；离开预览不影响后台 | Host `screenshot` 帧（真 DISPLAY）+ renderer 帧轮询 | 预览显示真实帧文件（xvfb 下可断言存在且变化）；关闭预览后任务继续 |
| GP-32 | **Take over** 请求卡：密码/passkey/2FA/CAPTCHA/支付/网站要求人工 | kernel `take_over` intent（新增）+ 卡按钮 "Take over" | 断言触发词命中 → intent=take_over 且渲染接管卡；未触发不出现 |
| GP-33 | 接管中用户可实时看屏；完成后点 "I'm done"，再在对话里让 Bot 继续 | IPC `computer:takeover begin/end`（input 锁/放）+ kernel 回合续跑 | begin 后 bot 输入暂停；end 回执时间戳；续跑回合引用接管后页面状态 |
| GP-34 | 密码/验证码不在聊天里输入（官方提醒） | renderer 接管提示文案 + secret 框 | 文案含"不要把密码贴进对话"；聊天输入不含凭证字段 |
| GP-35 | Update Bot's Computer（保留文件）/ Reset（重建、可能丢最近工作）/ Recover（错误态优先，保留持久文件与登录态） | 已有 update/reset（CM-1903/1904）+ 新增 `recover_computer` | update 后 `/workspace` 文件仍在；reset 走快照且提示风险；recover 仅在 unreachable 错误态出现在错误卡上（Settings 不提供） |
| GP-36 | 本地执行与云电脑权限分离：Ask every time / Always allow / Never allow | Host `local_execution` 三档 store + 执行前判定 | Never allow → 本地 shell 直接拒绝；Always allow → 不弹卡；Ask → 弹卡且可 always |
| GP-37 | Route traffic through this computer（可选） | Host 代理开关记录 + 状态显示 | 开关持久化并显示真实生效状态（不可达时 honest residual） |

## G-5 草稿需批准（spec §5.9）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-40 | Bot 要发邮件/Slack 时先出 "New Email"/"New Slack Message" 卡，可编辑收件人与正文 | 已有 `mail_draft`/`channel_send` draft-only 默认（CM-10xx/11xx）→ renderer 草稿编辑器 | 卡内 to/subject/body 可改；改后 kernel 收到编辑值 |
| GP-41 | "Send email"/"Send message" 才真发；"Discard" 不发 | IPC `draft:send/discard` + POST 门控 env | 未点 Send 时渠道无出站；Discard 后无出站且状态落盘 |
| GP-42 | 记忆中的"可发"不等于许可（CM-0306） | kernel 判定不变 + UI 不代客批准 | 记忆写入"可以发"后仍必须弹卡 |

## G-6 群聊（spec §2.4）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-50 | 新建群组选 2–6 个 Bot；自动群名可编辑 | Host rooms store + renderer | <2 或 >6 拒绝；名称可改并持久 |
| GP-51 | 无 `@` 时由 Bot 自行决定响应者；`@BotName` 定向；`@everyone` 全体 | kernel routing policy（`channels`/`agents/teammates`）+ Host room_turn | 三种输入各产出正确 responder 集合（单测断言 responder list） |
| GP-52 | Reply 定向回复某 Bot；Bot 间可传递任务所有权 | `send_to_agent` 已有（CM-14xx）接 room | 回执含目标 agent id；任务转交可见于 transcript |
| GP-53 | **审批请求与 Secret 请求不在群聊显示**（走 DM） | kernel 投递门 + Host | 群聊 transcript 无 approval/secret 卡；同一请求出现在对应 Bot 私聊 |

## G-7 语音（spec §5.3–5.4）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-60 | Voice chat：composer 为空时按钮启动；侧栏显示 in progress；结束留 Voice chat 卡 | renderer voice-chat 态 + `voice_session/voice_end_write` | 非空 composer 禁用按钮；进行中侧栏出现指示；结束后卡存在 |
| GP-61 | Voice memo 卡：Play/Pause + 展开转录 | `send_to_user` voice + renderer `<audio>` | 转录文本与 kernel voice_memo 一致（CM-0107 口述完整句、无 markdown 列表） |

## G-8 Settings 对等（spec §7）

| ID | 官方 tab | 项 | 验收信号 |
|----|---------|----|----------|
| GP-70 | General | Appearance：Follow System / Light / Dark | `nativeTheme.updated` 实测生效（nativeTheme.themeSource 改变 + 截图/像素断言）；重启保持 |
| GP-71 | General | Language：Follow System + 多语言（含简中/繁中） | 切换后 renderer 关键文案改变并持久；kernel `AskLanguage` 不被 UI 语言绑架 |
| GP-72 | General | Bot：Timezone（Routines 用） | 改时区后 Routine 下次触发时间按新 IANA 区计算（CM-0402 断言） |
| GP-73 | General | Auto-review：个人规则 Ask first / Allow automatically 列表可增删 | 规则 CRUD 持久；团队规则显示为**锁定行**（不可编辑，带来源标记） |
| GP-74 | General | Account：登录/登出/切换（本地 profile 语义，不伪造远端） | 显示真实登录态来源（凭证是否配置）；未配置时明确"未登录"而非假装 |
| GP-75 | Computer | Route traffic / Update / Reset（见 GP-35/37） | 同 G-4 |
| GP-76 | Usage & Billing | 每周包含用量与按需用量 | 展示 Host 真实 llm usage 统计（token/次数落盘）；无数据时显示空而非 0 假数 |
| GP-77 | Updates | Check for Updates / Restart to Update；更新不重置 Computer | `ota:check` 真实网络探测（已有）；安装态显示；断言 Computer 文件不受应用更新影响 |

## G-9 通知与未读（spec §7.5）

| ID | 官方行为 | 验收信号 |
|----|----------|----------|
| GP-80 | Bot 完成 / 需要输入时发系统通知；每 Bot 独立开关（CM-0206） | 聚焦时抑制；失焦时 Notification 触发；关闭该 Bot 开关后不发 |
| GP-81 | 应用聚焦时仍显示侧边栏未读 + dock badge | `setBadgeCount` 随未读变化；进入会话后清零 |
| GP-82 | 点击通知跳转到对应对话 | notification click → 激活对应 session id |

## G-10 文件与结果（spec §9）

| ID | 官方行为 | 验收信号 |
|----|----------|----------|
| GP-90 | 文件/图片/链接/工具结果以卡呈现，可预览、保存、打开来源 | 已有 artifact 链扩展：预览支持格式（图片/音视频/HTML/文本）；保存写用户选择路径 |
| GP-91 | 结果引用 `/workspace` 路径纪律；路径可点 | 幻觉路径被拒（CM-0106）；UI 仅渲染真实存在文件 |
| GP-92 | 桌面端可全屏查看图片/视频 | 全屏态可用且可退出 |

## G-12 侧边栏 chrome

| ID | 官方行为 | 验收信号 |
|----|----------|----------|
| GP-A1 | `Cmd/Ctrl+B` 折叠侧边栏 | 加速键生效且状态持久 |
| GP-A2 | 底部 Hidden Bots 入口、Connect apps 入口 | 入口存在且指向真实视图（非死链） |
| GP-A3 | Connect apps = Plugins 面板：浏览/Add/授权/Your plugins/管理启停 | 安装→可用；启停改变 `mcp_list_plugins` 状态；未授权显示 needsAuth 而非假装已连 |

## G-13 Markdown / 链接纪律（官方 spec §5.6）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-93 | 消息与结果里的链接可点击（`[text](url)`；裸 http(s) 由 kernel CM-0111 先规范化为 `[url](url)`） | 共享政策模块 `hosts/desktop/link_discipline.js`（renderer 以 `<script src>` 加载为 `window.__bitbotLinks`，main 进程 `require` 同一文件 → 政策无副本）；`addMsg` 正文唯一入口 `applyLinkBodyTo()`，只 createTextNode/createElement，全仓无 `.body` innerHTML 赋值 | kernel 回合文本含裸 URL 时投递体为 `[url](url)` 且 CM-0111 放行；气泡内出现 `a.msg-link`，`href` 逐字一致；`javascript:`/`data:`/`file:`/`mailto:`/含空白或控制字符的 URL 0 个成为可点链接，原文照抄留成文字；`<img …>` 原文不变成元素 |
| GP-94 | 点击链接在**系统浏览器**打开，不在 Electron 内导航 | `hosts/desktop/link_open.js` `createLinkOpen({openExternal})`：scheme 门 → `shell.openExternal` → `data/desktop/links.jsonl` 审计行；IPC `bitbot:links:open`（preload 白名单 `links.open`）；`setWindowOpenHandler` 一律 `deny` 并转交同一路由，`will-navigate` `preventDefault` 后同路 | 真实点击 → 审计行 `decision:"open_external"` + scheme/host/session/原因齐备；`javascript:` 经 IPC → `refused + scheme_not_allowed` 且 openExternal 未被调用；点击/悬停/新窗口三种来源的触达次数可数；页面 `location` 全程不变 |
| GP-95 | 悬停链接卡片显示预览；悬停不自动导航；批准外部操作/输入凭证前检查目标 | renderer `#link-preview` 卡（主机名为主识别 + 完整 URL + 「在系统浏览器打开」提示，`pointer-events:none`），`mouseover` 显示 / 离开与 Esc 与 blur 收起 | hover 出现卡且主机名=example.com；悬停期间审计文件 0 行、URL 未变、openExternal 触达 0 次；离开后收起；三语文案齐备 |

## G-14 进度更新（官方 spec §5.7）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-96 | 对话流实时显示 Bot 工作进度（工具活动 / Computer 使用 / 创建的文件 / 问题 / 审批请求 / 语音消息） | `host_ffi.executeHostEffects` 在**每个 effect 边界**发进度事件（`phase:start/done` + `index/total/kind/category/label/ok/path`），类别按官方六项映射真实 kind；Host 把事件经 `ctx.onProgress` 交上层：Electron main `broadcast("bitbot:turn-progress")` → renderer `#turn-progress` 实时行；CLI `run_turn` 落 stderr（多端同源，不是桌面专有） | 一次多 effect 回合产生 `2×N` 条事件且顺序为 start(1/N)…done(N/N)；`total` 等于 kernel 返回的真实 effect 数（不猜）；`copy_to_box/skill_write/export_pack/slides_pptx/mail_send/schedule_meeting` 的 done 事件带**真实落盘路径**（探针按 fs 校验存在），失败 effect 的 done 带 `ok:false` + error；审批请求 kind 映射到「审批请求」类而非泛用「工具」 |
| GP-97 | 长时间任务有中间更新（不是最后一次性刷屏） | 进度行随事件原地更新（同一 DOM 节点，非每步新气泡）；provider 慢响应期间仍可见当前工作项；LLM 流式 delta 与 progress 行并存互不覆盖 | 用真实慢 provider（`BITBOT_STUB_LATENCY_MS`）跑一轮：回合**尚未返回**时 DOM 已出现进度行且含 `1/1` 与当前类别文案；回合结束后该行转 done 态；delta 流式气泡不被进度行吃掉（两者节点不同） |
| GP-98 | 进度不谎报 | 事件只由真实执行点发出（未执行的 effect 不会有 done）；被拒绝/never 拦截的 effect 也发 done(`ok:false`)，UI 显示「被拒绝」而不是消失；done 事件的 `path` 只在文件确实存在时才带 | 拒答路径（no_real_path / never 模式）仍有 done 行且 `ok:false`；探针断言 done 事件里出现的每个 path 在磁盘上真实存在；UI 结束后不留"仍在进行"的假态（`data-state` 转 done/cleared） |

## G-15 密钥输入框不进上下文（官方 spec §8.3）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-99 | 受支持的连接提供**安全密钥输入框**（不是普通聊天输入） | renderer `#secret-request` 卡：`<input type="password">` + 遮罩显隐按钮 + Submit/Cancel；提交走 Host IPC `bitbot:secrets:submit`，从不经过 composer / `bitbot:turn` | 卡在对话流中可见且输入框 `type=password`；提交后 composer 值与 session 消息里都不含明文 |
| GP-100 | 值被掩码，**不添加到对话** | Host `secrets.submit` 写 `hosts/desktop/.env.local`（mode 0600，既有通道）+ `data/secrets/vault.json`（`value` 只在 Host 侧，`masked` 为 `****last4`）；renderer 只拿到 `handle`/`masked` | 提交后磁盘 session JSON 与 `data/memory/session.json` grep 不到明文；`secrets.status()` 对同一 key 返回 `masked=****last4` |
| GP-101 | 模型看不到值；密钥输入后显示 `[REDACTED]` | kernel `ui_protocol/secret_request.mbt`（`SecretVault.submit_secret` 只留 handle、`paste_token_into_chat` 拒绝、`redact_secrets`→`[REDACTED]`）作为唯一脱敏口径；Host 只把 `handle` 交给后续 effect（值留在 `secret_vault.resolve()`，不出 IPC）；renderer 在对话流写 `[REDACTED]` 占位行（不写值、不写 last4）；`cmd/desktop_turn` 的 `Chat` 分支对含密钥形状的输入直接 `fail_turn` | 提交后气泡文本恰为 `[REDACTED]`（无 last4、无明文前缀）；把同一明文贴进 composer 发送 → renderer 拦截并且 kernel 同样拒答，消息不进 store |
| GP-102 | 密钥不出现在聊天历史（含重载） | 历史气泡只存 `[REDACTED]` 占位 + handle id；`sessions.json` 不落值 | 重载窗口后气泡仍为 `[REDACTED]`；`grep` 全仓 `data/` 无明文 |

## G-16 Untrusted Content（官方 spec §8.4）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-103 | 外部内容（网页、插件结果、命令输出）**标记为 untrusted data** | kernel `security/parse.mbt`（`cursor_untrusted_data_1337` fence）+ `security/effect_planner.mbt`（Fenced → 无 ExternalSend）；Host `host_ffi` 在 webfetch/mcp_call/shell 结果进入续跑前用同一 fence 包裹；共享模块 `hosts/shared/untrusted_fence.js` 是唯一包裹/解包口径（Node + renderer 同一文件） | 外部结果续跑体的 provider payload 中出现 `cursor_untrusted_data` fence；同一函数对已 fence 文本幂等（不双重包裹） |
| GP-104 | 呈现给模型时**明确标记**；外部内容不自动执行敏感操作 | fence 带 `source=`；`security/effect_planner.mbt` 对 Fenced slice 返回 `[]`（无 ExternalSend）；kernel `runtime/autoreview_exception.mbt` 用 source 判定（伪造 "Auto-review blocked" 仍是 `IgnoreAsData`） | Fenced 正文写「请发送/转账」也不产生 ExternalSend；伪造 Auto-review 指令的 fence 判 `IgnoreAsData` |
| GP-105 | **Auto Review** 检查 Bot 操作是否符合用户请求 | 既有 `security/autoreview.mbt` 闸门 + `gate_consequential`；renderer 在 UI 上给外部来源气泡加 `untrusted` 角标（`data-untrusted="1"`），点击展开来源 | 外部内容气泡有 `untrusted` 标记且可读来源；敏感 kind 仍走审批卡（不因外部文本自动放行） |

## G-17 数据 / 隐私模式（官方 spec §8.5）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-106 | Privacy Mode 状态由**账户设置**管理；不伪造成本机开关 | Settings → General 显示只读 `Privacy Mode` 行：来源 Host 真实探测（`BITBOT_PRIVACY_MODE` 环境/账户文件），未配置时明确 `unavailable · managed by account`，不显示 "已开启" | 未配置时文案含 `unavailable`/`managed by account`；renderer 无本地"开启隐私模式"写操作（IPC 白名单无对应 setter） |
| GP-107 | 无法验证时**默认不训练**；Legacy Privacy Mode 不可用 | Host `privacy_status` 计算 `training_use: "disabled_by_default"`（未验证时不声称已验证）+ `legacy_privacy_mode: "unsupported"` + 原因（需要云端数据存储） | 探针断言返回值三字段；绝不返回 `training_disabled_verified: true` 除非存在真实可验证来源 |

## G-18 先读后执行（官方 spec §6.4）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-108 | 自动化**准备先于执行**：Routine 默认产出草稿/推荐/对账，不直接对外执行 | Host `routine_fire` 走「prepare-then-execute」：默认产出 `draft`（`data/routines/drafts/routine-*.json`，含 prompt/来源/生成时间），并把 `mode=host_routine_draft`、`executed:false` 写进 fire 记录；只有携带 `execute=1`（Routine 明确配置为自动执行，或用户点「执行草稿」）才真正跑动作 | 默认 `fire routine` 返回 `draft_path` 且**没有**出站副作用（无 `channel_send` / 无 `purchase` 记录）；`executed:false` 与 `pretend_executed:false` 同时在回执里 |
| GP-109 | 发送 / 购买 / 删除 / 发布 / 生产变更**需审批** | kernel `gate_consequential` 已覆盖外部发送/购买/删除/发布/生产变更；本轮补齐「草稿→执行」二段式：草稿卡上的「执行」= 一次显式 approved 回合（`--approved`），而不是草稿生成时就执行；审批边界随草稿落盘（`approval_boundary` 字段） | 未 approved 时敏感 kind 只出 `approval_card`（`needs_host_ffi` 且无执行副作用）；approved 后才产生真实执行记录；草稿文件里有 `approval_boundary` 与 `requires_approval:true` |
| GP-110 | 边界诚实：读取类不打扰，写入类必须停 | kernel 按 kind 分档：`ListRoutines/routine_list/credential_list/connectors_probe` 等只读 intent 不弹审批；写入类（`routine_schedule` 的新建/暂停/恢复、`purchase`、`channel_send`、`delete_bot`）必须经 `gate_consequential` 或 `approval_card` | 只读 intent 在未 approved 下仍 `ok:true` 且零 `approval_card`；写入 intent 在未 approved 下必出审批/草稿，实测 `host_results` 无成功执行记录 |

## G-19 跨会话记忆（官方 spec §4.2）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-111 | 记忆内容 = 稳定偏好 / 角色上下文 / 先前工作总结，跨对话保持一致 | Host 侧 `data/memory/desktop-host.json` 按 **bot_id** 分槽（`{version, bots:{<id>:{entries:[…]}}}`，旧扁平数组自动迁移到 `agent-bit`），每个回合以 `--seed-memory` 注入内核；`memory update k=v` 走 `memory_update` effect 落 `profile-vault.json` 并回写分槽 | 同一 Bot 在两个不同 session 里 `memory recall` 都能看到同一条偏好；另一个 Bot 的会话看不到它 |
| GP-112 | 记忆隔离：**对话与学到的上下文每 Bot 独立** | `loadSessionMemory(botId)` / `saveSessionMemory(botId, rows)` 以 Bot 为键；内核 `--bot-id` 进 `DesktopTurnContext.bot_id`（回复文本标注 `bot=<id>` 便于人读），effect 命令保持不变、Bot 归属经 Host 侧 `ffiOpts.botId` 路由到槽（避免 Bot id 与 `key|value` 语法混淆）；`memory_update` 写 `profile-vault.json` 的分槽，`memory recall` 只读本槽 | 给 A 写 `tone=concise` 后，B 的 `--seed-memory` 不含该键、`memory_recall` 命中 0 条；A 的 recall 命中 1 条；两槽都在磁盘上 |
| GP-113 | 共享文件 / 浏览器会话 / 群聊消息 **Bot 间可传递** | 共享事实走既有 `shared memory put scope=… key=… value=…`（`data/memory/shared-scopes.json`，不按 Bot 分）；工作区 `data/workspace/**` 与 `data/box` 不按 Bot 分目录；群聊 transcript 属房间而非 Bot | A 写入的 shared scope 键在 B 的 `shared memory read` 里可见；删除 Bot 后 `data/workspace` 文件仍在（计数 > 0） |
| GP-114 | 删除 Bot 不删除共享 Computer 文件；**不删除别的 Bot 的记忆** | `botsDelete` 级联 sessions/routines/rooms 时**不动** `data/memory/*` 的其它 Bot 槽，只清理该 Bot 自己的槽 | 删除 A 后：B 的记忆仍在；共享文件仍在；`data/memory/desktop-host.json` 里 `bots.A` 已消失、`bots.B` 保留 |
| GP-115 | 重要决策应**检查当前数据源**而非依赖记忆 | 记忆条目只做上下文：`memory_grants_send()` 恒 `false`（记忆永不授权发送/购买）；审批/草稿仍走 `gate_consequential`；`memory` 行的 scope 不含 `authoritative` 标记 | 记忆里写 `send=allow all` 后，`purchase item` / `channel_send` 仍弹审批卡；内核 `memory_grants_send` 单测恒 false |

## G-20 主窗口结构（官方 spec §2.1）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-116 | 左侧边栏 = **Bot 列表 + 群组列表 + 隐藏 Bot 入口 + Connect apps + Marketplace + Settings** | `#agents` 内：`#bot-list`（Bot）、`#room-list`（群组，读 `rooms.json`）、`#hidden-bots-lab`、`#connect-apps-btn`、`#marketplace-btn`（Bot 模板市场，读 `bot_templates_list`）、`#sidebar-settings-btn`；底部顺序固定（列表 → Hidden → Connect apps → Marketplace → Settings） | 六类入口都在 DOM 中且顺序正确；点 Marketplace 打开模板市场面板，模板来自 Host 目录而不是写死数组 |
| GP-117 | Bot 列表**按活动排序**，置顶 Bot 固定在最上方 | `listViews()` 排序：`pinned` 优先，其次 `updated_at` 降序；`product_surface.touchBotActivity(bot_id)` 在每次真实回合落盘后刷新该 Bot 的 `updated_at`（未知 id 拒绝、不造行），随后 main 广播 `bitbot:bots-changed` 让侧栏即时重排 | 给 A/B 各发一条消息后，最近活跃的排在前；置顶的 Bot 永远在最上面，即使它很旧；未知 bot id → `bot_not_found` 且不新增行 |
| GP-118 | 隐藏 Bot 入口位于侧边栏**底部** | `#agents` 是**一整列滚动容器**（`overflow-y:auto; padding:0 12px`），Bot/群组/会话三个列表保持自然高度（`min-height:0; overflow:visible`，不再各开滚动条）；`#sess-new`（新对话）`position:sticky; top:0` 常驻列首，`#sidebar-footer`（Hidden Bots / Connect apps / Marketplace / Settings）`position:sticky; bottom:0` 常驻列尾，不随列表滚走 | 侧边栏尾部区块的 DOM 顺序断言；**长列表（70+ Bot / 30+ 群组）时 `#agents` 自身 `scrollHeight > clientHeight`，footer 与「新对话」按钮仍各自贴住列尾/列首且在 `#agents` 可视矩形内**；隐藏数量徽标随 `bot_hide/unhide` 更新 |
| GP-119 | 中央区域是当前**对话/群聊**消息流；右侧面板可选（对话详情 / Bot 设置 / Computer 预览） | `#log` 是唯一消息流容器；群聊回合在同一 `#log` 渲染（房间 transcript 卡）；右侧 `#machines`（工具）与 `#computer-rail`（Computer 预览）互不遮挡，`body.tools-open` / `body.computer-open` 各自独立开合 | 打开 Computer 预览后中央消息流宽度不被挤为 0；群聊回合落进 `#log` 而不是另开窗口 |

## G-21 Bot 资料管理与创建流程（官方 spec §2.2–§2.3）

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-120 | **Edit Profile** 编辑 名称 / 标签 / 描述 / 头像；头像在侧边栏与对话中显示 | 侧栏 Bot 行右键菜单 →「Edit Profile」→ `#bot-edit-modal`（`bc-name` / `bc-tags` / `bc-job` / `bc-desc` 多行 / `bf-avatar-pick`）；保存时拼 `update bot <id> name=… job=…[ tags=…][ avatar=…] description=…`，空格编码为 `+`。内核 `UpdateBot(bot_id~, name~, job~, description~, avatar~, tags~)` **可选 tags**：为空不产出 `tags=` 字段（Host 理解为「不改」），`tags=-` / `avatar=-` 为显式清空；Host `botsUpdate` 归一化 `normalizeTags`（≤8 条）并把头像路径转 `avatar_data_url`（≤512KB，按扩展名取 mime，失败返回 ""） | `bots.json` 落盘 name/job/description/tags；重开对话框字段回填；侧栏行 `.name`/`.meta`（`· #tag` chips）即刻更新；`avatar_data_url` 以 `data:image/…;base64,` 出现在 `listViews()` 且侧栏/左下 Bot 胶囊渲染 `<img>`；不存在/超大路径 → Host 拒 `invalid_avatar`，旧头像保留 |
| GP-121 | 创建 Bot：Name / Job / Description（多行，含工具、输出格式、安全边界、审批要求）；**创建后自动生成 "New Bot" 占位名**；**创建完成后自动打开对话** | `#bot-new-btn` / `Cmd/Ctrl+N` → `#bot-edit-modal` 创建态（隐藏 Tags 行与头像列、显示模板 chips）；名称为空 → Host `botsCreate` 用 `New Bot`；`description` 原样透传（`enc()` 只把空格换成 `+`，换行保留）；成功后读 `host_payload.bot` 立即 `refreshBots()` 并 `selectBotForChat(created)` 切到该 Bot 的会话 | 空名创建 → `bots.json` 名称 `New Bot`；多行 Description 原样落盘（含 `\n`）；创建后 `#bot-pill .bot-pill-name` = 新 Bot 名且会话已切到它；Host 拒绝时（`ok:false`）对话框保持打开并显示失败原因，不当成功 |
| GP-122 | 头像 = **上传自定义头像**（照片选择） | main 新增 IPC `bitbot:bots:pickAvatar`（`dialog.showOpenDialog` 限 png/jpg/jpeg/webp/gif，`statSync` 拦 >2MB → `avatar_too_large`，返回 `{path,data_url}`）；preload 暴露 `bots.pickAvatar()`；对话框预览在 `bf-avatar-preview`，可清空（提交 `avatar=-`） | E2E 直接经 IPC 走同一条 Host 校验路径后 `refreshBots()`，侧栏 `.sess-avatar img` / Bot 胶囊头像出现；无 X 显示环境时不会自动弹系统框（E2E 用 IPC 覆盖，弹框本身按 residual 记） |
| GP-123 | 侧栏会话组织：**今天 / 昨天 / 更早** 分组；可搜索、重命名、删除会话 | `renderSessionList()` 按 `sessDayBucket(updated_at)`（本地零点）分 `.sess-group`；`#session-search` 过滤标题+预览（空结果给 `sessNoMatch` 空态）；行双击 → `#session-rename-modal`（`sessions.rename`），右键 →「重命名 / 删除」，删除走 `#session-delete-modal`（显式写会话名 + `sessions.delete`），之后重选活动会话并重载 transcript | 分组标题顺序为 今天 → 昨天 → 更早；搜索 `xyz` → 0 行且空态可见，清空恢复原行数；重命名后 `sessions.json` 与侧栏行标题同时变；删除后该 id 从 `sessions.json` 与侧栏同时消失，当前会话回退到剩余会话 |

## 诚实残留（本波不假装）

- 真实云 VM 远程桌面推流：以本机 `DISPLAY`/xvfb + 真截图帧模拟"共享电脑屏幕"，标注 `mode=sandbox_screen`，不宣称云端。
- 生产 OAuth IdP / 生产 Slack·Gmail / 商店签名与公证 / 备案字段：沿用仓库既有 residual 口径。
- `@bot on X`：仅本地入站模拟路由，不调用 X 生产 API。
- 系统浏览器真启动（GP-94）：沙箱内 `shell.openExternal` 依赖 `xdg-open`/默认浏览器，E2E 用 `BITBOT_LINKS_RECORD_PATH` 记录到达 open 入口的 URL 并保持 `opened:false` + 抑制原因——已证明的是 scheme 门、路由与审计，不宣称真能拉起浏览器（需带桌面环境的机器复核）。

- Teach a task 真录屏转 Skill：本波提供"录制会话→生成 Skill 草稿"的本地实现（键盘/鼠标事件采集在 xvfb 下可用则采集，否则要求用户粘贴步骤），草稿态必须人工确认，符合官方"需手动补决策规则/失败处理/审批边界"。
- Bot 头像的**系统文件选择框**：`bitbot:bots:pickAvatar` 已接 `dialog.showOpenDialog`，但无 X/桌面环境时弹框不可自动化；E2E 走同一 IPC 之后的 Host 校验路径（写入路径→`avatar_data_url`）证明的是「选好的路径能被真实校验、落盘与渲染」，不宣称沙箱内能自动点系统框。
- Bot 资料里的**"标签"是本地自由文本**（`≤8` 条，逗号分隔），没有团队目录/权限语义；官方文档只写明标签用于标识，不假装有多租户含义。
