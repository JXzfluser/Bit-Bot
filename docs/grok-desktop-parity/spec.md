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

## 诚实残留（本波不假装）

- 真实云 VM 远程桌面推流：以本机 `DISPLAY`/xvfb + 真截图帧模拟"共享电脑屏幕"，标注 `mode=sandbox_screen`，不宣称云端。
- 生产 OAuth IdP / 生产 Slack·Gmail / 商店签名与公证 / 备案字段：沿用仓库既有 residual 口径。
- `@bot on X`：仅本地入站模拟路由，不调用 X 生产 API。
- Teach a task 真录屏转 Skill：本波提供"录制会话→生成 Skill 草稿"的本地实现（键盘/鼠标事件采集在 xvfb 下可用则采集，否则要求用户粘贴步骤），草稿态必须人工确认，符合官方"需手动补决策规则/失败处理/审批边界"。
