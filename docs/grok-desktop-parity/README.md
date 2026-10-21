# Grok Bot 桌面端复刻 — 产品对等规格（Wave G）

> 依据：xAI Grok Bot 官方文档 17 页全文（存档 `/app/grokspec/grok-bot-spec.md`，抓取 2026-10-19）
> 交叉合同：`docs/capability-matrix.md`（234 CM）、`docs/00-vision-and-non-negotiables.md`、`docs/non-goals.md`（NG-001：复刻行为与协议，不做像素皮肤）。
> 基线分支：`cursor/cn-product-brain-deepseek-2004` → 本分支 `cursor/grok-bot-parity-desktop-v2`。
> 范围：**Desktop-first**（Electron 宿主 `hosts/desktop`）。iOS/Android 保持 `MachineKind` 注册，不在本波。

## 判定口径

- **Grok 行为 = 规格**：每条能力写「官方行为 → Bit 实现落点（kernel intent / Host FFI kind / IPC / renderer）→ 可证伪验收」。
- **真功能，不是 UI 外壳**：验收必须打到 MoonBit 内核回合（`cmd/desktop_turn` JSON `v:1`）与 Host 真实执行（文件、进程、HTTP、掩码存储），renderer 只做呈现与输入，不伪造状态。
- **诚实残留**：真机不可达的项（如生产 OAuth IdP、商店签名、真实云 VM 远程桌面流）按仓库既有口径标 residual，永不 pretend。

## 工作包

| WP | 主题 | 规格 | 实现落点 |
|----|------|------|----------|
| G-1 | Bot 生命周期（建/编/置顶/复制/隐藏/恢复/删） | spec.md §2 | `parity_intents.mbt` + `host_ffi.js` bots store + renderer sidebar |
| G-2 | Composer 对等（多行/附件≤6/`/`技能/`@`提及/语音/快捷键） | spec.md §5 | renderer composer + IPC `attachments`/`skills` + kernel skill/voice intents |
| G-3 | 审批卡对等（Allow once / Always allow / Deny + 规则持久 + 后台过期） | spec.md §6 | `security` 规则引擎 + Host approvals store + renderer 卡 |
| G-4 | Take over / Computer 视图（接管请求、实时屏、I'm done、Update/Reset/Recover、本地执行三档） | spec.md §4 | kernel `take_over` intent + Host screen/takeover + renderer Computer 面板 |
| G-5 | 草稿卡对等（New Email / New Slack Message 可编辑 + Send/Discard） | spec.md §7 | `mail_draft`/`channel_send` 回路 + renderer 草稿编辑器 |
| G-6 | 群聊（2–6 Bot、`@BotName`/`@everyone`、Reply、审批不入群） | spec.md §3 | kernel routing policy + Host room store + renderer 群聊 |
| G-7 | 语音（voice input→composer 可编辑、voice chat、voice memo 播放+转录） | spec.md §5.3–5.4 | renderer 录音 + `voice_session/relay/end_write` 已有链 |
| G-8 | Settings 对等（Appearance/Language/Timezone/Local execution/Auto-review 规则/Updates/Usage） | spec.md §8 | Host settings store + nativeTheme + renderer 真控件 |
| G-9 | 通知与未读（聚焦抑制、系统通知、侧边栏未读、跳转） | spec.md §9 | IPC notifications + renderer badge |
| G-10 | 文件与交付（文件卡、预览、`/workspace` 路径纪律、保存/打开） | spec.md §10 | `readArtifact/openArtifact` + renderer 预览侧栏 |
| G-11 | 安全（secret 掩码框不进上下文、untrusted fence、auto-review 独立闸门、隐私模式只读） | spec.md §6/8.3–8.5/11 | kernel `secret_request`/`security.parse` fence + Host `secret_vault`（AES-GCM）+ `privacy_status` + renderer 密钥卡/`data-untrusted` 角标（wave M21） |
| G-12 | 侧边栏 chrome（Cmd/Ctrl+B 折叠、置顶区、Hidden Bots、Connect apps、⌘N） | spec.md §2 | renderer + accelerator |
| G-18 | 自动化先读后执行（Routine 默认出草稿、发送/购买/删除/发布/生产变更需审批、只读不打扰） | spec.md §6.4 | Host `routine_fire` 两段式（draft + `executed`/`execute_via`）+ kernel `gate_consequential` + renderer 草稿卡（wave M22） |
| G-19 | 跨会话记忆（稳定偏好/角色上下文跨对话一致、**每 Bot 独立**、共享文件与群聊可传递、删 Bot 不连坐、记忆永不授权动作） | spec.md §4.2 | `desktop-host.json`/`profile-vault.json` v2 分槽 + `--bot-id`/`--seed-memory` + `dropBotMemorySlot` 删除级联 + 旧扁平迁移（wave M23） |
| G-20 | 主窗口结构（侧栏六类入口：Bot/群组/会话 + Hidden/Connect apps/Marketplace/Settings；Bot 按活动排序、置顶优先；隐藏入口在底部；`#log` 单一消息流、右栏独立开合） | spec.md §2.1 | `#room-list`（读 rooms.json）+ `#marketplace-modal`（读 Host 模板目录）+ `touchBotActivity` → `bitbot:bots-changed` 自动重排 + `#sidebar-footer`（wave M24） |
| G-21 | Bot 资料管理与创建流程（Edit Profile 名称/标签/描述/头像；空名 `New Bot`、多行 Description、创建后自动打开对话；会话 今天/昨天/更早 + 搜索 + 重命名/删除） | spec.md §2.2–§2.3、§4.5 | kernel `UpdateBot(tags~)` + Host `normalizeTags`/`avatar_data_url` + `#bot-edit-modal`（Edit/Create 两态）+ `bitbot:bots:pickAvatar` + `sessDayBucket`/`#session-search`/rename/delete（wave M25） |
| G-22 | Bot 设置右栏（右侧可选面板之一：资料/统计/操作；与 Computer 预览互斥；每 Bot 通知开关；面板动作与菜单同源） | spec.md §2.1、§4.5–§4.6 | Host `botDetail`/`botNotifySet` + IPC `bitbot:bots:detail`/`bitbot:bots:notify` + `#bot-rail`（`body.bot-open`）+ 菜单「Bot 设置」入口（wave M26） |
| G-23 | 对话详情右栏（右栏第三种内容：标题/归属/创建/更新/消息数/回复数/最近一条；三方互斥；面板内重命名随动；删除会话自动关栏） | spec.md §2.1 | `#conv-rail`（`body.conv-open`，与 bot-rail/computer-rail 三方互斥）+ `sessions.list/get` 真实行渲染 + `saveSessionRename→refreshConvRail` + 删除级联关栏（wave M27） |
| G-24 | Usage & Billing 接真回合（每次真实模型调用计入用量；per-provider/model 明细 + 周合计；未上报 tokens 如实标注；空态不造 0） | spec.md §7.1 | `executeLlmChat` 双路径提取 usage（`stream_options.include_usage`）+ emit `phase:"usage"` → main.js `recordUsage` → `llm-usage.json` 按周累加 + 面板 per-row 渲染（wave M28） |
| G-25 | 群聊入口（侧栏群组行 → 同一 #log 的真实群聊：banner + rooms.json transcript 卡 + composer `room <id> ::` 前缀；@ 路由含空格成员名修复） | spec.md §2.4 | `openRoomChat`/`#room-banner`/`exitRoomChat` + `roomTurn` 最长匹配提及解析 + 既有 kernel RoomTurn 短语（wave M29） |
| G-26 | 附件发送前预览（图片 chip 真实字节缩略图；非图片 kind+体积徽标；缺失/空路径诚实拒绝；pick/paste/drop 三入口接线） | spec.md §5.1 | `surface.attachmentPreview` + IPC `bitbot:attachments:preview` + `attachments.preview` + chip 缩略图/徽标渲染（wave M30） |

详细验收条目见 `spec.md`；IPC/载荷契约见 `ipc-contract.md`；现状差距审计见 `gaps.md`。
