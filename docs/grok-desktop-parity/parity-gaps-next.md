# Grok Bot 桌面端复刻 — 剩余功能清单与规范（Wave G 后续）

> 依据：官方规格 `/app/grokspec/grok-bot-spec.md`（17 页全文，抓取 2026-10-19）逐节交叉比对现有 `spec.md`（GP-01..133）与 `gaps.md`（Wave M4..M45）逐条状态 + `docs/capability-matrix.md`（234 CM）。
> 分支：`cursor/desktop-layout-target-v1`。判定口径沿用仓库三态：**已实现 / 残留（诚实，不 pretend）/ 未做**。
> 本文只列**尚未闭合**的功能，不重复已绿项。每项给「官方行为 §→ 落点 → 可证伪验收」，编号顺延 GP-134 起。

## 结论速览

Grok 桌面复刻的主体功能面已经打满：Bot 生命周期、Composer、审批/Auto-review、Computer/Take over、草稿、群聊、语音、Settings、通知、文件/交付、密钥不进上下文、Untrusted fence、隐私模式、先读后执行、跨会话记忆、主窗口结构、Usage、附件预览、消息反应——均有 GP 行且有 `smoke_grok_desktop_parity.sh`（当前 PASS=313 FAIL=0）+ 真 Electron/Playwright 门覆盖。

**真正还差的，集中在六类**：自动化（事件触发 / 最小间隔 / Teach a task）、Skills 来源分类呈现、Cloud Agent 结果闭环、共享 Computer 模型的跨 Bot 可见性 + 关窗不中断、Auto-review「独立评审通道」可证伪化、附件损坏/加密不可读诚实拒绝。另有两项**明确延期**（跨平台安装包、移动端同步），属发布工程与平台范围，不是行为对等缺口。

---

## 一、分类清单

### A. 内核已有、桌面复刻层未接线（补 UI + 验收即闭合）

| ID | 官方 § | 缺口 | 现状证据 |
|----|--------|------|----------|
| GP-134 | 6.2 | **事件触发 Routine 桌面接线** | 内核有 `Trigger::Event/Interval`（`routines/types.mbt:2-6`）+ CM-0406~0409/2106 全 PASS，但桌面回合 `CreateRoutine(id, cron, prompt)` **仅 cron**（`turn_json.mbt:79`、`parity_intents.mbt:1798`），renderer 创建例程只出 cron 字段。 |
| GP-135 | 6.3 | **Skill 三来源在 `/` 菜单与 Connect apps 的呈现** | 内核枚举 `SkillSource::{Managed,User,Plugin}` + `ManagedCatalog`（`skills/catalog.mbt:92-95`）、CM-0501/0506 PASS，但桌面 `/` 补全与 Connect apps「Manage plugins and skills」未按来源分组、无「缺 Skill→Connect apps」引导。 |
| GP-136 | 9.1 | **Cloud Agent 结果文件落 Computer + 附回对话** | CM-2131（cursor-agent 卡）/CM-2148（云产物 `/workspace/cloud-agent-artifacts/<bc>/` 路径约束）PASS，但桌面 GP 无「Bot 把云代理报告引用文件复制进 Computer 并附到回复」的回合与验收。 |

### B. 完全缺失（内核 + 桌面都无）

| ID | 官方 § | 缺口 |
|----|--------|------|
| GP-137 | 6.1 | **Teach a Task 跟练→Skill 草稿**：录制一次 Computer 工作流 → 生成**草稿态** Skill（需人工补决策规则/失败处理/审批边界）。全仓无 `teach` 意图；spec.md 仅在「诚实残留」里写过一句，无 GP 行、无门。 |
| GP-138 | 6.2 | **Routine 最小间隔 ≥5 分钟护栏**：官方「Routine 间隔至少 5 分钟」。桌面 create/schedule 路径未见校验，可接受 `cron=* * * * *` 逐分钟。 |
| GP-139 | 3.1 | **关闭应用/合盖不中断后台任务**的可证伪断言：`host_routine_daemon.sh` 实为分离进程，但没有一条门断言「Electron 退出后 due routine 仍触发」。 |

### C. 共享模型 / 深度（可做本地可证伪断言，真实环境标残留）

| ID | 官方 § | 缺口 | 本地可证 vs 残留 |
|----|--------|------|------------------|
| GP-140 | 3.1 | **跨 Bot 共享 Computer 浏览器会话/Cookie 可见性**（"一个 Bot 登录的网站对其他 Bot 可用"） | 可证：共享浏览器 profile 目录/登录态落同一 `computer.json` 且 Bot B 读到 Bot A 的登录标记；残留：真实云 VM microVM 与真 Cookie 沙箱不可达（同 `sandbox_screen` 口径）。 |
| GP-141 | 8.1 | **Auto-review「独立于 Bot」评审通道** + 团队「Enforce Auto-review」锁定优先级 | 可证：评审判定来源与 Bot 回复模型分离、团队规则优先于个人、Ask first > Allow automatically；残留：真实独立评审模型推理与企业强制下发属外部依赖。 |
| GP-142 | 5.5 | **加密/损坏附件不可读诚实拒绝**：官方验收「加密/损坏文件不可读」。附件校验链目前只卡数量/体积，未卡内容可解码性。 | 可证：给一个截断/加密 PDF → `unreadable` 诚实拒绝、不进上下文、不假装已读。 |

### D. 明确延期（不列入本轮功能复刻硬门）

| 官方 § | 项 | 定性 |
|--------|----|------|
| 10.1 | macOS/Windows/Linux 安装包 + 架构检测（`.deb`/`.rpm`/AppImage/`uname -m`） | 发布工程，非行为对等；NG-001 不做像素/打包皮肤。 |
| 10.2 | iOS/Android 与桌面同步 Bot/对话、移动端功能受限（Teach-by-demonstration 不可用） | desktop-first 明确排除（README：iOS/Android 仅 `MachineKind` 注册，不在本波）。 |

---

## 二、剩余项规范（GP-134 起，可证伪验收）

### G-A 自动化补全

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-134 | 事件触发 Routine（Slack/GitHub PR/CI/邮件 inbox 待支持），配置含匹配规则/响应动作/输入源/预期结果/审批边界，事件触发需窄匹配避免 "every new message" | 桌面 `CreateRoutine` 扩 `trigger~` 变体：`cron=` 或 `event=<slack|github_pr|github_ci|origin|teams|linear|sentry|pagerduty>` + `match=<规则>`；复用内核 `routines/events`/`connector_events`（CM-0406~0409 形状已 Ready）；renderer 例程创建面板加触发类型选择器 + 空 `match` 拒 | 回合 `create routine event=slack match="#escalations needs repro" …` → `intent=create_routine` 且 turn JSON 带 `trigger=event` 与 `match`；空 event_name 或 `match=.*`（泛匹配）→ 内核 `Invalid`（不注册）；Slack 未邀请频道回执含 `/invite` 提示；`moon test` 增断言复用 CM-0406 形状 |
| GP-138 | Routine 间隔至少 5 分钟 | `CreateRoutine` 解析阶段：`cron`/`interval` 换算下次触发，两次相邻触发 `<300s` → 拒绝 `interval_too_short`；`Interval(seconds)` 直接校验 `seconds>=300` | 造 `@every 2m` / `* * * * *` → Host 拒且 `pretend_scheduled:false`，store 不落该 routine；`@every 5m` 通过；断言进 smoke（复用 G-12 例程探针链） |
| GP-139 | 关闭应用/笔记本不中断后台任务 | 断言现有 `host_routine_daemon.sh` 独立进程模型：测试脚本 kill Electron 主进程后跑一次 daemon sweep，due routine 仍触发 | Electron 退出 → daemon sweep `fires.jsonl` 该 routine `fired:true`、`last_fired_at` 推进（不依赖窗口存活）；诚实标注：本机无真合盖事件，进程分离即规格的可执行等价 |

### G-B Skills 来源

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-135 | `/` 菜单列出所有可用 Skills（Managed/User/Plugin 三来源）；缺失 Skill 引导至 Connect apps → Your plugins → Manage plugins and skills | 内核 `SkillSource`/`ManagedCatalog` 已有；桌面 `skills:list` IPC 载荷加 `source` 字段（managed/user/plugin），renderer `/` 补全按来源分组渲染，`plugin` 项若未装显示「去 Connect apps 安装」；Connect apps 面板补「Manage plugins and skills」区 | `/` 打开出现三来源分组且项来自 `skills:list`（非写死数组）；把一个 `source=plugin` 且 `installed:false` 的技能显示为「未安装·去 Connect apps」；切换语言即时重绘分组标题 |

### G-C Cloud Agent 结果闭环

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-136 | Bot 将 Cloud Agent 最终报告引用的文件复制到 Computer，附加到回复；桌面端可全屏预览 | CM-2131 卡 + CM-2148 路径约束已有；桌面回合补 `cloud_agent_result` 后处理：把 `/workspace/cloud-agent-artifacts/<bc>/*` 引用的文件经 `copy_to_box` 落 Computer + 复用 GP-90 文件卡/全屏查看器附件到回复 | 一次云代理回合后 Computer 工作区出现被引用文件（`fs` 探针存在）、回复带真实文件卡、`grep` 无 `/opt/cursor/artifacts` 直附（CM-2148）；文件缺失时诚实 `artifact_unavailable` 不造卡 |

### G-D 共享 Computer 模型

| ID | 官方行为 | 实现落点 | 验收信号 |
|----|----------|----------|----------|
| GP-140 | 每用户一台持久 Computer，所有 Bot 共享浏览器 Cookie/会话/文件/命令行凭证；一个 Bot 登录的网站对其他 Bot 可用；每 Bot 独立 screen、同 Bot 同时只一个 CU 任务 | GP-30 并发锁已有；补「共享登录态」本地可执行形式：`computer.json` 增 `auth_sessions`（Bot A 登录写入 `site=<host>` + `by=<bot>`），Bot B 的 `computer` 视图读取到该登录标记；真实 Cookie/云 VM 按 `sandbox_screen` 残留 | Bot A 回合写 `auth_sessions["example.com"]` 后，Bot B 读 `computer.auth_sessions` 命中同一 `site`（跨 Bot 可见，非隔离）；断言 `bot_screen` 仍各独立（登录共享 ≠ 屏幕共享）；真实 Cookie 有效性标注 residual |
| GP-141 | Auto-review 独立审查、在 Bot 操作前评估风险（允许/要求审批/拒绝），独立于 Bot 模型；团队规则优先于个人；Ask first > Allow automatically；管理员可 Enforce（Enterprise） | GP-24 五类门已有；显式化「评审来源」与回复模型分离：`security/autoreview` 结果记 `reviewer:"auto_review_gate"`（区别于 `model:"…"`）+ 可证 verdict；团队 locked 行已有 GP-73，补来源标记 `team_locked:true` | 伪造「模型自称已批准」的正文不改 verdict；`Ask first` 与 `Allow automatically` 冲突判 ask（GP-22 已在，扩 reviewer 字段断言）；`team_locked` 行删除 → `rule_locked` 拒；真实独立评审模型推理/企业下发标残留 |
| GP-142 | 附件支持多格式；加密/损坏文件不可读 | `stageAttachments`/读取链目前卡数量+体积；补内容可解码性探测：文本族无 NUL/有效 UTF-8、图片 magic-byte、PDF 有 `%PDF-` 头且非截断、加密 PDF 无有效 trailer → `unreadable` 诚实拒绝 | 截断 PNG / 随机字节伪装 .pdf / 加密 PDF → `ok:false, reason:unreadable`，不进 kernel 上下文、不假装已读；正常件通过；断言进附件 smoke（G-17 扩展） |

---

## 三、门禁与交付要求（沿用现有纪律）

1. **每新增 GP 必须打真链**：验收落到 `smoke_grok_desktop_parity.sh` 新场景 + 真 Electron/Playwright 门（`e2e_grok_desktop_*.mjs` 同族），renderer 不伪造状态；`moon test` 覆盖内核意图分类。
2. **三态诚实**：外部不可达项（真 Cookie/独立模型推理/企业下发/云 VM 推流/合盖事件）一律 `residual:true` + 不 `pretend`，与既有残留口径一致。
3. **回归不破**：现有 313 parity 断言 + boot 124 + layout 12 + shell-v2 101 全绿不回退；D-C-03 三语键齐平，新文案走 `t(key)`。
4. **禁词门**：产品态 forbidden-token 扫描（`entry=`/`account=`/`*_masked`/`data/`/`.json`/`× N`/`unavailable`/`disabled_by_default`/`training=`/`key=`/`secret=`）继续对新增 UI 生效。
5. **文档**：本文随实现同步进 `spec.md`（正式行）与 `gaps.md`（逐条状态），并在 `docs/design/desktop-target/report.md` 记录命令与实测结果。

## 四、建议波次顺序

- **Wave M46**：A 类接线（GP-134 事件触发、GP-135 Skills 来源、GP-136 Cloud Agent 结果）——内核 Ready，只差桌面回合 + UI + 门，性价比最高。
- **Wave M47**：C 类共享模型（GP-140 共享登录态、GP-141 reviewer 显式化、GP-142 不可读拒绝）+ B 类护栏（GP-138 最小间隔、GP-139 关窗不中断）。
- **Wave M48**：GP-137 Teach a Task（体量最大，需录制采集 + 草稿 Skill 生成 + 人工确认闭环，真录屏按残留）。
- **不做（延期）**：§10.1 打包/架构、§10.2 移动端同步——发布工程与平台范围，另立计划。
