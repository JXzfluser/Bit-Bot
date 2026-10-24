# Grok Bot 真机功能对照（live-compare）

> 生成：2026-10-24 · 作者：WorkBuddy 智能设计助手
> 目的：用**真机探到的功能**取代内部对标文档的二手描述，作为 Bit Bot 与参考产品（Grok Bot）差异的唯一可信基线。
> **一句话结论**：参考产品本身就是「多智能体 + 集成市场 + 例行任务」平台；Bit Bot 的内核方向是对标的，真正落后的是**桌面宿主 UI 把这些能力摆出来的完整度**。

---

## 0. 探勘方法（可复现）

- 本机已装 `Grok Bot.app` v0.75.0（Electron），且会话里就是本项目的 agent（Bitbot / Bit架构 / MoonBit核 / 能力对标），登录 `jx_zfl@126.com` —— 即**同一套 bitbot 系统的已发布客户端**，是本项目最该对齐的参考。
- 以调试模式重启（保留同一份用户数据，登录不掉）：
  `env -u ELECTRON_RUN_AS_NODE "/Applications/Grok Bot.app/Contents/MacOS/Grok Bot" --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=9224`
  （沙箱环境必须加 `--no-sandbox --disable-gpu`，否则 `sandbox initialization failed` / GPU 崩溃退出。）
- 通过 CDP（`Page.captureScreenshot` + `Runtime.evaluate` 抓 DOM 文字）实探主界面、团队会话、"连接应用"面板。
- **未深挖**：Settings 面板内部的模型选择 / Think / 联网搜索开关 / 语音模式切换（本次没点那一层）。后续补探时再填。

---

## 1. 真机确认的功能清单（Grok Bot.app）

### 1.1 多智能体团队
- 一个对话 = 一支**团队**，成员是多个 bot：`@所有人Bot`、情报侦察员Bot、选题策划师Bot、内容主笔Bot、事实编辑Bot、kkkBot、公众号资深排版设计师Bot。
- 支持 `@` 提及成员、移除成员（`移除` 操作可见）。
- 团队带 **资料库**（知识库）：面板出现「详情 / 资料库 / 成员」分区。

### 1.2 连接应用（集成市场）
- 顶部筛选：全部 / 密码管理器 / 效率 / 通信 / 设计 / 代码 / 更多；右上「已连接 6 个」。
- 有 **Bot 模板** 按钮。
- DOM 实探到的可连接项（部分）：
  - 邮箱/日历/文档/网盘：Gmail、Google Calendar、Google Docs、OneDrive、Outlook、Google Slides、邮箱（专属域名邮箱，收件经例行任务唤醒 Bot）
  - 密码/效率：1Password、Notion、Atlassian、Calendly、Superhuman Mail、AgentMail、Inkbox、postiz、ActiveCampaign
  - CRM/营销/SEO：HubSpot、Clay、Klaviyo、Brevo、MailerLite、Ahrefs、Semrush、Intercom、Plain
  - 代码/智能：Vercel、clangd-lsp（C/C++ 语言服务）、csharp-lsp（C# 语言服务）
  - Canvas 类：Docs Canvas（文档渲染为可导航画布）、PR Review Canvas（PR diff 按重要度分组评审画布）
- 截图额外见到的「为你推荐 / 已连接」图标：Figma、Google Drive、X 等。

### 1.3 例行任务（routines）
- 邮箱连接器文案明写「收到的邮件只会通过你设置的**例行任务**唤醒 Bot」→ routines 是参考自带能力。

### 1.4 侧栏与导航
- 分组：bitbot / 未分组；会话列表带头像、摘要、未读蓝点。
- 浮动「更多未读消息」聚合入口。
- 底部账户区：`jx_zfl@126.com` + 「连接应用」入口。

### 1.5 对话与 Composer
- Composer：`+`（附件）、文本输入、麦克风（语音）。占位「给 <团队> 发消息」。
- 助手消息渲染含 **代码块 / Markdown**（截图中可见），说明聊天渲染层是有的。

---

## 2. 差异表：参考（已发布）vs Bit Bot

| 参考能力（真机确认） | 我们内核（MoonBit） | 我们桌面 UI（hosts/desktop） | 差距 |
|---|---|---|---|
| 多智能体团队 + 成员管理（@/移除） | 有 subagents / teammates | **空**（实测「还没有群组」） | 🔴 缺 UI |
| 资料库 / 知识库（团队级） | memory 四类型 | **缺 UI** | 🔴 缺 UI |
| 连接应用市场（浏览/连接） | MCP GetDynamicTools / CallDynamicTool | **缺浏览连接面板** | 🔴 缺 UI |
| Canvas（Docs / PR Review） | canvas 部分 | 弱 | 🟠 弱 |
| Chat 打磨：Markdown / 代码高亮 / 重生成 / Think / 搜索开关 / 模型选择 | 部分 | **缺口**（recon.md 已列） | 🟠 缺口 |
| 凭证 / 模型连接（开箱即用） | secret_vault + credential 协议 | `.env.local` 死地址 `127.0.0.1:8793`，无引导 | 🔴 缺 UX |
| Bot 模板 | 有 | 未知 / 缺 | 🟠 待确认 |
| 例行任务（routines） | cron/@hourly（GP-153~163 已落地） | 无独立入口 | 🟠 待补 UI |
| 侧栏分组 + 未读聚合 | — | 有（Bot列表/群组/会话/今天/昨天） | 🟢 基本对齐 |
| 审批闸门 / untrusted fence | 有（approval gate） | 无独立 UI | 🟠 待补 UI |

图例：🔴 缺 / 🟠 弱或待补 / 🟢 基本对齐

---

## 3. 关键纠正（写给未来的自己）

- **此前基于 `docs/grok-desktop-parity/*.md` 的"Grok 没有 routines/审批/渠道/技能"判断是错的。** 真机里参考产品自带：多智能体团队、资料库、连接应用市场、例行任务、Canvas、Bot 模板。Bit Bot 把内核往 agent 平台做，**是对标的，不是跑偏**。
- **真正的"偏"是 UI 完整度**：内核（MoonBit）跑在前面，桌面宿主（hosts/desktop）没把团队 / 资料库 / 连接市场 / Canvas / Chat 打磨 / 凭证引导这些面做出来，所以从用户视角看像个空壳聊天，而参考是完整产品。
- **`docs/grok-desktop-parity/*.md` 与 `replica/recon.md` 都不能作为"Grok 有什么"的权威来源**——它们漏了团队/资料库/连接市场/Canvas/routines。凡是"Grok 有没有 X"的结论，必须来自：① 本机 Grok Bot.app 的 CDP 实探，或 ② 用户本人提供的截图。禁止再仅凭内部对标文档下结论。

---

## 4. 后续动作建议（待用户拍板）

1. 把"连接应用市场 UI"或"团队/群组 UI"作为第一个补齐面（参考最显眼、我们最空）。
2. 探 Settings 面板补全 1.5 节（模型选择 / Think / 搜索开关 / 语音）——本文件第 0 节已留方法。
3. 修订 `docs/non-goals.md` NG-001 与 `docs/CHARTER.md`：明确"Grok 对标 = 参考的真机能力集（含团队/资料库/连接市场/Canvas/routines）"，而非仅聊天皮肤。
