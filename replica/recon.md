# Replica Recon — Grok Bot（桌面网页端）功能逆向图

> 用途：对标 Grok Bot（grok.com / x.com/i/grok 的桌面网页版），为 **Bit Bot** 补齐开箱即用体验层缺口。
> 范围（已与用户确认）：平台=Web/桌面端；切片=**只补 Bit Bot 当前缺口**；目标=**提升 Bit Bot 自身**（做 parity，非另做可售卖克隆）。
> 本图是《Replica 技能包》第 1 步产出，下游接 `replica-architect` → `replica-design` → `replica-build`。
>
> 证据口径与诚实性：
> - Grok 侧信息来自**公开产品知识**（Grok 桌面端 2025–2026 公开形态）+ 用户此前在本项目分享的 Grok 截图（见 `replica/screens/`，待补）。
> - Bit Bot 侧状态由**直接 grep 代码库**核实（hosts/desktop：index.html / main.js / product_surface.js / ui_chrome.css / preload.js / progress_protocol.js）。
> - 遵守技能纪律：只读公开来源与用户本人账号、不外爬、不读源码包/私有 API；截图仅作参考、不进克隆。
> - 仓库内已有内核级对标 `docs/grok-desktop-parity/gaps.md`、`parity-gaps-next.md`（GP-134~147 大多已落地，smoke PASS=321）。本图**不重复**那份内核/Host 能力对标，只补它没覆盖的「对话 UX 体验层」。

---

## 1. Scope（已确认）

| 项 | 取值 |
|----|------|
| 平台 | Web / 桌面网页端（grok.com、x.com/i/grok） |
| 切片 | 对话核心闭环 + 创作层里 Bit Bot 缺失/藏起的能力 |
| 目标 | 提升 Bit Bot 自身（Grok 能力逐项 parity 进 Bit Bot） |
| 不做 | Grok 的 X 社交图谱、训练权重、Aurora 图像生成模型、付费 Persona、企业版 |

---

## 2. Sources（按价值排序；URL 待用户补）

| source | 提供 | 状态 |
|--------|------|------|
| 用户此前分享的 Grok 截图 | 真实界面/布局 | 待补到 `replica/screens/` |
| Grok 帮助中心 / 官方 spec | 完整功能清单、设置项 | 公开可读（仓库曾抓 `/app/grokspec/grok-bot-spec.md`，见 parity 文档） |
| grok.com 营销/产品页 | 核心闭环定位 | 公开 |
| 用户本人 Grok 账号（实时界面） | 各状态 | 需用户在场、用其浏览器，本会话无浏览器工具，跳过 |
| Bit Bot 代码库 | 克隆方真实能力 | 已 grep 核实 |

---

## 3. Screen inventory（聚焦缺口相关界面）

> ID 稳定：S01…；其它文件引用同一套 ID。

| ID | 界面 | 到达方式 | 目的 | 关键组件 | Bit Bot 现状 |
|----|------|----------|------|----------|--------------|
| S01 | Composer（输入框） | 任一会话底部 | 输入、发消息、挂附件/工具 | 多行输入、附件钮、模型选择、**DeepSearch/Think 切换**、语音钮、发送 | 有基础输入+附件钮；**无** DeepSearch/Think 切换；模型选择不在 composer |
| S02 | 消息气泡（AI 回复） | 发消息后 | 展示回复 | **Markdown 渲染 + 代码块高亮**、复制、重生成、赞踩 | **纯文本/基础**，无 markdown/代码高亮；无重生成 |
| S03 | 用户消息行 | 发送后 | 展示提问 | 文本、**内联编辑** | 有「编辑消息」钮（#tool-edit-message）✓；无 branch/继续 |
| S04 | 模型选择器 | composer 内下拉 / header | 切模型+模式 | 模型列表、Think/DeepSearch | 「模型」Sheet（设置级，国产多模型配置）✓ 但非 composer 即时下拉 |
| S05 | 联网搜索开关 | composer 内 toggle | 开/关实时检索 | DeepSearch 开关、来源引用 | **无**（代码无 web search UI/工具） |
| S06 | 语音模式 | 语音钮进入 | 实时语音对话 / 语音输入 | 语音聊天钮、STT/TTS | 仅语音消息 relay；`#voicechat-btn` 被 `display:none` 隐藏；转写依赖外部二进制 |
| S07 | 附件预览 | 发/收附件 | 多格式预览 | 图片/PDF/代码预览、全屏 | 有附件 stage + 预览（GP-90 文件卡），部分 |
| S08 | Canvas / 创作 | 生成文档/代码 | 可编辑产物 | 文档/代码画布、导出 | 部分（产物文件卡/全屏查看器），无独立可编辑 canvas |

---

## 4. User flows（核心闭环 + 缺口动作）

| ID | 目标 | 经过界面 | 快乐路径点击数 | Bit Bot 现状 |
|----|------|----------|----------------|--------------|
| F01 | 发消息拿到格式化回复 | S01→S02 | 2（输入+发送） | 回复为纯文本，无 markdown |
| F02 | 重生成一条回复 | S02 重生成钮 | 1 | **缺失**（仅编辑用户消息） |
| F03 | 改提问重发 | S03 编辑 | 2 | ✓ 编辑消息存在 |
| F04 | 开联网搜索再问 | S05 开→S01 | 2 | **缺失** |
| F05 | 换模型再问 | S04 选模型 | 2（设置级更多） | 部分（设置 Sheet，非 composer 即时） |
| F06 | 语音对话 | S06 | 1 | 缺失（钮隐藏） |
| F07 | 附件 + 提问 | S01 附件→S07 | 3 | ✓ 基础有 |

---

## 5. Components（重复 UI 部件，供 replica-design 复用）

| 组件 | 变体/状态 | Grok 表现 | Bit Bot 现状 |
|------|-----------|-----------|--------------|
| Markdown 渲染器 | 标题/列表/表格/加粗/链接/代码行内 | 完整 | **缺失**（无 marked.js / DOMPurify） |
| 代码块 | 语言标签 + 语法高亮 + 复制 | 完整（highlight.js） | **缺失**（无 hljs） |
| 重生成钮 | hover 出现 | 有 | **缺失** |
| 内联编辑 | 就地 textarea + 重发 | 有 | ✓ 编辑消息存在 |
| 模型下拉 | composer 内、含模式(Think/DeepSearch) | 有 | 设置级 Sheet（#model-picker）存在，缺 composer 内即时切换 |
| 搜索 toggle | 开/关 + 引用来源 | 有 | **缺失** |
| 语音钮 | STT 输入 / 语音对话两种 | 有 | 语音消息 relay 有；语音对话钮隐藏 |

---

## 6. Inferred data model（轻量，供 replica-architect 细化）

| 实体 | 字段（推断） | 证据 | 置信 |
|------|--------------|------|------|
| Message | id, role(user|assistant), body(原始), rendered(markdown 产物), model, has_search, attachments[], created_at | S02/S03、Bit Bot transcript_entry 结构 | 高 |
| ModelConfig | id, provider, api_base, model_id, api_key(本地), mode(think|fast|deepsearch) | S04、Bit Bot `#sec-llm-*` / llmCatalog | 高 |
| SearchToggle | enabled(bool), sources[] | S05 | 中（Grok 行为推断） |
| VoiceSession | mode(stt|conversation), transcript, audio_ref | S06、Bit Bot progress_protocol CATEGORY_VOICE | 中 |

> Bit Bot 已有 transcript_entry（product_surface.js:1417）承载 user/assistant 行；补 `rendered` 字段即可接 markdown，无需改存储结构。

---

## 7. Feature matrix（详见 `replica/features.csv`）

重点缺口（clone 当前状态，已核实）：
- **markdown + 代码高亮渲染**：clone=no（确认无渲染库）
- **消息重生成（regenerate）**：clone=no（仅编辑）
- **联网搜索开关**：clone=no
- **模型即时切换（composer 内）**：clone=partial（设置 Sheet 有，缺 composer 下拉）
- **语音对话（STT/TTS）**：clone=partial（钮隐藏、依赖外部二进制）

---

## 8. What cannot be cloned（诚实 skip）

| 项 | 原因 |
|----|------|
| Grok 训练权重 / 模型本身 | 非拥有；Bit Bot 走 DeepSeek/兼容 API，能力等价靠接入，不复制模型 |
| X/Twitter 实时社交图谱 | 数据归平台，非功能 |
| Aurora 图像生成模型 | 专有模型 |
| 付费 Persona / 企业版能力 | 许可与商业边界 |
| 真实联网索引 | 需搜索后端；Bit Bot 可接搜索 API（功能可复刻，索引非拥有） |

> 「复刻」= 功能与 UX 模式（clean-room），不拿 Grok 拥有的东西。

---

## 9. Size（规模）

- 缺口集中在**对话 UX 体验层**，不碰内核：S（一个周末级）~ M（几周）。
- 最难三块：① markdown+代码高亮渲染管线（需引库 + 防 XSS）；② composer 内模型/搜索即时切换的交互重构；③ 语音 STT/TTS 的默认可用（去外部二进制依赖）。
- 出范围：Grok 社交图谱、模型权重、图像生成。

## 下一步
→ `/replica-architect`：把上述缺口落成 Bit Bot 的技术栈/数据模型/API 方案（Markdown 渲染选型、模型切换 IPC、搜索工具接入点、语音默认链路）。
