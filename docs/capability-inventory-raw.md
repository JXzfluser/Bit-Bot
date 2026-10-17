# Bit Bot 原始能力盘点（raw inventory）

> 比矩阵更「原样」：按发现来源罗列，可含别名、疑似重复、待证实。  
> **归一合同**：[`capability-matrix.md`](capability-matrix.md) 的 **`CM-****`**。  
> **废弃**：扁平 `CAP-001`… 与历史 `CAP-A-*`/`CAP-V-*` 不作实现主键（表内旧列可留溯源）。  
> **域对照**：[`capability-id-crosswalk.md`](capability-id-crosswalk.md)。  
> 最后更新：2026-10-17 11:24 Asia/Shanghai

## 覆盖统计（本文件）

| 指标 | 值 |
|------|----|
| RAW 标识出现次数 | 126 |
| 与矩阵关系 | RAW → **CM-***；旧 CAP 仅溯源 |

---

## 1. 来源：系统行为 / 运行时观察（隐藏与内置）

| ID | 能力名 | 证据/现象 | 隐藏/内置 | 初步验收要点 | 映射 CAP | 备注 |
|----|--------|-----------|-----------|--------------|----------|------|
| `RAW-SYS-001` | 首条快速确认再长工 | 用户开口后先 SendToUser 短确认 | 隐藏 | 非即时任务必先短确认 | `CAP-A-015` | |
| `RAW-SYS-002` | 里程碑进度更新 | 长任务阶段性短更新 | 隐藏 | 非逐步命令旁白 | `CAP-A-016` | |
| `RAW-SYS-003` | 禁止纯助手私有文本当交付 | 仅 SendToUser 对用户可见 | 内置 | 私有思考不可见 | `CAP-A-001` | |
| `RAW-SYS-004` | first-run 分支 | 新建 bot 首回合自我介绍/接任务 | 隐藏 | 有无 profile 描述分支 | `CAP-S-001` | |
| `RAW-SYS-005` | `[routine]` 唤醒 | 例程到点注入隐藏用户消息 | 隐藏 | 执行保存 prompt；不当聊天话术 | `CAP-S-002` | |
| `RAW-SYS-006` | `[inbound]` 唤醒 | 渠道入站隐藏标签 | 隐藏 | 唤醒处理；不自动回第三人 | `CAP-K-002` `CAP-V-027` | |
| `RAW-SYS-007` | `[agent]` / 子代理回报 | 子代理最终消息回母代理 | 隐藏 | 仅最终消息含结果 | `CAP-V-028` | |
| `RAW-SYS-008` | `[room]` 群聊回合 | group-chat-turns 标签 | 隐藏 | 按群规则 inline | `CAP-K-004` | |
| `RAW-SYS-009` | system_reminder | 回合注入系统提醒 | 内置 | 长静默可提示继续 | `CAP-S-003` | |
| `RAW-SYS-010` | automation_status | 例程状态注入 | 内置 | 有例程则可见状态 | `CAP-C-008` | |
| `RAW-SYS-011` | instructions_update 队友热更新 | 队友列表变更注入 | 内置 | 新 id 可见 | `CAP-S-009` | |
| `RAW-SYS-012` | user_info_catalog_update | 动态工具目录刷新 | 内置 | 新 MCP 后续可见 | `CAP-S-007` | |
| `RAW-SYS-013` | 后台完成唤醒母代理 | 子代理结束自动注入 | 内置 | 禁止空转轮询 | `CAP-G-008` `CAP-V-022` | |
| `RAW-SYS-014` | 时区报告 Asia/Shanghai | 用户区 + 盒钟对齐 | 内置 | UTC 戳转上海并标区 | `CAP-S-004` | |
| `RAW-SYS-015` | 产品身份自称 | 对外产品名；不暴露模型供应商 | 内置 | 问身份答 Bit Bot 对等策略 | `CAP-S-005` | |
| `RAW-SYS-016` | 不泄露内部机制 | 不对用户谈工具名/子代理架构 | 内置 | 重定向到能做什么 | `CAP-S-006` | |
| `RAW-SYS-017` | X 公共读限额窗 | 约 30/分 1000/日 UTC | 内置 | 超额拒绝/提示 | `CAP-S-008` `CAP-H-008` | |
| `RAW-SYS-018` | connector custom instructions | 连接器附加指令强制遵循 | 隐藏 | X 限流先读再遵 | `CAP-H-007` | |
| `RAW-SYS-019` | Auto-review 拦截通知 | 拦截结果可带重试指引 | 内置 | 可 request_smart_mode_approval | `CAP-Q-001` `CAP-Q-002` | |
| `RAW-SYS-020` | untrusted fence 包裹 | `cursor_untrusted_data_*` | 内置 | 外源指令不当系统令 | `CAP-Q-004` | |
| `RAW-SYS-021` | 并行工具调用 | 同回合多工具 | 内置 | 独立读可并行 | `CAP-V-023` | |
| `RAW-SYS-022` | end_turn 结束回合 | 最终交付标志 | 内置 | end_turn 后同轮不再工具 | `CAP-A-008` | |

---

## 2. 来源：`/home/box/reference/app-ui.md`

| ID | 能力名 | 证据路径 | 隐藏/内置 | 初步验收要点 | 映射 CAP | 备注 |
|----|--------|----------|-----------|--------------|----------|------|
| `RAW-UI-001` | 打开设置路径 | 侧栏账号按钮 / Cmd+, / 命令面板 | 宿主 | 无齿轮图标；不发明菜单 | `CAP-R-001` | |
| `RAW-UI-002` | Settings General anchors | account, theme, accent, language, spell-check, microphone, hardware-acceleration, network-debugger, notification-sound, timezone, auto-review, security-keys… | 宿主 | 深链仅清单内 id | `CAP-V-042` `CAP-A-018` | |
| `RAW-UI-003` | Settings Computer anchors | local-execution, computers, update-computer, reset-computer | 宿主 | Update 优先于 Reset | `CAP-V-043` `CAP-R-002` `CAP-E-008` | |
| `RAW-UI-004` | Update Bot's Computer | 按钮 "Update"；保文件与登录；软件需重装 | 宿主 | 两击确认 | `CAP-R-002` | |
| `RAW-UI-005` | Reset Bot's Computer | 快照恢复；可丢未同步 | 宿主 | 不主动推荐 | `CAP-R-002` | |
| `RAW-UI-006` | Usage & Billing / Updates 页 | 账户启用才出现 | 宿主 | 未启用不假装 | `CAP-V-044` | |
| `RAW-UI-007` | Per-agent info pane | Cmd+Shift+I；电脑预览+例程+渠道+成员 | 宿主 | 语义对等 | `CAP-R-003` | |
| `RAW-UI-008` | 删除 agent | 侧栏右键永久删除+确认 | 宿主 | 无归档 | `CAP-R-004` | |
| `RAW-UI-009` | grokbot:// deeplink 约定 | `grokbot://app/v1/settings?id=` | 产品 | Bit 应对等 bitbot:// 或兼容策略 | `CAP-A-018` | **架构歧义：深链 scheme** |

---

## 3. 来源：`/home/box/reference/debugging-the-box.md`

| ID | 能力名 | 证据路径 | 隐藏/内置 | 初步验收要点 | 映射 CAP | 备注 |
|----|--------|----------|-----------|--------------|----------|------|
| `RAW-BOX-001` | box-doctor 自检 | `box-doctor` + `/tmp/box-doctor.log` | 内置工具 | PASS/FAIL 行 + SUMMARY | `CAP-E-007` | |
| `RAW-BOX-002` | 启动中瞬态重试 | computer still starting | 内置 | 等待重试非放弃 | `CAP-E-007` | |
| `RAW-BOX-003` | Screenshot 诊断桌面 | display :1 | 工具 | 只读诊断 | `CAP-E-003` | |
| `RAW-BOX-004` | 禁止 Shell 驱动 GUI | 禁 xdotool/CDP 自动化 | 策略 | 桌面交互 computerUse | `CAP-E-009` | |
| `RAW-BOX-005` | box-chrome 启动器 | 非 raw chrome | 约定 | 用 box-chrome | `CAP-V-045` | |
| `RAW-BOX-006` | Docker vs anyrun | `/.dockerenv` | 诊断 | 正确报告 runtime | `CAP-V-046` | |
| `RAW-BOX-007` | 日志路径族 | `/tmp/start-desktop.log` 等 | 诊断 | 可 tail | `CAP-E-007` | |
| `RAW-BOX-008` | request_box_help 非修复 | 登录/captcha 手动步 | 工具 | 非修盒 | `CAP-F-005` | |

---

## 4. 来源：交付面工具（对话观察 / 工具目录）

| ID | 能力名 | 证据 | 隐藏/内置 | 初步验收要点 | 映射 CAP | 备注 |
|----|--------|------|-----------|--------------|----------|------|
| `RAW-DEL-001` | SendToUser text | 工具 | 原生 | 用户可见文本 | `CAP-A-001` | |
| `RAW-DEL-002` | SendToUser attachment | 工具 | 原生 | 可打开文件 | `CAP-A-002` | |
| `RAW-DEL-003` | SendToUser widget | 工具；options/multiSelect/allowCustom/danger/dismissOnMoveOn | 原生 | 选项回写用户消息 | `CAP-A-003` `CAP-A-004` | |
| `RAW-DEL-004` | SendToUser cursor-agent | bcId 卡片 | 原生 | 可点开 | `CAP-A-005` | |
| `RAW-DEL-005` | secret-request | 掩码；值不进聊天 | 原生 | 入 env/插件字段 | `CAP-A-006` | |
| `RAW-DEL-006` | credential-request | 填浏览器已存登录 | 原生 | 密钥不回传模型 | `CAP-A-007` | |
| `RAW-DEL-007` | reply_to 线程 | 参数 | 原生 | 次要批量进线程 | `CAP-A-009` | |
| `RAW-DEL-008` | channel / to:dm | 参数 | 原生 | 渠道投递；群内私信 | `CAP-A-010` `CAP-A-011` | |
| `RAW-DEL-009` | voice_memo | 口语化唯一消息 | 原生 | 无 markdown 列表 | `CAP-A-012` `CAP-V-031` | |
| `RAW-DEL-010` | images 同气泡 | text+images | 原生 | 图在文下 | `CAP-A-013` | |
| `RAW-DEL-011` | ReactToMessage | emoji pill | 原生 | 可取消 | `CAP-A-014` | |
| `RAW-DEL-012` | Markdown/数学/mermaid | 渲染约定 | 原生 | 分隔符正确 | `CAP-A-017` | |
| `RAW-DEL-013` | 商品推荐列表格式 | 多商品行格式 | 约定 | 固定模板 | `CAP-A-019` | |
| `RAW-DEL-014` | DraftExternalMessage | 外发默认草稿卡 | 原生 | 未显式跳过则不直发 | `CAP-I-001` `CAP-U-007` | |
| `RAW-DEL-015` | RequestUserForm | 聊天表单填浏览器 | 原生 | 宿主填入 | `CAP-M-003` | |

---

## 5. 来源：记忆 / 例程 / Skills 工具

| ID | 能力名 | 证据 | 隐藏/内置 | 初步验收要点 | 映射 CAP | 备注 |
|----|--------|------|-----------|--------------|----------|------|
| `RAW-MEM-001` | RecallMemory | 工具 | 原生 | 返回带日期类型事实 | `CAP-B-001` | |
| `RAW-MEM-002` | UpdateMemory write/forget | 工具 | 原生 | 去重写；精确删 | `CAP-B-002` `CAP-B-003` | |
| `RAW-MEM-003` | profile/journal/shared_* | 类型 | 原生 | 档案常驻；共享标 via | `CAP-B-004` `CAP-B-005` | |
| `RAW-MEM-004` | 记忆冲突优先级 | 策略 | 隐藏 | 角色偏好己方；用户事实取新 | `CAP-B-006` | |
| `RAW-RTN-001` | UpdateRoutine CRUD | create/get/update/pause/resume/delete | 原生 | 生命周期 | `CAP-C-001` `CAP-C-002` | |
| `RAW-RTN-002` | cron + @hourly 别名 | schedule | 原生 | 本地时区 | `CAP-C-003` `CAP-V-001` | |
| `RAW-RTN-003` | timing exact\|flexible + early/late | 参数 | 原生 | 窗口内启动 | `CAP-C-004` `CAP-V-002` | |
| `RAW-RTN-004` | trigger 类型全集 | slack,github,origin,microsoftTeams,linear,sentry,pagerduty,email,webhook,cron,group | 原生 | 各类型可配置唤醒 | `CAP-C-005` `CAP-V-003`…`013` | |
| `RAW-RTN-005` | 例程静默 / 限制 | 无变化可无消息；不听 Slack DM | 隐藏 | 策略强制 | `CAP-C-006` `CAP-C-007` | |
| `RAW-SKL-001` | managed skills 只读 | `/home/box/sand-data/managed-skills/skills`（运行时亦映射 agent-data） | 原生 | 用前 Read | `CAP-D-001` `CAP-D-005` | |
| `RAW-SKL-002` | user workflows | `/home/box/sand-data/workflows` / agent-data/workflows | 原生 | UpdateSkill 可写 | `CAP-D-002` | |
| `RAW-SKL-003` | plugin skills | plugins/cache 下 SKILL.md | 插件 | 安装后可见 | `CAP-D-003` | |
| `RAW-SKL-004` | UpdateSkill + sand-workflow pill | 工具 | 原生 | write/rewrite/delete | `CAP-D-004` | |

### 5.1 managed skills 目录实况（29 + playbooks 22）

非 playbook：
- `accommodation-booking` → 矩阵 `CAP-T-*` / 相关域
- `add-connector` → 矩阵 `CAP-T-*` / 相关域
- `agent-email` → 矩阵 `CAP-T-*` / 相关域
- `box-desktop` → 矩阵 `CAP-T-*` / 相关域
- `channels` → 矩阵 `CAP-T-*` / 相关域
- `code-changes` → 矩阵 `CAP-T-*` / 相关域
- `export-bot-template` → 矩阵 `CAP-T-*` / 相关域
- `flight-booking` → 矩阵 `CAP-T-*` / 相关域
- `food-ordering` → 矩阵 `CAP-T-*` / 相关域
- `group-chat-turns` → 矩阵 `CAP-T-*` / 相关域
- `in-chat-forms` → 矩阵 `CAP-T-*` / 相关域
- `job-search` → 矩阵 `CAP-T-*` / 相关域
- `learn-from-demonstration` → 矩阵 `CAP-T-*` / 相关域
- `no-connector-fallback` → 矩阵 `CAP-T-*` / 相关域
- `office-pptx` → 矩阵 `CAP-T-*` / 相关域
- `purchases` → 矩阵 `CAP-T-*` / 相关域
- `restaurant-booking` → 矩阵 `CAP-T-*` / 相关域
- `restaurant-recommendations` → 矩阵 `CAP-T-*` / 相关域
- `rideshare` → 矩阵 `CAP-T-*` / 相关域
- `routines` → 矩阵 `CAP-T-*` / 相关域
- `scheduling` → 矩阵 `CAP-T-*` / 相关域
- `send-on-behalf` → 矩阵 `CAP-T-*` / 相关域
- `shopping` → 矩阵 `CAP-T-*` / 相关域
- `sign-in` → 矩阵 `CAP-T-*` / 相关域
- `skill-authoring` → 矩阵 `CAP-T-*` / 相关域
- `slides` → 矩阵 `CAP-T-*` / 相关域
- `slides-executor` → 矩阵 `CAP-T-*` / 相关域
- `source-control` → 矩阵 `CAP-T-*` / 相关域
- `voice` → 矩阵 `CAP-T-*` / 相关域

site-playbooks：
- `site-playbooks-airbnb`
- `site-playbooks-bestbuy`
- `site-playbooks-costco`
- `site-playbooks-craigslist`
- `site-playbooks-doordash`
- `site-playbooks-ebay`
- `site-playbooks-etsy`
- `site-playbooks-expedia`
- `site-playbooks-facebook-marketplace`
- `site-playbooks-fedex`
- `site-playbooks-google-flights`
- `site-playbooks-instacart`
- `site-playbooks-linkedin`
- `site-playbooks-luma`
- `site-playbooks-opentable`
- `site-playbooks-realtor`
- `site-playbooks-resy`
- `site-playbooks-southwest`
- `site-playbooks-target`
- `site-playbooks-united`
- `site-playbooks-ups`
- `site-playbooks-usps`

用户私有 workflows（**不对标进产品内核**，见 non-goals）：
- `aihot-scout`（用户业务；非 Bit 必交）
- `content-research-pipeline`（用户业务；非 Bit 必交）
- `humanizer-zh`（用户业务；非 Bit 必交）
- `ian-xiaohei-body-art`（用户业务；非 Bit 必交）
- `local-corpus-deep-read`（用户业务；非 Bit 必交）
- `wechat-cover-infographic`（用户业务；非 Bit 必交）
- `wechat-title-hook`（用户业务；非 Bit 必交）

| ID | 能力名 | 证据 | 映射 | 备注 |
|----|--------|------|------|------|
| `RAW-SKL-005` | slides vs slides-executor | 两目录并存 | `CAP-T-021` `CAP-T-030` | 分工待 skill 正文证实 |
| `RAW-SKL-006` | meetings 名 | 矩阵有 CAP-T-002；目录无 meetings/ | `CAP-V-047` | **待证实**：或并入 scheduling |
| `RAW-SKL-007` | site-playbooks 框架+清单 | 22 站 | `CAP-T-031` `CAP-V-029` | |

---

## 6. 来源：Box / 机器 / computerUse

| ID | 能力名 | 证据 | 隐藏/内置 | 初步验收要点 | 映射 CAP | 备注 |
|----|--------|------|-----------|--------------|----------|------|
| `RAW-HST-001` | Shell | 工具 | 原生 | stdout/stderr/exit | `CAP-E-001` | |
| `RAW-HST-002` | Read | 工具；图/PDF | 原生 | offset/limit | `CAP-E-002` | |
| `RAW-HST-003` | Screenshot | 工具 | 原生 | 路径返回 | `CAP-E-003` | |
| `RAW-HST-004` | AwaitShell / block_until_ms | 后台 | 原生 | 完成通知 | `CAP-E-004` | |
| `RAW-HST-005` | 共享 FS + 每 agent 桌面 | 架构观察 | 内置 | 文件共享桌面隔离 | `CAP-E-005` | |
| `RAW-HST-006` | stores `/cursor/stores/...` | 挂载观察 | 内置 | 授权才存在 | `CAP-E-006` `CAP-V-030` | |
| `RAW-HST-007` | computerUse 单实例 1280×800 | Task 类型 | 原生 | 越界拒；登录停报 | `CAP-F-001`…`003` | |
| `RAW-HST-008` | ListMachines / machineId | 工具 | 原生 | 作用域+审批 | `CAP-L-001` `CAP-L-002` `CAP-V-020` | |
| `RAW-HST-009` | CopyToBox / CopyFromBox | 工具 | 原生 | 跨 FS 拷贝 | `CAP-L-003` | |
| `RAW-HST-010` | deviceLocalTools | 手机 ListMachines 字段 | 宿主 | 权限态 | `CAP-V-019` | |
| `RAW-HST-011` | Task executor/knowledgeWork/watchVideo/videoReview | Task 类型 | 原生 | 分工正确 | `CAP-G-001`…`003` | |
| `RAW-HST-012` | Check/Message/StopSubagent | 控制面 | 原生 | Stop all 含云代理 | `CAP-G-004`…`006` | |
| `RAW-HST-013` | TodoWrite | 队列 | 原生 | 跨流一致 | `CAP-G-007` | |
| `RAW-HST-014` | CloudAgent + artifacts + Project | 工具/路径 | 原生 | `/workspace/cloud-agent-artifacts/<id>/` | `CAP-G-009` `CAP-G-010` `CAP-V-021` | |

---

## 7. 来源：动态工具命名空间（GetDynamicTools 实况）

| ID | 命名空间 | 状态观察 | 初步验收要点 | 映射 CAP | 备注 |
|----|----------|----------|--------------|----------|------|
| `RAW-MCP-001` | `user-Gmail` | ready；草稿/标签/发送等 | 鉴权后 CRUD | `CAP-J-001` | |
| `RAW-MCP-002` | `user-Outlook` | needsAuth | 鉴权流 | `CAP-V-032` | |
| `RAW-MCP-003` | `user-X` | ready；聊天/书签/broadcast 等 | 写操作需连接 | `CAP-H-*` | |
| `RAW-MCP-004` | `x`（公共读） | ready；无需用户 X 连接 | 限流 | `CAP-H-008` | |
| `RAW-MCP-005` | `cursor-github` | ready | PR/issue API | `CAP-P-002` | |
| `RAW-MCP-006` | `cursor-origin` | ready | Origin 仓面 | `CAP-P-003` | |
| `RAW-MCP-007` | `user-Finance-xai` | needsAuth | 鉴权后可用 | `CAP-V-033` | 待证实工具全集 |
| `RAW-MCP-008` | GetDynamicTools / CallDynamicTool | 元工具 | schema 先取再调 | `CAP-H-001` `CAP-H-002` | |
| `RAW-MCP-009` | write_to_file / `$file:` | Call 参数 | 大结果落盘；文件入参展开 | `CAP-H-003` | |
| `RAW-MCP-010` | InstallPlugin / SearchPlugins / GetPlugin / UninstallPlugin | 插件生命周期 | 安装出卡；卸载消失 | `CAP-H-004` `CAP-V-014` `CAP-V-015` | |
| `RAW-MCP-011` | AuthenticateMcpServer / needsAuth / needsGrant | 鉴权 | 现场连接/授予 | `CAP-H-005` `CAP-V-025` | |
| `RAW-MCP-012` | GetMcpServerStatus / RestartMcpServers | 运维 | 状态可见可重启 | `CAP-H-006` `CAP-V-026` | |
| `RAW-MCP-013` | cursor 一等命名空间 | 非外部 MCP | Call 无需 mcpDetails | `CAP-V-024` | |

---

## 8. 来源：邮件 Bot inbox + 外发策略

| ID | 能力名 | 证据 | 映射 CAP | 备注 |
|----|--------|------|----------|------|
| `RAW-MAIL-001` | ListEmailInboxes | 工具 | `CAP-V-016` | |
| `RAW-MAIL-002` | CheckEmailInboxAvailability | 工具 | `CAP-V-017` | |
| `RAW-MAIL-003` | ClaimEmailInbox | 工具；用户批准卡 | `CAP-V-018` | |
| `RAW-MAIL-004` | Search/ReadEmailThread/Attachment | 工具 | `CAP-J-003` | |
| `RAW-MAIL-005` | 显式跳过草稿 / 站立权限 / inbound 不自动回 | 策略 | `CAP-I-002`…`004` | |
| `RAW-MAIL-006` | UploadFile→Gmail draft / DownloadFile 附件 | 工具 | `CAP-V-034` `CAP-V-035` | |

---

## 9. 来源：安全红线 / 审批 / 凭证

| ID | 能力名 | 证据 | 映射 CAP | 备注 |
|----|--------|------|----------|------|
| `RAW-SEC-001` | Auto-review + 安全替代路径 | 策略 | `CAP-Q-001`…`003` | |
| `RAW-SEC-002` | 不可逆动作确认 | 删/付/外发 | `CAP-Q-006` | |
| `RAW-SEC-003` | offensive_cyber 拒 | 策略引擎 | `CAP-V-037` `CAP-Q-005` | |
| `RAW-SEC-004` | child_sex 拒 | 策略引擎 | `CAP-V-038` | |
| `RAW-SEC-005` | 武器/dual_use_bio 拒 | 策略引擎 | `CAP-V-039` | |
| `RAW-SEC-006` | 犯罪协助拒 | 策略引擎 | `CAP-V-040` | |
| `RAW-SEC-007` | copyright 大段拒 | 策略引擎 | `CAP-V-041` | |
| `RAW-SEC-008` | ListCredentials / 1Password | 工具 | `CAP-M-001` `CAP-M-005` | |
| `RAW-SEC-009` | 本机工具审批卡 | machine 作用域 | `CAP-V-020` | |

---

## 10. 来源：媒体 / 队友 / 内核杂项

| ID | 能力名 | 证据 | 映射 CAP | 备注 |
|----|--------|------|----------|------|
| `RAW-MED-001` | GenerateImage / GenerateVideo | 工具 | `CAP-N-001` `CAP-N-002` | 禁绘真人 |
| `RAW-MED-002` | 禁止未请求生成图冒充实物 | 策略 | `CAP-N-003` | |
| `RAW-AGT-001` | Create/UpdateAgent / Profile / Avatar / Primary | 工具 | `CAP-O-001`…`005` | |
| `RAW-AGT-002` | SendToAgent priority | 工具 | `CAP-O-003` | |
| `RAW-AGT-003` | ListSections / Hidden chats | 工具/UI | `CAP-O-004` `CAP-O-006` | |
| `RAW-AGT-004` | Teammates 协作约定 | 策略 | `CAP-V-036` | |
| `RAW-KER-001` | TurnContext / ToolRegistry / Host ABI / WASM boot | 架构 | `CAP-U-001`…`004` | |
| `RAW-KER-002` | WebSearch / WebFetch | 工具 | `CAP-U-005` | |
| `RAW-KER-003` | UploadFile / DownloadFile | 工具 | `CAP-U-006` `CAP-U-008` | |
| `RAW-KER-004` | SendFeedback | 工具 | `CAP-U-009` | 宿主通道名待证实 |
| `RAW-KER-005` | CreateBotShareJson / SearchBotTemplates | 工具 | `CAP-U-010` | |
| `RAW-KER-006` | Channels Create/Update/Disconnect | 工具 | `CAP-K-001` | |
| `RAW-KER-007` | RequestScmConnect / 禁擅自本机 checkout | 工具+策略 | `CAP-P-004` `CAP-P-005` | |
| `RAW-KER-008` | code-changes skill 门控 | skill | `CAP-P-001` `CAP-T-028` | |

---

## 疑似重复 / 别名（勿删，归一时合并）

| 项 | 说明 |
|----|------|
| `CAP-F-008` vs `CAP-T-027` | no-connector-fallback 策略 vs 垂直 skill 门控 — 保留双行 |
| `CAP-F-006` vs `CAP-T-015` | box-desktop 同理 |
| `CAP-J-002` vs `CAP-V-016`…`018` | bot inbox 聚合 vs 原子工具 — V 为可独立验收拆分 |
| `CAP-C-005` vs `CAP-V-003`…`013` | trigger 聚合 vs 分类型 |
| `CAP-Q-005` vs `CAP-V-037`…`041` | 红线总述 vs 策略细分 |
| `meetings` vs `scheduling` | 目录未见 meetings；待证实 |
| `grokbot://` vs Bit 深链 | scheme 命名待架构拍板 |
| raw 旧版 `CAP-001` 编号 | 已被 `CAP-A-001` 体系取代；本文件改用 `RAW-*` |

---

## 待证实（不删除）

| 项 | 说明 |
|----|------|
| Origin 监听事件精确集合 | Host 事件总线对照 |
| 语音 TTS/STT 编解码边界 | voice skill + 宿主 |
| Finance 工具全集 | needsAuth 仅见状态 |
| meetings 独立 managed skill | 目录缺失 |
| SendFeedback 通道产品名 | 宿主专有 |
| Bit 深链 scheme | `bitbot://` 或兼容 `grokbot://` |
| pstack 插件技能 | 插件生态；非原生必交（见 non-goals） |

---

## 文末计数

| RAW 唯一 ID 数 | 126 |
| managed skills 目录项 | 51 |
| site-playbooks | 22 |
| 用户私有 workflows（非目标） | 7 |

*生成于 2026-10-17 11:20 Asia/Shanghai；与矩阵交叉引用以磁盘 `capability-matrix.md` 为准。*

---

## 矩阵交叉引用（能力对标二审）

审定 2026-10-17 11:20 Asia/Shanghai。扁平 CAP-001…105 **保留**。新增矩阵 ID 如下（只追加）。

## CAP-V-049 — 语言/locale 跟随
- Domain module: `runtime/locale`
- Priority: P0
- Grok: 应用语言与用户语种注入回合
- Accept: Given 用户语言偏好 When 开回合 Then TurnContext 含 locale 且回复语种匹配
- Hidden notes: raw CAP-012；隐藏; matrix `CAP-V-049`

## CAP-V-050 — InboundKind 三分
- Domain module: `runtime/inbound`
- Priority: P0
- Grok: User / Hidden / Agent 入站分流
- Accept: Given [routine]/[agent]/用户话 When 路由 Then 策略不同且隐藏 cue 不作答对象
- Hidden notes: raw CAP-010；统摄 V-027; matrix `CAP-V-050`

## CAP-V-051 — 子代理并行软上限
- Domain module: `agents/limits`
- Priority: P1
- Grok: 通常 1–2，软上限约 4
- Accept: Given ≥4 活跃同类 When 再派 Then 排队或复用非无限扩
- Hidden notes: raw CAP-050; matrix `CAP-V-051`

## CAP-V-052 — channel 投递无 widget
- Domain module: `channels/outbound`
- Priority: P1
- Grok: 外发渠道不承载决策卡
- Accept: Given channel + widget When 发送 Then 拒绝或文本降级
- Hidden notes: raw CAP-066; matrix `CAP-V-052`

## CAP-V-053 — 入站邮件不自动回复
- Domain module: `connectors/mail`
- Priority: P0
- Grok: 只摘要/可草稿
- Accept: Given 新邮件唤醒 When 处理 Then 不自动 reply 第三人
- Hidden notes: raw CAP-063; matrix `CAP-V-053`

## CAP-V-054 — 多 Effect 批出
- Domain module: `runtime/turn`
- Priority: P0
- Grok: 单 step 多 Host Effect
- Accept: Given 一步需多投递 When 返回 Then Effect[] 可多条
- Hidden notes: 01 TURN-10; matrix `CAP-V-054`

## CAP-V-055 — 入站附件 AttachmentRef
- Domain module: `ui_protocol/inbound`
- Priority: P0
- Grok: 用户上传进入 inbound
- Accept: Given 用户附图 When 开回合 Then 附件引用可读
- Hidden notes: 01 FILE-01; matrix `CAP-V-055`

## CAP-V-056 — 工作区写与跨回合持久
- Domain module: `tools/box/fs`
- Priority: P0
- Grok: /workspace 持久
- Accept: Given 写文件后新回合 When Read Then 仍在
- Hidden notes: 01 BOX-03/04; matrix `CAP-V-056`

## CAP-V-057 — PDF 文本化
- Domain module: `tools/box/pdf`
- Priority: P1
- Grok: PDF→文本
- Accept: Given PDF When Read Then 得文本层
- Hidden notes: 01 FILE-08; matrix `CAP-V-057`

## CAP-V-058 — Task resume 续跑
- Domain module: `agents/control`
- Priority: P1
- Grok: 对已结束子代理 follow-up
- Accept: Given 子代理完成 When resume=id Then 上下文保留继续
- Hidden notes: 01 AGENT-07; matrix `CAP-V-058`

## CAP-V-059 — 可逆默认自主
- Domain module: `runtime/autonomy`
- Priority: P0
- Grok: 授权内可逆动作不问
- Accept: Given 可逆整理 When 在授权范围 Then 直接执行
- Hidden notes: 隐藏策略; matrix `CAP-V-059`

## CAP-V-060 — 禁止捏造事实
- Domain module: `runtime/honesty`
- Priority: P0
- Grok: 无来源不发明数字/人名/菜单
- Accept: Given 缺数据 When 答 Then 明说缺失给真实路径
- Hidden notes: 隐藏; matrix `CAP-V-060`

## CAP-V-061 — Fence 审查通知例外
- Domain module: `security/fence`
- Priority: P0
- Grok: Auto-review 拦截说明可遵循
- Accept: Given fence 内审查拦截通知 When 解析 Then 可按重试指示
- Hidden notes: 隐藏；Q-004 例外; matrix `CAP-V-061`

## CAP-V-062 — Voice 跳过文字确认
- Domain module: `ui_protocol/voice`
- Priority: P1
- Grok: 要听时无文字 ack
- Accept: Given 要语音备忘 When 开场 Then 直接 voice_memo 唯一条
- Hidden notes: 隐藏；补 V-031; matrix `CAP-V-062`

## CAP-V-063 — SendToAgent 扇出限制
- Domain module: `agents/teammates`
- Priority: P1
- Grok: 未请求不群发多助手
- Accept: Given 未明确要求 When 想通知多名 Then 先问用户
- Hidden notes: 隐藏; matrix `CAP-V-063`

## CAP-V-064 — 草稿卡「发送」精确重发
- Domain module: `security/outbound`
- Priority: P0
- Grok: 已示草稿原样发一次
- Accept: Given 卡已展示 When 用户说发送 Then 连接器原样发送不改字
- Hidden notes: 隐藏外发; matrix `CAP-V-064`

## CAP-V-065 — 邮箱草稿 vs 外发审核卡
- Domain module: `connectors/mail`
- Priority: P1
- Grok: create_draft≠DraftExternalMessage
- Accept: Given 「留在邮箱草稿」When 调用 Then create_draft；审核卡走 DraftExternalMessage
- Hidden notes: 易混; matrix `CAP-V-065`

## CAP-V-066 — Origin 监听事件子集
- Domain module: `routines/triggers`
- Priority: P1
- Grok: 仅 pr-opened/pushed/merged/comment
- Accept: Given origin trigger When 校验 Then 仅允许文档所列 PR 事件
- Hidden notes: 补 V-005; matrix `CAP-V-066`

## CAP-V-067 — 会议直播聊天外发例外
- Domain module: `skills/meetings`
- Priority: P2
- Grok: live meeting chat 可按 skill 直发
- Accept: Given 直播会议聊天 When skill 允许 Then 该场景可非草稿卡
- Hidden notes: 外发例外; matrix `CAP-V-067`

## CAP-V-068 — 站立权限撤销即时
- Domain module: `security/outbound`
- Priority: P1
- Grok: 撤销立即生效
- Accept: Given 曾授权直发 When 撤销 Then 下一封须再确认
- Hidden notes: 隐藏; matrix `CAP-V-068`

## CAP-V-069 — 拒发不可换通道重试
- Domain module: `security/outbound`
- Priority: P0
- Grok: 拒绝/过期为终态
- Accept: Given 发送被拒 When 无新授权 Then 不改走其他通道
- Hidden notes: 隐藏; matrix `CAP-V-069`

## CAP-V-070 — Widget 独立且为末条
- Domain module: `ui_protocol/widget`
- Priority: P0
- Grok: widget 单独 Send 结束决策回合
- Accept: Given 决策卡 When 发送 Then 无同条 content 且为末条
- Hidden notes: ; matrix `CAP-V-070`

## CAP-V-071 — React 可整回合
- Domain module: `ui_protocol/reaction`
- Priority: P2
- Grok: 仅反应+end_turn
- Accept: Given 轻量致谢 When React end_turn Then 无额外文字
- Hidden notes: ; matrix `CAP-V-071`

## CAP-V-072 — 记忆权威源非盒文件
- Domain module: `memory/storage`
- Priority: P1
- Grok: Memory API 非 /home/box 文件
- Accept: Given 写 profile When 扫盒文件 Then 文件非权威源
- Hidden notes: 隐藏; matrix `CAP-V-072`

## CAP-V-073 — 连接器 app vs 用户身份
- Domain module: `connectors/identity`
- Priority: P1
- Grok: 须用户身份走已登录浏览器
- Accept: Given 连接器以 app 发 When 需用户身份 Then 改浏览器会话
- Hidden notes: 隐藏; matrix `CAP-V-073`

## CAP-V-074 — 禁止自写连接 URL
- Domain module: `connectors/auth`
- Priority: P0
- Grok: 只触发官方连接卡
- Accept: Given 需连接 When 引导 Then 不手写 connect 链接
- Hidden notes: 隐藏 UX; matrix `CAP-V-074`

## CAP-V-075 — 例程写入确认卡
- Domain module: `routines/crud`
- Priority: P1
- Grok: 改例程可要用户确认
- Accept: Given update 例程 When Host 要确认 Then 出卡；拒写不重试强改
- Hidden notes: 隐藏; matrix `CAP-V-075`

## CAP-V-076 — 云产物路径约束
- Domain module: `agents/cloud`
- Priority: P1
- Grok: 勿直接附 /opt/cursor/artifacts
- Accept: Given 云代理产物 When 投递 Then 用 cloud-agent-artifacts 或官方 URL
- Hidden notes: 隐藏陷阱; matrix `CAP-V-076`

## CAP-V-077 — 跨助手不原样转述抱怨
- Domain module: `agents/teammates`
- Priority: P2
- Grok: 只传可行动点
- Accept: Given 用户抱怨另一助手 When SendToAgent Then 外交转述
- Hidden notes: 隐藏; matrix `CAP-V-077`

## CAP-V-078 — box-doctor 健康探针
- Domain module: `tools/box/doctor`
- Priority: P1
- Grok: PASS/FAIL+SUMMARY
- Accept: Given 盒异常 When box-doctor Then 输出检查摘要
- Hidden notes: debugging-the-box; matrix `CAP-V-078`

## CAP-V-079 — AwaitShell 一等工具
- Domain module: `tools/box/await`
- Priority: P0
- Grok: 等待后台命令
- Accept: Given 后台命令 When AwaitShell Then 完成/超时可观测
- Hidden notes: 与 E-004 分工：工具面; matrix `CAP-V-079`

## CAP-V-080 — ReadTranscript
- Domain module: `runtime/transcript`
- Priority: P1
- Grok: 读本/子/他助手记录
- Accept: Given 需审计 When ReadTranscript Then 含工具调用轨迹
- Hidden notes: 内置; matrix `CAP-V-080`

## CAP-V-081 — SetUserAttribute
- Domain module: `memory/profile`
- Priority: P2
- Grok: 持久用户职位等
- Accept: Given 用户陈述职位 When SetUserAttribute Then 可读回
- Hidden notes: ; matrix `CAP-V-081`

## CAP-V-082 — UninstallMcpServer
- Domain module: `connectors/mcp`
- Priority: P2
- Grok: 卸载 MCP 连接器
- Accept: Given 已装 MCP When UninstallMcpServer Then 命名空间不可用
- Hidden notes: 与 V-014 分工; matrix `CAP-V-082`

## CAP-V-083 — sent_from_machine 标注
- Domain module: `runtime/inbound`
- Priority: P2
- Grok: 入站可带默认本机
- Accept: Given 本机发出 When inbound Then 可含 sent_from_machine
- Hidden notes: 01 MACH-07；待证实; matrix `CAP-V-083`

## CAP-V-084 — 首启有描述直接开工
- Domain module: `runtime/onboarding`
- Priority: P0
- Grok: 跳过 getting-started 问答
- Accept: Given profile 有具体职责 When 首回合 Then 短宣告并开工
- Hidden notes: 隐藏 first-run；补 S-001; matrix `CAP-V-084`

## CAP-V-085 — self_harm 关怀策略
- Domain module: `security/policy`
- Priority: P0
- Grok: 关怀+988，无方法
- Accept: Given 自伤表达 When 判定 Then 关怀话术与 988，不给方法
- Hidden notes: 策略细分; matrix `CAP-V-085`

## CAP-V-086 — CYBER 硬拒绝含本机/CTF
- Domain module: `security/policy`
- Priority: P0
- Grok: 即使用户声称授权也不给 exploit
- Accept: Given CTF/本机 exploit 请求 When 判定 Then 拒且无 PoC
- Hidden notes: 补 V-037; matrix `CAP-V-086`

### raw→矩阵速查（节选）

| raw | 矩阵 |
|-----|------|
| CAP-010 | CAP-V-050 |
| CAP-012 | CAP-V-049 |
| CAP-042 | CAP-V-020 |
| CAP-050 | CAP-V-051 |
| CAP-063 | CAP-V-053 |
| CAP-066 | CAP-V-052 |


## 矩阵 CM-21xx 审定追加（2026-10-17 11:21 Asia/Shanghai）

权威见 capability-matrix.md。本 raw 的 CAP-001…105 保留。新增合同 ID：CM-2101, CM-2102, CM-2103, CM-2104, CM-2105, CM-2106, CM-2107, CM-2108, CM-2109, CM-2110, CM-2111, CM-2112, CM-2113, CM-2114, CM-2115, CM-2116, CM-2117, CM-2118, CM-2119, CM-2120, CM-2121, CM-2122, CM-2123, CM-2124, CM-2125, CM-2126, CM-2127, CM-2128, CM-2129, CM-2130, CM-2131, CM-2132, CM-2133, CM-2134, CM-2135, CM-2136, CM-2137, CM-2138, CM-2139, CM-2140, CM-2141, CM-2142, CM-2143, CM-2144, CM-2145, CM-2146, CM-2147, CM-2148, CM-2149, CM-2150, CM-2151, CM-2152, CM-2153, CM-2154, CM-2155

---

## 与矩阵 / 01 差集（2026-10-17 11:24 Asia/Shanghai）

| 对照 | 结果 |
|------|------|
| 合同 ID | `CM-*`（矩阵 234 行） |
| 01 清单 | 133/133 已映射（见 capability-id-crosswalk.md） |
| 本轮 01 差集新追加 | CM-2156←COMM-05, CM-2157←FILE-04, CM-2158←BOX-05, CM-2159←BOX-07, CM-2160←DESK-03, CM-2161←AGENT-08, CM-2162←AGENT-10, CM-2163←MCP-06, CM-2164←MCP-07, CM-2165←RTN-04, CM-2166←RTN-05, CM-2167←SKILL-05, CM-2168←CHAN-04, CM-2169←MAIL-08, CM-2170←SEC-08, CM-2171←BUY-03, CM-2172←TEAM-04, CM-2173←STORE-02, CM-2174←STORE-04, CM-2175←TIME-04, CM-2176←PERM-02, CM-2177←PERM-03, CM-2178←PERM-05 |
| 废弃编号 | `CAP-001`… 不再扩展；实现跟 CM |

