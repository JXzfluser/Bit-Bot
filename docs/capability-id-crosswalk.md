# 能力 ID 对照表（CM ↔ D-* ↔ 01）

> 最后更新：2026-10-17 11:24 Asia/Shanghai  
> **合同 ID**：`CM-****`（capability-matrix.md）  
> **架构域短号**：`D-*`（architecture.md）  
> **架构原子短号**：`TURN-01` 等（01-capability-inventory.md，133）  
> **废弃**：扁平 `CAP-001`…`CAP-105` 与历史 `CAP-A-*`/`CAP-V-*` 不作实现主键。

## 前缀 → 域

| CM 前缀 | 架构域短号 D-* |
|--------|----------------|
| CM-01xx | D-TURN / D-COMM |
| CM-02xx | D-PROF |
| CM-03xx | D-MEM |
| CM-04xx | D-RTN |
| CM-05xx | D-SKILL |
| CM-06xx | D-BOX |
| CM-07xx | D-MACH |
| CM-08xx | D-DESK |
| CM-09xx | D-MCP |
| CM-10xx | D-MAIL |
| CM-11xx | D-CHAN |
| CM-12xx | D-AGENT |
| CM-13xx | D-CLOUD |
| CM-14xx | D-TEAM |
| CM-15xx | D-SEC / D-PERM |
| CM-16xx | D-FILE |
| CM-17xx | D-FILE（tools/web） |
| CM-18xx | D-SKILL / D-BUY |
| CM-19xx | D-PROF（Host UI） |
| CM-20xx | D-TIME / D-TURN |
| CM-21xx | 补遗（多域） |

## 01 原子 → CM（133 全覆盖）

| 01 ID | 名称 | D-* | CM ID |
|-------|------|-----|-------|
| `TURN-01` | SendToUser 文本投递 | `D-TURN` | `CM-0101` |
| `TURN-02` | 首条确认 | `D-TURN` | `CM-0102` |
| `TURN-03` | 里程碑更新 | `D-TURN` | `CM-0103` |
| `TURN-04` | end_turn | `D-TURN` | `CM-0104` |
| `TURN-05` | Voice memo | `D-TURN` | `CM-0107` |
| `TURN-06` | Thread 回复 | `D-TURN` | `CM-0109` |
| `TURN-07` | Reaction | `D-TURN` | `CM-2101`, `CM-2128` |
| `TURN-08` | 后台完成唤醒 | `D-TURN` | `CM-1208`, `CM-2133` |
| `TURN-09` | Todo 队列 | `D-TURN` | `CM-0112` |
| `TURN-10` | 多 Effect 批出 | `D-TURN` | `CM-2138` |
| `COMM-01` | Markdown 规范 | `D-COMM` | `CM-0111`, `CM-2103` |
| `COMM-02` | 链接策略 | `D-COMM` | `CM-0111` |
| `COMM-03` | Widget 决策卡 | `D-COMM` | `CM-0105`, `CM-2102` |
| `COMM-04` | 表单卡 | `D-COMM` | `CM-0804` |
| `COMM-05` | 短句具体风格 | `D-COMM` | `CM-2156` |
| `COMM-06` | 语言跟随用户 | `D-COMM` | `CM-2002` |
| `FILE-01` | 入站附件 | `D-FILE` | `CM-2137` |
| `FILE-02` | 出站附件 | `D-FILE` | `CM-0106` |
| `FILE-03` | 截图展示 | `D-FILE` | `CM-0605`, `CM-1605` |
| `FILE-04` | 图表生成 | `D-FILE` | `CM-2157` |
| `FILE-05` | GenerateImage | `D-FILE` | `CM-1601` |
| `FILE-06` | GenerateVideo | `D-FILE` | `CM-1602` |
| `FILE-07` | 大结果落盘 | `D-FILE` | `CM-0902` |
| `FILE-08` | PDF 文本化 | `D-FILE` | `CM-0602` |
| `BOX-01` | Shell | `D-BOX` | `CM-0601` |
| `BOX-02` | Read 文件 | `D-BOX` | `CM-0602` |
| `BOX-03` | 写/生成文件 | `D-BOX` | `CM-0603` |
| `BOX-04` | 工作区持久 | `D-BOX` | `CM-0603` |
| `BOX-05` | 包管理/安装 | `D-BOX` | `CM-2158` |
| `BOX-06` | AwaitShell | `D-BOX` | `CM-0604` |
| `BOX-07` | 工作目录 | `D-BOX` | `CM-2159` |
| `BOX-08` | block_until | `D-BOX` | `CM-0604` |
| `BOX-09` | Auto-review 敏感命令 | `D-BOX` | `CM-1502` |
| `DESK-01` | computerUse 会话 | `D-DESK` | `CM-0801`, `CM-1202` |
| `DESK-02` | Screenshot | `D-DESK` | `CM-0605` |
| `DESK-03` | 浏览器导航 | `D-DESK` | `CM-2160` |
| `DESK-04` | 登录协助 | `D-DESK` | `CM-0803` |
| `DESK-05` | 2FA 协助 | `D-DESK` | `CM-0803` |
| `DESK-06` | 每代理独立桌面 | `D-DESK` | `CM-0606` |
| `DESK-07` | 共享 box FS | `D-DESK` | `CM-0606` |
| `MACH-01` | ListMachines | `D-MACH` | `CM-0701` |
| `MACH-02` | machineId 路由 | `D-MACH` | `CM-0702` |
| `MACH-03` | 本地工具审批 | `D-MACH` | `CM-0702` |
| `MACH-04` | CopyToBox | `D-MACH` | `CM-0703` |
| `MACH-05` | CopyFromBox | `D-MACH` | `CM-0704` |
| `MACH-06` | 手机 deviceLocalTools | `D-MACH` | `CM-0705` |
| `MACH-07` | Sent-from 默认机 | `D-MACH` | `CM-0706` |
| `AGENT-01` | Task executor | `D-AGENT` | `CM-1201` |
| `AGENT-02` | computerUse 子代理 | `D-AGENT` | `CM-1202` |
| `AGENT-03` | knowledgeWork | `D-AGENT` | `CM-1203` |
| `AGENT-04` | videoReview | `D-AGENT` | `CM-1204` |
| `AGENT-05` | watchVideo | `D-AGENT` | `CM-1204` |
| `AGENT-06` | 停止子代理 | `D-AGENT` | `CM-1207` |
| `AGENT-07` | 恢复子代理 | `D-AGENT` | `CM-2136` |
| `AGENT-08` | 并行多子代理 | `D-AGENT` | `CM-2161` |
| `AGENT-09` | 子代理结果回注 | `D-AGENT` | `CM-1208` |
| `AGENT-10` | 子代理审批冒泡 | `D-AGENT` | `CM-2162` |
| `MCP-01` | GetDynamicTools | `D-MCP` | `CM-0901` |
| `MCP-02` | CallDynamicTool | `D-MCP` | `CM-0902` |
| `MCP-03` | AuthenticateMcpServer | `D-MCP` | `CM-0903` |
| `MCP-04` | InstallPlugin | `D-MCP` | `CM-0904` |
| `MCP-05` | namespace 状态机 | `D-MCP` | `CM-0905`, `CM-2134` |
| `MCP-06` | $file: 参数展开 | `D-MCP` | `CM-2163` |
| `MCP-07` | write_to_file 结果 | `D-MCP` | `CM-2164` |
| `MCP-08` | Auto-review MCP | `D-MCP` | `CM-1502` |
| `CLOUD-01` | CloudAgent 拉起 | `D-CLOUD` | `CM-1301` |
| `CLOUD-02` | Origin 面 | `D-CLOUD` | `CM-1303` |
| `CLOUD-03` | GitHub 面 | `D-CLOUD` | `CM-1304` |
| `CLOUD-04` | 云代理状态 | `D-CLOUD` | `CM-1302` |
| `CLOUD-05` | 云代理审批 | `D-CLOUD` | `CM-1306` |
| `MEM-01` | Profile 记忆 | `D-MEM` | `CM-0301` |
| `MEM-02` | Journal 记忆 | `D-MEM` | `CM-0302` |
| `MEM-03` | Shared 记忆 | `D-MEM` | `CM-0303` |
| `MEM-04` | Recall | `D-MEM` | `CM-0304` |
| `MEM-05` | Update | `D-MEM` | `CM-0305` |
| `MEM-06` | 跨回合保留 | `D-MEM` | `CM-0301`, `CM-0603` |
| `RTN-01` | Cron 触发 | `D-RTN` | `CM-0402` |
| `RTN-02` | 事件触发 | `D-RTN` | `CM-0406` |
| `RTN-03` | RoutineSpec CRUD | `D-RTN` | `CM-0401` |
| `RTN-04` | 静默执行 | `D-RTN` | `CM-2165` |
| `RTN-05` | 需注意时投递 | `D-RTN` | `CM-2166` |
| `RTN-06` | 生命周期 | `D-RTN` | `CM-0413`, `CM-0414` |
| `SKILL-01` | Managed skills | `D-SKILL` | `CM-0501` |
| `SKILL-02` | User workflows | `D-SKILL` | `CM-0502` |
| `SKILL-03` | Plugin skills | `D-SKILL` | `CM-0503` |
| `SKILL-04` | Skill 加载 | `D-SKILL` | `CM-0504` |
| `SKILL-05` | SkillRef | `D-SKILL` | `CM-2167` |
| `CHAN-01` | 主聊天渠道 | `D-CHAN` | `CM-0108` |
| `CHAN-02` | Slack 渠道 | `D-CHAN` | `CM-1102` |
| `CHAN-03` | Inbound 归一化 | `D-CHAN` | `CM-1101`, `CM-2003` |
| `CHAN-04` | 渠道身份 | `D-CHAN` | `CM-2168` |
| `CHAN-05` | DraftExternalMessage 协作 | `D-CHAN` | `CM-1005` |
| `MAIL-01` | 自有 Agent Inbox | `D-MAIL` | `CM-1001` |
| `MAIL-02` | Claim/可用性检查 | `D-MAIL` | `CM-1002`, `CM-1003` |
| `MAIL-03` | 用户 Gmail | `D-MAIL` | `CM-1006` |
| `MAIL-04` | 用户 Outlook | `D-MAIL` | `CM-2120` |
| `MAIL-05` | DraftExternalMessage 规则 | `D-MAIL` | `CM-1005` |
| `MAIL-06` | 邮箱内草稿例外 | `D-MAIL` | `CM-1007` |
| `MAIL-07` | 附件上传邮件 | `D-MAIL` | `CM-1604` |
| `MAIL-08` | 不可从 Agent Inbox 擅自发 | `D-MAIL` | `CM-2169` |
| `SEC-01` | UntrustedFence 包装 | `D-SEC` | `CM-1504` |
| `SEC-02` | Fence 不驱动 Effect | `D-SEC` | `CM-1504` |
| `SEC-03` | Auto-review 钩子 | `D-SEC` | `CM-1502` |
| `SEC-04` | 原样审批重试 | `D-SEC` | `CM-1503` |
| `SEC-05` | 不可逆动作分类 | `D-SEC` | `CM-1501` |
| `SEC-06` | 拒绝后停止 | `D-SEC` | `CM-2143` |
| `SEC-07` | 凭证不泄露 | `D-SEC` | `CM-1506` |
| `SEC-08` | 安全适配非绕过 | `D-SEC` | `CM-2170` |
| `BUY-01` | RequestUserForm | `D-BUY` | `CM-0804` |
| `BUY-02` | 购买流程 | `D-BUY` | `CM-1802` |
| `BUY-03` | 凭证录入 | `D-BUY` | `CM-2171` |
| `BUY-04` | 支付确认闸门 | `D-BUY` | `CM-1802`, `CM-1501` |
| `TEAM-01` | SendToAgent | `D-TEAM` | `CM-1402` |
| `TEAM-02` | CreateAgent | `D-TEAM` | `CM-1401` |
| `TEAM-03` | Sections | `D-TEAM` | `CM-1403` |
| `TEAM-04` | 队友权限边界 | `D-TEAM` | `CM-2172` |
| `PROF-01` | UpdateProfile | `D-PROF` | `CM-0201` |
| `PROF-02` | UpdateAvatar | `D-PROF` | `CM-0202` |
| `PROF-03` | Sidebar 设置 | `D-PROF` | `CM-0203` |
| `PROF-04` | 首启引导 | `D-PROF` | `CM-2152`, `CM-2006` |
| `STORE-01` | Agent store 挂载 | `D-STORE` | `CM-0609`, `CM-2119` |
| `STORE-02` | 读写约定 | `D-STORE` | `CM-2173` |
| `STORE-03` | 未授权不可见 | `D-STORE` | `CM-2119` |
| `STORE-04` | 跨代理共享机状态 | `D-STORE` | `CM-2174` |
| `TIME-01` | 用户时区 | `D-TIME` | `CM-2001` |
| `TIME-02` | 报告带区标签 | `D-TIME` | `CM-2001` |
| `TIME-03` | UTC 时间转换 | `D-TIME` | `CM-2001` |
| `TIME-04` | box 时钟对齐 | `D-TIME` | `CM-2175` |
| `PERM-01` | 明示外发白名单 | `D-PERM` | `CM-1501` |
| `PERM-02` | 任务描述≠许可 | `D-PERM` | `CM-2176` |
| `PERM-03` | 草稿回报父级 | `D-PERM` | `CM-2177` |
| `PERM-04` | 拒绝不可换道 | `D-PERM` | `CM-2143` |
| `PERM-05` | 设置页引导 | `D-PERM` | `CM-2178` |

## CM 主表 → D-* / 01

| CM ID | 能力 | D-* | 01 短号 |
|-------|------|-----|---------|
| `CM-0101` | SendToUser 文本投递 | D-TURN/D-COMM | `TURN-01` |
| `CM-0102` | 首条确认语义 | D-TURN/D-COMM | `TURN-02` |
| `CM-0103` | 里程碑进度更新 | D-TURN/D-COMM | `TURN-03` |
| `CM-0104` | end_turn 语义 | D-TURN/D-COMM | `TURN-04` |
| `CM-0105` | widget 决策卡 | D-TURN/D-COMM | `COMM-03` |
| `CM-0106` | 附件投递 attachment | D-TURN/D-COMM | `FILE-02` |
| `CM-0107` | voice_memo 语音备忘 | D-TURN/D-COMM | `TURN-05` |
| `CM-0108` | 频道目标 channel target | D-TURN/D-COMM | `CHAN-01` |
| `CM-0109` | 线程 thread 投递 | D-TURN/D-COMM | `TURN-06` |
| `CM-0110` | reaction 入站 | D-TURN/D-COMM | — |
| `CM-0111` | 链接与 markdown 纪律 | D-TURN/D-COMM | `COMM-01`, `COMM-02` |
| `CM-0112` | TodoWrite 任务清单 | D-TURN/D-COMM | `TURN-09` |
| `CM-0201` | UpdateAgentProfile 名称/标题/描述 | D-PROF | `PROF-01` |
| `CM-0202` | UpdateAvatar 头像 | D-PROF | `PROF-02` |
| `CM-0203` | 侧边栏可见性 sidebar | D-PROF | `PROF-03` |
| `CM-0204` | Hidden/系统助手 | D-PROF | — |
| `CM-0205` | Per-agent 信息面板 | D-PROF | — |
| `CM-0206` | Per-assistant 通知设置 | D-PROF | — |
| `CM-0301` | Memory profile 层 | D-MEM | `MEM-01`, `MEM-06` |
| `CM-0302` | Memory journal 层 | D-MEM | `MEM-02` |
| `CM-0303` | Memory shared 层 | D-MEM | `MEM-03` |
| `CM-0304` | Recall 工具 | D-MEM | `MEM-04` |
| `CM-0305` | Update Memory 工具 | D-MEM | `MEM-05` |
| `CM-0306` | 记忆不驱动不可逆动作 | D-MEM | — |
| `CM-0401` | UpdateRoutine create/get/update | D-RTN | `RTN-03` |
| `CM-0402` | Cron 调度（用户时区） | D-RTN | `RTN-01` |
| `CM-0403` | Flexible timing / 分钟相位 | D-RTN | — |
| `CM-0404` | 工作日/安静时段默认 | D-RTN | — |
| `CM-0405` | 最短间隔 5 分钟 | D-RTN | — |
| `CM-0406` | 事件触发 Slack | D-RTN | `RTN-02` |
| `CM-0407` | 事件触发 GitHub | D-RTN | — |
| `CM-0408` | 事件触发 Origin | D-RTN | — |
| `CM-0409` | 事件触发 Teams/Linear/Sentry/PagerDuty | D-RTN | — |
| `CM-0410` | 邮件 inbox 触发 | D-RTN | — |
| `CM-0411` | Webhook 触发 | D-RTN | — |
| `CM-0412` | Group listeners | D-RTN | — |
| `CM-0413` | pause / resume | D-RTN | `RTN-06` |
| `CM-0414` | 自过期 / 终态删除 | D-RTN | `RTN-06` |
| `CM-0415` | 创建确认卡 | D-RTN | — |
| `CM-0416` | 投递目的地行 | D-RTN | — |
| `CM-0417` | automation_status 提醒 | D-RTN | — |
| `CM-0501` | Managed skills 目录 | D-SKILL | `SKILL-01` |
| `CM-0502` | User skills | D-SKILL | `SKILL-02` |
| `CM-0503` | Plugin skills | D-SKILL | `SKILL-03` |
| `CM-0504` | 按需 Read 技能 | D-SKILL | `SKILL-04` |
| `CM-0505` | UpdateSkill | D-SKILL | — |
| `CM-0506` | skill-authoring | D-SKILL | — |
| `CM-0507` | site-playbooks-* | D-SKILL | — |
| `CM-0601` | Shell（box） | D-BOX | `BOX-01` |
| `CM-0602` | Read（box） | D-BOX | `FILE-08`, `BOX-02` |
| `CM-0603` | 文件系统持久化 | D-BOX | `BOX-03`, `BOX-04`, `MEM-06` |
| `CM-0604` | AwaitShell | D-BOX | `BOX-06`, `BOX-08` |
| `CM-0605` | Screenshot | D-BOX | `FILE-03`, `DESK-02` |
| `CM-0606` | 共享 box / 独立桌面 | D-BOX | `DESK-06`, `DESK-07` |
| `CM-0607` | box-doctor 自检 | D-BOX | — |
| `CM-0608` | Docker vs anyrun 识别 | D-BOX | — |
| `CM-0609` | agent store 挂载 | D-BOX | `STORE-01` |
| `CM-0701` | ListMachines | D-MACH | `MACH-01` |
| `CM-0702` | machineId 路由 Shell/Read | D-MACH | `MACH-02`, `MACH-03` |
| `CM-0703` | CopyToBox | D-MACH | `MACH-04` |
| `CM-0704` | CopyFromBox | D-MACH | `MACH-05` |
| `CM-0705` | deviceLocalTools（手机） | D-MACH | `MACH-06` |
| `CM-0706` | Sent-from-machine 默认 | D-MACH | `MACH-07` |
| `CM-0801` | computerUse 子代理 | D-DESK | `DESK-01` |
| `CM-0802` | box-chrome 启动器 | D-DESK | — |
| `CM-0803` | sign-in 技能流 | D-DESK | `DESK-04`, `DESK-05` |
| `CM-0804` | RequestUserForm / in-chat-forms | D-DESK | `COMM-04`, `BUY-01` |
| `CM-0805` | request_box_help | D-DESK | — |
| `CM-0806` | 登录态持久 | D-DESK | — |
| `CM-0901` | GetDynamicTools | D-MCP | `MCP-01` |
| `CM-0902` | CallDynamicTool | D-MCP | `FILE-07`, `MCP-02` |
| `CM-0903` | Authenticate / needsAuth | D-MCP | `MCP-03` |
| `CM-0904` | InstallPlugin / add-connector | D-MCP | `MCP-04` |
| `CM-0905` | namespaceStatus 处理 | D-MCP | `MCP-05` |
| `CM-0906` | Gmail MCP 面 | D-MCP | — |
| `CM-0907` | X / Twitter MCP 面 | D-MCP | — |
| `CM-0908` | cursor-github MCP 面 | D-MCP | — |
| `CM-0909` | cursor-origin MCP 面 | D-MCP | — |
| `CM-0910` | 公开 x 搜索命名空间 | D-MCP | — |
| `CM-1001` | ListEmailInboxes | D-MAIL | `MAIL-01` |
| `CM-1002` | CheckEmailInboxAvailability | D-MAIL | `MAIL-02` |
| `CM-1003` | ClaimEmailInbox | D-MAIL | `MAIL-02` |
| `CM-1004` | SearchEmailThreads / ReadEmailThread | D-MAIL | — |
| `CM-1005` | DraftExternalMessage（email） | D-MAIL | `CHAN-05`, `MAIL-05` |
| `CM-1006` | 用户 Gmail/Outlook 代发 | D-MAIL | `MAIL-03` |
| `CM-1007` | 邮箱内 create_draft | D-MAIL | `MAIL-06` |
| `CM-1008` | +tag 地址 | D-MAIL | — |
| `CM-1009` | unsolicited 退订 | D-MAIL | — |
| `CM-1010` | send-on-behalf 风格匹配 | D-MAIL | — |
| `CM-1101` | Channels skill / 入站 [inbound] | D-CHAN | `CHAN-03` |
| `CM-1102` | Slack 地址模型 | D-CHAN | `CHAN-02` |
| `CM-1103` | Personal Slack 限制 | D-CHAN | — |
| `CM-1104` | 渠道降级（无 widget） | D-CHAN | — |
| `CM-1105` | SetUpSlack | D-CHAN | — |
| `CM-1106` | secret-request 凭证收集 | D-CHAN | — |
| `CM-1107` | Microsoft Teams 渠道 | D-CHAN | — |
| `CM-1201` | Task executor 子代理 | D-AGENT | `AGENT-01` |
| `CM-1202` | Task computerUse | D-AGENT | `DESK-01`, `AGENT-02` |
| `CM-1203` | Task knowledgeWork | D-AGENT | `AGENT-03` |
| `CM-1204` | Task video / watchVideo | D-AGENT | `AGENT-04`, `AGENT-05` |
| `CM-1205` | Message 子代理 | D-AGENT | — |
| `CM-1206` | Check 子代理状态 | D-AGENT | — |
| `CM-1207` | Stop 子代理 | D-AGENT | `AGENT-06` |
| `CM-1208` | WakeParent | D-AGENT | `TURN-08`, `AGENT-09` |
| `CM-1301` | CloudAgent 启动 | D-CLOUD | `CLOUD-01` |
| `CM-1302` | CloudAgent 状态/日志 | D-CLOUD | `CLOUD-04` |
| `CM-1303` | Origin 集成 | D-CLOUD | `CLOUD-02` |
| `CM-1304` | GitHub 集成 | D-CLOUD | `CLOUD-03` |
| `CM-1305` | source-control 技能 | D-CLOUD | — |
| `CM-1306` | CloudAgent Auto-review | D-CLOUD | `CLOUD-05` |
| `CM-1401` | CreateAgent | D-TEAM | `TEAM-02` |
| `CM-1402` | SendToAgent | D-TEAM | `TEAM-01` |
| `CM-1403` | sections 协作分区 | D-TEAM | `TEAM-03` |
| `CM-1404` | rooms 群聊回合 | D-TEAM | — |
| `CM-1405` | Members 面板 | D-TEAM | — |
| `CM-1406` | export-bot-template | D-TEAM | — |
| `CM-1501` | 不可逆动作闸门 | D-SEC/D-PERM | `SEC-05`, `BUY-04`, `PERM-01` |
| `CM-1502` | Auto-review | D-SEC/D-PERM | `BOX-09`, `MCP-08`, `SEC-03` |
| `CM-1503` | smart mode 同动作重试 | D-SEC/D-PERM | `SEC-04` |
| `CM-1504` | Untrusted content fences | D-SEC/D-PERM | `SEC-01`, `SEC-02` |
| `CM-1505` | Auto-review 块通知例外 | D-SEC/D-PERM | — |
| `CM-1506` | 禁止凭证外泄 | D-SEC/D-PERM | `SEC-07` |
| `CM-1507` | settings auto-review 锚点 | D-SEC/D-PERM | — |
| `CM-1601` | GenerateImage | D-FILE | `FILE-05` |
| `CM-1602` | GenerateVideo | D-FILE | `FILE-06` |
| `CM-1603` | watchVideo / 视频理解 | D-FILE | — |
| `CM-1604` | ReadEmailAttachment / UploadFile | D-FILE | `MAIL-07` |
| `CM-1605` | inline 图片理解 | D-FILE | `FILE-03` |
| `CM-1701` | WebSearch | D-FILE(tools/web) | — |
| `CM-1702` | WebFetch | D-FILE(tools/web) | — |
| `CM-1703` | Fetch 失败回退 | D-FILE(tools/web) | — |
| `CM-1801` | scheduling 日程/会议 | D-SKILL/D-BUY | — |
| `CM-1802` | purchases 购买 | D-SKILL/D-BUY | `BUY-02`, `BUY-04` |
| `CM-1803` | shopping / 零售 playbooks | D-SKILL/D-BUY | — |
| `CM-1804` | flight/accommodation/rideshare | D-SKILL/D-BUY | — |
| `CM-1805` | food-ordering / restaurant-* | D-SKILL/D-BUY | — |
| `CM-1806` | job-search / linkedin playbook | D-SKILL/D-BUY | — |
| `CM-1807` | slides / office-pptx | D-SKILL/D-BUY | — |
| `CM-1808` | learn-from-demonstration | D-SKILL/D-BUY | — |
| `CM-1809` | no-connector-fallback | D-SKILL/D-BUY | — |
| `CM-1810` | code-changes | D-SKILL/D-BUY | — |
| `CM-1901` | Settings 入口 | D-PROF(Host UI) | — |
| `CM-1902` | Settings tabs 与锚点 | D-PROF(Host UI) | — |
| `CM-1903` | Update Bot's Computer | D-PROF(Host UI) | — |
| `CM-1904` | Reset Bot's Computer | D-PROF(Host UI) | — |
| `CM-1905` | local-execution 设置 | D-PROF(Host UI) | — |
| `CM-1906` | 应用 Updates vs box Update | D-PROF(Host UI) | — |
| `CM-1907` | 删除助手 | D-PROF(Host UI) | — |
| `CM-2001` | 用户时区报告 | D-TIME/D-TURN | `TIME-01`, `TIME-02`, `TIME-03` |
| `CM-2002` | 语言跟随 | D-TIME/D-TURN | `COMM-06` |
| `CM-2003` | 隐藏 cue [inbound] | D-TIME/D-TURN | `CHAN-03` |
| `CM-2004` | 隐藏 cue [room] | D-TIME/D-TURN | — |
| `CM-2005` | voice:<call> 直播通话 | D-TIME/D-TURN | — |
| `CM-2006` | 首启 claim 邮箱引导 | D-TIME/D-TURN | `PROF-04` |
| `CM-2007` | 系统提醒 automation_status / timestamp | D-TIME/D-TURN | — |
| `CM-2008` | 身份自称 Grok Bot→Bit Bot | D-TIME/D-TURN | — |
| `CM-2101` | ReactToMessage | 补遗(多域) | `TURN-07` |
| `CM-2102` | Widget multiSelect/allowCustom/danger/dismissOnM | 补遗(多域) | `COMM-03` |
| `CM-2103` | Markdown 数学与 mermaid | 补遗(多域) | `COMM-01` |
| `CM-2104` | 同回合并行工具 | 补遗(多域) | — |
| `CM-2105` | earlyMinutes/lateMinutes | 补遗(多域) | — |
| `CM-2106` | trigger:microsoftTeams | 补遗(多域) | — |
| `CM-2107` | UninstallPlugin | 补遗(多域) | — |
| `CM-2108` | GetPlugin | 补遗(多域) | — |
| `CM-2109` | user-Finance 连接器面 | 补遗(多域) | — |
| `CM-2110` | slides-executor skill | 补遗(多域) | — |
| `CM-2111` | site-playbooks 站点清单 | 补遗(多域) | — |
| `CM-2112` | 策略引擎：offensive_cyber | 补遗(多域) | — |
| `CM-2113` | 策略引擎：child_sex | 补遗(多域) | — |
| `CM-2114` | 策略引擎：武器与 dual_use_bio | 补遗(多域) | — |
| `CM-2115` | 策略引擎：犯罪协助 | 补遗(多域) | — |
| `CM-2116` | 策略引擎：copyright | 补遗(多域) | — |
| `CM-2117` | 商品推荐行格式 | 补遗(多域) | — |
| `CM-2118` | 用户私有 workflows 非内核 | 补遗(多域) | — |
| `CM-2119` | 持久 store 授权挂载 | 补遗(多域) | `STORE-01`, `STORE-03` |
| `CM-2120` | Outlook 连接器 | 补遗(多域) | `MAIL-04` |
| `CM-2121` | 策略：offensive_cyber 拒 | 补遗(多域) | — |
| `CM-2122` | 策略：child_sex 拒 | 补遗(多域) | — |
| `CM-2123` | 策略：武器/双用途生物拒 | 补遗(多域) | — |
| `CM-2124` | 策略：犯罪协助拒 | 补遗(多域) | — |
| `CM-2125` | 策略：copyright 大段 verbatim 拒 | 补遗(多域) | — |
| `CM-2126` | 策略：self_harm 关怀 | 补遗(多域) | — |
| `CM-2127` | 入站邮件不自动回复 | 补遗(多域) | — |
| `CM-2128` | ReactToMessage 出站 | 补遗(多域) | `TURN-07` |
| `CM-2129` | credential-request 填充 | 补遗(多域) | — |
| `CM-2130` | ListCredentials | 补遗(多域) | — |
| `CM-2131` | cursor-agent 卡片 | 补遗(多域) | — |
| `CM-2132` | X 公共读限流窗口 | 补遗(多域) | — |
| `CM-2133` | 禁止空转轮询子代理 | 补遗(多域) | `TURN-08` |
| `CM-2134` | needsGrant 状态 | 补遗(多域) | `MCP-05` |
| `CM-2135` | 用户私有 workflows 不入库核合同 | 补遗(多域) | — |
| `CM-2136` | Task resume 续跑 | 补遗(多域) | `AGENT-07` |
| `CM-2137` | 入站附件 AttachmentRef | 补遗(多域) | `FILE-01` |
| `CM-2138` | 多 Effect 批出 | 补遗(多域) | `TURN-10` |
| `CM-2139` | 可逆默认自主 | 补遗(多域) | — |
| `CM-2140` | 禁止捏造事实 | 补遗(多域) | — |
| `CM-2141` | SendToAgent 扇出限制 | 补遗(多域) | — |
| `CM-2142` | 草稿卡「发送」精确重发 | 补遗(多域) | — |
| `CM-2143` | 拒发终态不可旁路 | 补遗(多域) | `SEC-06`, `PERM-04` |
| `CM-2144` | 站立权限撤销即时 | 补遗(多域) | — |
| `CM-2145` | 记忆权威源非盒文件 | 补遗(多域) | — |
| `CM-2146` | 连接器 app vs 用户身份 | 补遗(多域) | — |
| `CM-2147` | 禁止自写连接 URL | 补遗(多域) | — |
| `CM-2148` | 云产物路径约束 | 补遗(多域) | — |
| `CM-2149` | 跨助手不原样转述抱怨 | 补遗(多域) | — |
| `CM-2150` | ReadTranscript | 补遗(多域) | — |
| `CM-2151` | SetUserAttribute | 补遗(多域) | — |
| `CM-2152` | 首启有描述直接开工 | 补遗(多域) | `PROF-04` |
| `CM-2153` | 会议直播聊天外发例外 | 补遗(多域) | — |
| `CM-2154` | InboundKind Agent 分流 | 补遗(多域) | — |
| `CM-2155` | 例程 Origin 事件子集 | 补遗(多域) | — |
| `CM-2156` | 短句具体风格 | D-COMM | `COMM-05` |
| `CM-2157` | 图表生成 | D-FILE | `FILE-04` |
| `CM-2158` | 包管理/安装 | D-BOX | `BOX-05` |
| `CM-2159` | 工作目录 | D-BOX | `BOX-07` |
| `CM-2160` | 浏览器导航 | D-DESK | `DESK-03` |
| `CM-2161` | 并行多子代理 | D-AGENT | `AGENT-08` |
| `CM-2162` | 子代理审批冒泡 | D-AGENT | `AGENT-10` |
| `CM-2163` | $file: 参数展开 | D-MCP | `MCP-06` |
| `CM-2164` | write_to_file 结果 | D-MCP | `MCP-07` |
| `CM-2165` | 静默执行 | D-RTN | `RTN-04` |
| `CM-2166` | 需注意时投递 | D-RTN | `RTN-05` |
| `CM-2167` | SkillRef | D-SKILL | `SKILL-05` |
| `CM-2168` | 渠道身份 | D-CHAN | `CHAN-04` |
| `CM-2169` | 不可从 Agent Inbox 擅自发 | D-MAIL | `MAIL-08` |
| `CM-2170` | 安全适配非绕过 | D-SEC | `SEC-08` |
| `CM-2171` | 凭证录入 | D-BUY | `BUY-03` |
| `CM-2172` | 队友权限边界 | D-TEAM | `TEAM-04` |
| `CM-2173` | 读写约定 | D-STORE | `STORE-02` |
| `CM-2174` | 跨代理共享机状态 | D-STORE | `STORE-04` |
| `CM-2175` | box 时钟对齐 | D-TIME | `TIME-04` |
| `CM-2176` | 任务描述≠许可 | D-PERM | `PERM-02` |
| `CM-2177` | 草稿回报父级 | D-PERM | `PERM-03` |
| `CM-2178` | 设置页引导 | D-PERM | `PERM-05` |

**矩阵行数**：234  ·  **01 覆盖**：133/133