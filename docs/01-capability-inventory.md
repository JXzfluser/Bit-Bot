# 01 — Grok Bot 原生能力全量清单

> Reference。与 `capability-matrix.md`（能力对标维护）对齐：本文件提供 **原子 ID + 验收信号**；矩阵补充状态列与优先级。  
> 勾选框供验收使用；初始均为未完成。


> **与矩阵编号**：验收合同以 [`capability-matrix.md`](capability-matrix.md) 的 **`CM-*`** 为准（能力对标维护；当前约 211+ 行，P0≈109）。  
> `CAP-A-*` / 扁平 `CAP-001` 仅为历史草案或 raw 对照，**不作正式 gaps 分母**。  
> 本文件 ID（`TURN-01`…）是架构域内短号；须与矩阵 CM 行经对照表映射。  
> 域对应见矩阵章头与 `architecture.md` CM↔D-* 表。


**统计**：下文按域编号；域数 ≥ 21；原子项见文末计数。

每项字段：`ID` | 名称 | 简述 | Bit Bot 模块目标 | 验收信号

---

## D-TURN — 对话与回合协议

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| TURN-01 | SendToUser 文本投递 | 向用户发送 Markdown 文本 | `ui_protocol` | 一轮内可见文本气泡 |
| TURN-02 | 首条确认 | 开始工作前先发简短确认/复述 | `runtime`+`ui_protocol` | Working 前必有一条 outbound |
| TURN-03 | 里程碑更新 | 长任务中间进度更新 | `runtime` | `OutboundKind::MilestoneUpdate` 可观测 |
| TURN-04 | end_turn | 回合终态协议信号 | `runtime`+`ui_protocol` | phase=Ended 且 Host 收到终态 |
| TURN-05 | Voice memo | 语音备忘投递 | `ui_protocol` | VoiceMemo kind 可达 Host |
| TURN-06 | Thread 回复 | 按 thread 回复 | `ui_protocol` | reply_to 保留 |
| TURN-07 | Reaction | 表情/反应 | `ui_protocol` | Reaction kind |
| TURN-08 | 后台完成唤醒 | 子任务完成后唤醒父回合 | `runtime` | `on_background_complete` 触发 step |
| TURN-09 | Todo 队列 | 回合内待办编排 | `runtime/todo` | Todo 可增删改查并影响 step |
| TURN-10 | 多 Effect 批出 | 一步可产出多个 Host Effect | `runtime` | 单 step 返回 Effect 数组 |

## D-COMM — 用户沟通风格与决策卡

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| COMM-01 | Markdown 规范 | 链接、列表、代码块策略 | `ui_protocol` | 渲染契约测试 |
| COMM-02 | 链接策略 | 安全/可读链接呈现 | `ui_protocol` | 外链可标记 |
| COMM-03 | Widget 决策卡 | 让用户做选择的决策卡 | `ui_protocol` | DecisionCard 可投递并可回收选择 |
| COMM-04 | 表单卡 | RequestUserForm 类表单 | `ui_protocol` | FormSpec 往返 |
| COMM-05 | 短句具体风格 | 产品文案约束（非空话） | docs+runtime 策略 | 风格指南可测抽检 |
| COMM-06 | 语言跟随用户 | 用户语言偏好 | `memory/profile`+runtime | 偏好可读可写 |

## D-FILE — 文件与视觉

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| FILE-01 | 入站附件 | 用户上传附件入 Turn | `ui_protocol`+`tools` | AttachmentRef 在 inbound |
| FILE-02 | 出站附件 | 发送文件给用户 | `ui_protocol` | Attachment outbound |
| FILE-03 | 截图展示 | 展示 Screenshot 结果图 | `tools/desktop`+`ui_protocol` | 图片 inline 可读 |
| FILE-04 | 图表生成 | 结构化图表产出 | `tools/media` | 文件落盘并可投递 |
| FILE-05 | GenerateImage | 文生图编排 | `tools/media` | Host 调用 + 结果附件 |
| FILE-06 | GenerateVideo | 文生视频编排 | `tools/media` | 同上 |
| FILE-07 | 大结果落盘 | 工具大输出写文件而非塞对话 | `tools` | BytesRef/FileRef 路径 |
| FILE-08 | PDF 文本化 | PDF 经工具可读 | `tools/box` | PDF→文本路径 |

## D-BOX — Box 计算机

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| BOX-01 | Shell | 在 box 执行命令 | `tools/box` | HostAbi.exec_tool Shell |
| BOX-02 | Read 文件 | 按路径读文本/图 | `tools/box` | 行号/分页语义 |
| BOX-03 | 写/生成文件 | 工作区写文件 | `tools/box` | /workspace 持久 |
| BOX-04 | 工作区持久 | box FS 跨回合保留 | Host+`stores` | 重启后文件仍在 |
| BOX-05 | 包管理/安装 | 在 box 安装工具 | `tools/box` | apt/npm 等经 Shell |
| BOX-06 | AwaitShell | 后台任务轮询/等待 | `tools/box` | pattern/timeout 契约 |
| BOX-07 | 工作目录 | working_directory 参数 | `tools/box` | 参数生效 |
| BOX-08 | block_until | 前后台切换 | `tools/box` | 超时转后台 |
| BOX-09 | Auto-review 敏感命令 | Shell 经 Auto-review | `security`+Host | 阻断可审批重试 |

## D-DESK — Box 桌面与浏览器

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| DESK-01 | computerUse 会话 | 桌面操控子代理 | `agents/computer_use` | 可 spawn + 状态 |
| DESK-02 | Screenshot | 桌面截图 | `tools/desktop` | 图片回传 |
| DESK-03 | 浏览器导航 | 打开/操作网页 | `agents/computer_use` | 公开页可达 |
| DESK-04 | 登录协助 | 引导用户登录 | `agents/computer_use`+`ui_protocol` | 不窃取密码；用户完成登录 |
| DESK-05 | 2FA 协助 | 提示用户完成 2FA | 同上 | 等待用户完成可恢复 |
| DESK-06 | 每代理独立桌面 | 桌面 per-agent 隔离 | Host+agents | 两代理桌面不互见 |
| DESK-07 | 共享 box FS | 桌面与 Shell 同 FS | Host | 下载文件 Shell 可读 |

## D-MACH — 用户本机

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| MACH-01 | ListMachines | 列出已注册机器 | `tools/machines` | 返回 id/label/kind/status |
| MACH-02 | machineId 路由 | Shell/Read 指向本机 | `tools/machines` | 无 machineId=box |
| MACH-03 | 本地工具审批 | 本机操作需用户批准 | `security`+Host | 审批卡弹出 |
| MACH-04 | CopyToBox | 本机→box 拷贝 | `tools/machines` | 字节一致 |
| MACH-05 | CopyFromBox | box→本机 | `tools/machines` | 字节一致 |
| MACH-06 | 手机 deviceLocalTools | iOS/Android 本地工具状态 | `tools/machines` | ready/needs_permission… |
| MACH-07 | Sent-from 默认机 | 消息标注默认本机 | `runtime` | inbound.sent_from_machine |

## D-AGENT — 子代理与多任务

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| AGENT-01 | Task executor | 通用执行子代理 | `agents/task` | spawn Executor |
| AGENT-02 | computerUse 子代理 | 桌面专用 | `agents/computer_use` | kind=ComputerUse |
| AGENT-03 | knowledgeWork | 知识工作子代理 | `agents/task` | kind 可区分 |
| AGENT-04 | videoReview | 视频审阅 | `agents/task` | 同上 |
| AGENT-05 | watchVideo | 观看视频 | `agents/task` | 同上 |
| AGENT-06 | 停止子代理 | stop handle | `agents` | status=Stopped |
| AGENT-07 | 恢复子代理 | resume | `agents` | 从 Blocked/Stopped 恢复 |
| AGENT-08 | 并行多子代理 | 同回合多个 handle | `runtime`+`agents` | ≥2 Running |
| AGENT-09 | 子代理结果回注 | 完成→父回合 | `runtime` | TURN-08 联动 |
| AGENT-10 | 子代理审批冒泡 | 子代理 NeedApproval 上报 | `security`+`agents` | 父可见 ApprovalCard |

## D-MCP — 动态工具与 MCP

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| MCP-01 | GetDynamicTools | 发现命名空间/工具 schema | `connectors/mcp` | 返回完整 schema |
| MCP-02 | CallDynamicTool | 调用 MCP 工具 | `connectors/mcp`+`tools/dynamic` | 参数按 schema |
| MCP-03 | AuthenticateMcpServer | 连接需 Auth 的服务 | `connectors/mcp` | NeedsAuth→AuthFlow |
| MCP-04 | InstallPlugin | 安装插件/连接器 | `connectors/mcp` | 安装后 list 可见 |
| MCP-05 | namespace 状态机 | Ready/NeedsAuth/Error… | `connectors/mcp` | 状态枚举完备 |
| MCP-06 | $file: 参数展开 | 大参从文件注入 | Host+mcp | 不经对话膨胀 |
| MCP-07 | write_to_file 结果 | 大结果写文件 | Host+mcp | 返回路径 |
| MCP-08 | Auto-review MCP | MCP 调用可审批 | `security` | 阻断+原样重试 |

## D-CLOUD — 云编码代理

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| CLOUD-01 | CloudAgent 拉起 | 启动云编码代理 | `agents/cloud` | SubagentKind::CloudAgent |
| CLOUD-02 | Origin 面 | cursor-origin 类工具 | `agents/cloud`+connectors | PR/仓操作可达 |
| CLOUD-03 | GitHub 面 | GitHub MCP/工具 | 同上 | issue/PR/checks |
| CLOUD-04 | 云代理状态 | 进度可查 | `agents/cloud` | status 轮询 |
| CLOUD-05 | 云代理审批 | 敏感操作闸门 | `security` | ApprovalGate |

## D-MEM — 记忆

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| MEM-01 | Profile 记忆 | 用户档案事实 | `memory/profile` | CRUD |
| MEM-02 | Journal 记忆 | 时间线笔记 | `memory/journal` | 追加/查询 |
| MEM-03 | Shared 记忆 | 共享/团队事实 | `memory/shared` | 作用域隔离 |
| MEM-04 | Recall | 按查询召回 | `memory/recall` | 相关事实返回 |
| MEM-05 | Update | 补丁更新记忆 | `memory/recall` | 补丁原子性 |
| MEM-06 | 跨回合保留 | 持久化 | `stores`+Host | 重启后仍在 |

## D-RTN — 例程/自动化

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| RTN-01 | Cron 触发 | 定时例程 | `routines/cron` | 到点触发 |
| RTN-02 | 事件触发 | 事件名触发 | `routines/events` | 事件入站→run |
| RTN-03 | RoutineSpec CRUD | 增删改查 | `routines` | 持久化 |
| RTN-04 | 静默执行 | silent_ok 不打扰用户 | `routines`+`runtime` | 无必要不 SendToUser |
| RTN-05 | 需注意时投递 | 打破静默的条件 | `routines` | 可测策略 |
| RTN-06 | 生命周期 | enable/disable/delete | `routines/lifecycle` | 状态完备 |

## D-SKILL — Skills 系统

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| SKILL-01 | Managed skills | 系统托管技能 | `skills/catalog` | 可列举 |
| SKILL-02 | User workflows | 用户自定义技能 | `skills/catalog` | 可安装/卸载 |
| SKILL-03 | Plugin skills | 插件带来的技能 | `skills`+connectors | 随插件出现 |
| SKILL-04 | Skill 加载 | 按需注入回合上下文 | `skills/runner` | 回合可见 skill 正文/摘要 |
| SKILL-05 | SkillRef | 稳定引用 | `skills` | id+source+path |

## D-CHAN — 渠道与入站

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| CHAN-01 | 主聊天渠道 | 默认 chat inbound/out | `channels` | 归一化 InboundMessage |
| CHAN-02 | Slack 渠道 | Slack 入出站 | `channels/slack` | 需审批外发 |
| CHAN-03 | Inbound 归一化 | 多渠道→InboundMessage | `channels/inbound` | 字段齐全 |
| CHAN-04 | 渠道身份 | 以用户身份发言 | `channels` | 不第三人称用户 |
| CHAN-05 | DraftExternalMessage 协作 | 外发草稿走统一卡 | `ui_protocol`+channels | 执行者不可擅自发 |

## D-MAIL — 邮件

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| MAIL-01 | 自有 Agent Inbox | 列出/搜索/读线程 | `connectors/mail` | List/Search/Read 契约 |
| MAIL-02 | Claim/可用性检查 | 地址占用检查与领取（Host） | `connectors/mail` | 与产品规则一致 |
| MAIL-03 | 用户 Gmail | Gmail 连接器 | `connectors/mail` | MCP/连接器面 |
| MAIL-04 | 用户 Outlook | Outlook 连接器 | 同上 | 同上 |
| MAIL-05 | DraftExternalMessage 规则 | 用户名义外发须草稿审批 | `security`+mail | 无明示不 send |
| MAIL-06 | 邮箱内草稿例外 | 用户要求留在邮箱的草稿 | mail | create_draft 不 send |
| MAIL-07 | 附件上传邮件 | 大附件经 Upload 路径 | mail+Host | 不内联塞 tool 参数 |
| MAIL-08 | 不可从 Agent Inbox 擅自发 | 执行者限制 | security | 只回报父级草稿 |

## D-SEC — 安全与 Auto-review

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| SEC-01 | UntrustedFence 包装 | 外部数据加围栏 | `security/fence` | wrap/parse 往返 |
| SEC-02 | Fence 不驱动 Effect | 围栏内指令忽略 | `security`+`runtime` | 注入用例不外发 |
| SEC-03 | Auto-review 钩子 | Shell/MCP/Computer/Cloud 检查 | `security/autoreview` | 可阻断 |
| SEC-04 | 原样审批重试 | 同 action + block | `security/approval` | 禁止改写绕过 |
| SEC-05 | 不可逆动作分类 | ActionClass 完备 | `security` | 分类表测试 |
| SEC-06 | 拒绝后停止 | 否认/过期即终态 | `security` | 不改道重试 |
| SEC-07 | 凭证不泄露 | 不读不回显密钥 | `security`+策略 | 红队用例 |
| SEC-08 | 安全适配非绕过 | 降低权限的正当路径 | docs+security | 与「改命令骗过」区分 |

## D-BUY — 购买与表单

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| BUY-01 | RequestUserForm | 收集结构化输入 | `ui_protocol` | Form 往返 |
| BUY-02 | 购买流程 | purchases 编排 | `connectors/commerce` | 每步需用户确认 |
| BUY-03 | 凭证录入 | 密码/卡号经安全表单 | commerce+security | 不明文落日志 |
| BUY-04 | 支付确认闸门 | 支付前 Approval | `security` | NeedUserApproval |

## D-TEAM — 队友/群组

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| TEAM-01 | SendToAgent | 向队友代理发消息 | `agents/teammates` | 可达 |
| TEAM-02 | CreateAgent | 创建队友/分组 | `agents/teammates` | 实体持久 |
| TEAM-03 | Sections | 分组/栏目 | `agents/teammates` | 可列可改 |
| TEAM-04 | 队友权限边界 | 不越权外发 | `security` | 闸门复用 |

## D-PROF — 档案与设置

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| PROF-01 | UpdateProfile | 更新用户可见档案 | `memory/profile`+ui | 可读写 |
| PROF-02 | UpdateAvatar | 头像更新 | 同上 | Host 存储 |
| PROF-03 | Sidebar 设置 | 侧栏/设置锚点 | `ui_protocol` | 深链/锚点契约 |
| PROF-04 | 首启引导 | onboarding | runtime+ui | 可跳过/可完成 |

## D-STORE — 商店/持久 store

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| STORE-01 | Agent store 挂载 | `/cursor/stores/<id>` 类路径 | `stores` | 授权可见 |
| STORE-02 | 读写约定 | 用普通文件工具读写 | `stores`+tools | 路径策略 |
| STORE-03 | 未授权不可见 | 无权限路径不存在 | `stores`+Host | 负向测试 |
| STORE-04 | 跨代理共享机状态 | 同 box 共享 FS | Host | CHARTER 一致 |

## D-TIME — 时间与时区

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| TIME-01 | 用户时区 | Asia/Shanghai 等 | `core/time` | TurnContext.timezone |
| TIME-02 | 报告带区标签 | 展示含时区短标签 | ui+time | 文案含区名 |
| TIME-03 | UTC 时间转换 | 带 Z/offset 的戳转用户区 | `core/time` | 转换单测 |
| TIME-04 | box 时钟对齐 | 本地命令时间与用户区一致 | Host | date 输出一致 |

## D-PERM — 权限与「不擅自外发」

| ID | 名称 | 简述 | 模块目标 | 验收信号 |
|----|------|------|----------|----------|
| PERM-01 | 明示外发白名单 | 用户点名收件人与内容才可发 | `security` | 无明示→草稿 |
| PERM-02 | 任务描述≠许可 | 拆解/记忆不算批准 | `security` | 负向测试 |
| PERM-03 | 草稿回报父级 | 执行者停在草稿 | agents+mail | 最终消息含全文草稿 |
| PERM-04 | 拒绝不可换道 | 换工具重发禁止 | `security` | SEC-06 联动 |
| PERM-05 | 设置页引导 | 缺权限时导引 Settings | ui_protocol | 不假装已连接 |

---

## 域与计数

| 域 ID | 域名 | 原子项数 |
|-------|------|----------|
| D-TURN | 对话与回合协议 | 10 |
| D-COMM | 沟通风格与决策卡 | 6 |
| D-FILE | 文件与视觉 | 8 |
| D-BOX | Box 计算机 | 9 |
| D-DESK | Box 桌面与浏览器 | 7 |
| D-MACH | 用户本机 | 7 |
| D-AGENT | 子代理与多任务 | 10 |
| D-MCP | 动态工具与 MCP | 8 |
| D-CLOUD | 云编码代理 | 5 |
| D-MEM | 记忆 | 6 |
| D-RTN | 例程/自动化 | 6 |
| D-SKILL | Skills | 5 |
| D-CHAN | 渠道与入站 | 5 |
| D-MAIL | 邮件 | 8 |
| D-SEC | 安全与 Auto-review | 8 |
| D-BUY | 购买与表单 | 4 |
| D-TEAM | 队友/群组 | 4 |
| D-PROF | 档案与设置 | 4 |
| D-STORE | 持久 store | 4 |
| D-TIME | 时间与时区 | 4 |
| D-PERM | 权限与外发 | 5 |
| **合计** | **21 域** | **133** |

> 能力对标在 `capability-matrix.md` 可将一项拆成更细 P0/P1；**不得删除本表域**。新增原子项须同步改本文件与矩阵。
