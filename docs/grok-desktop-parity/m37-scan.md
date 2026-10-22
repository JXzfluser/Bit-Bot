# Wave M37 UI 全量重构 - 中英混排清理清单

**扫描日期**: 2026-10-22  
**扫描范围**: `hosts/desktop/index.html` (12373 行) + `hosts/desktop/ui_chrome.css` (588 行)  
**分支**: `cursor/desktop-chrome-tokens-a7d0`

## 结论

本次扫描发现 **52 处**需清理的用户可见英文残留，分布如下：
- i18n 字典（zh-CN / zh-TW）：21 处
- HTML 静态文本与属性：20 处
- 动态字符串拼接：11 处
- CSS 硬编码：0 处

---

## 1. zh-CN / zh-TW i18n 段英文残留

**扫描范围**: `WAVEG_I18N` 常量，zh-CN 段 (L9257-L9647)，zh-TW 段 (L9648-L10038)

### zh-CN 段 (10 处)

| 行号 | key | value | 英文片段 |
|------|-----|-------|----------|
| L9264 | bcJobPh | "职责（如 Product performance）" | Product performance |
| L9265 | bcDescPh | "描述（工作方式 / 工具 / 边界，例如 Never change production settings）" | Never change production settings |
| L9305 | bfTagsPh | "标签（逗号分隔，如 perf, research）" | perf, research |
| L9359 | autoReview | "自动审查规则（Ask first 优先于 Allow automatically）" | Ask first, Allow automatically |
| L9395 | gpFramePoll | "帧预览：每 3s 轮询 Host 真实截屏（无 DISPLAY 时诚实显示 residual）" | DISPLAY, residual |
| L9406 | gpQueueNote | "后台审批队列（Routine / teammate 来源；~10 分钟过期显示 Expired，仍可 Always allow / Deny）" | Routine, teammate, Expired, Always allow, Deny |
| L9476 | privacyTitle | "Privacy Mode（账户侧管理，本机只读）" | Privacy Mode |
| L9497 | accountSection | "Account（本地 profile · 不伪造远端登录）" | Account, profile |
| L9498 | accountLabelPlaceholder | "profile 名（如 Personal / Work）" | profile, Personal, Work |
| L9514 | rAutoReview | "Auto-review：命中 {via} 规则，已自动执行（未再次询问）。" | Auto-review |

**zh-CN 小计**: 10 处

### zh-TW 段 (11 处)

| 行号 | key | value | 英文片段 |
|------|-----|-------|----------|
| L9655 | bcJobPh | "職責（如 Product performance）" | Product performance |
| L9656 | bcDescPh | "描述（工作方式 / 工具 / 邊界，例如 Never change production settings）" | Never change production settings |
| L9696 | bfTagsPh | "標籤（逗號分隔，如 perf, research）" | perf, research |
| L9735 | advanced | "進階 · Agents / Teammates" | Agents, Teammates |
| L9750 | autoReview | "自動審查規則（Ask first 優先於 Allow automatically）" | Ask first, Allow automatically |
| L9786 | gpFramePoll | "影格預覽：每 3s 輪詢 Host 真實截屏（無 DISPLAY 時誠實顯示 residual）" | DISPLAY, residual |
| L9797 | gpQueueNote | "背景審批佇列（Routine / teammate 來源；~10 分鐘過期顯示 Expired，仍可 Always allow / Deny）" | Routine, teammate, Expired, Always allow, Deny |
| L9867 | privacyTitle | "Privacy Mode（帳戶側管理，本機唯讀）" | Privacy Mode |
| L9888 | accountSection | "Account（本機 profile · 不偽造遠端登入）" | Account, profile |
| L9889 | accountLabelPlaceholder | "profile 名（如 Personal / Work）" | profile, Personal, Work |
| L9905 | rAutoReview | "Auto-review：命中 {via} 規則，已自動執行（未再次詢問）。" | Auto-review |

**zh-TW 小计**: 11 处

**本节总计**: 21 处

---

## 2. HTML 默认文本英文残留

**扫描范围**: `<body>` (L1371) 到第一个 `<script>` (L2276) 之间的静态 HTML

### 元素文本节点 (18 处)

| 行号 | 原文片段 | 英文内容 |
|------|----------|----------|
| L1572 | `<div ...>帧预览：每 3s 轮询 Host 真实截屏（无 DISPLAY 时诚实显示 residual）</div>` | DISPLAY, residual |
| L1590 | `<div ...>群内消息（@BotName / @everyone / 无 @ 自行决定）</div>` | @BotName, @everyone |
| L1596 | `<div ...>审批 / Secret 请求永远只进对应 Bot 私聊，不进群 transcript（GP-53）。</div>` | Secret, transcript |
| L1600 | `<div ...>后台审批队列（Routine / teammate 来源；~10 分钟过期显示 Expired，仍可 Always allow / Deny）</div>` | Routine, teammate, Expired, Always allow, Deny |
| L1657 | `<div ...>Auto-review 规则（Ask first 优先于 Allow automatically）</div>` | Auto-review, Ask first, Allow automatically |
| L1676 | `<div ...>Account（本地 profile · 不伪造远端登录）</div>` | Account, profile |
| L1705 | `<div ...>Usage & Billing（本周真实 LLM 用量；无数据即空态，不造假）</div>` | Usage & Billing |
| L1717 | `<div ...>Key / 渠道凭证由你填写，写入本机 gitignored .env.local platform.deepseek.com/api_keys</div>` | Key, gitignored, .env.local, platform.deepseek.com/api_keys |
| L1886 | `<div ...>模板来自 Host 的 bot-templates.json 目录，点一个即可创建 Bot。</div>` | bot-templates.json |
| L1942 | `<div ...>桌面 · 本阶段，iOS/Android 暂缓</div>` | iOS, Android |
| L2066 | `<div ...>记忆 k=v · 回忆（desktop-host.json）</div>` | desktop-host.json |
| L2077 | `<div ...>shell · 列目录 · 读取 (ADR 0002)</div>` | shell, ADR |
| L2082 | `<button ...>抓取 example.com</button>` | example.com |
| L2111 | `<button ...>打开 example.com</button>` | example.com |
| L2123 | `<div ...>git / PR 计划</div>` | git, PR |
| L2174 | `<div ...>local_worker · 交付产物</div>` | local_worker |
| L2199 | `<div ...>沙盒 eml · ICS · 回执</div>` | eml, ICS |

### placeholder / title / aria-label 属性 (2 处)

| 行号 | 属性 | 值 | 英文内容 |
|------|------|----|----------|
| L1441 | title | "国产多模型 · 经 MoonBit llm_set_model" | llm_set_model |
| L1441 | aria-label | "LLM model picker" | model picker |

**本节总计**: 20 处（文本节点 18 + 属性 2）

---

## 3. 动态拼接英文残留

**扫描范围**: `index.html` 中 JavaScript 字符串字面量（`"..."` 和 `` `...` ``）

### textContent / innerHTML 赋值 (12 处)

| 行号 | 代码片段 | 英文内容 |
|------|----------|----------|
| L2410 | `const label = { general: "General", computer: "Computer", credentials: "Credentials", usage: "Usage & Billing", updates: "Updates" }[key];` | General, Computer, Credentials, Usage & Billing, Updates |
| L2858 | `if (title) title.textContent = "Agent · " + agentId;` | Agent |
| L4043 | `btn.textContent = "Open with OS";` | Open with OS |
| L4231 | `a.textContent = "Open cloud agent";` | Open cloud agent |
| L6717 | `if (urlEl) urlEl.textContent = "URL: " + (p.url \|\| "");` | URL: |
| L6720 | `"Key (user only): " + (p.key \|\| p.key_masked \|\| "");` | Key (user only): |
| L9120 | `bOnce.textContent = "Allow once";` | Allow once |
| L9130 | `bAlways.textContent = "Always allow";` | Always allow |
| L9145 | `bDeny.textContent = "Deny";` | Deny |
| L9269 | `(st.label \|\| "Privacy Mode: unavailable")` | Privacy Mode: unavailable |
| L10915 | `status.textContent = "Discarded（无出站；draft 保留在 Host 供审计）";` | Discarded, draft |

### 其他动态字符串 (0 处)

经核查，静态 HTML 中的默认文本已通过 `data-i18n` 属性标记，由 i18n 字典动态替换。en 段的英文属于预期行为，不在本次清理范围内。

**本节总计**: 11 处

---

## 4. ui_chrome.css 硬编码英文

**扫描范围**: `hosts/desktop/ui_chrome.css` (588 行)

**扫描结果**: 未发现 `content:` 属性或其他用户可见的硬编码英文字符串。

**本节总计**: 0 处

---

## 汇总统计

| 类别 | 数量 |
|------|------|
| i18n 字典（zh-CN / zh-TW） | 21 |
| HTML 静态文本与属性 | 20 |
| 动态字符串拼接 | 11 |
| CSS 硬编码 | 0 |
| **总计** | **52** |

---

## 备注

1. **品牌词与专有名词已排除**: Bit Bot, Bot, Gmail, Slack, Teams, MCP, Chrome, Cursor, GitHub, OTA, API, LLM, JSON, Markdown, ID, URL, Tab, Enter, Shift, Ctrl, Cmd, Alt, English, Piper, Voice, STT, Host, Marketplace, Routines, 2FA, MoonBit, DeepSeek, AI, MB, FFI, OAuth 等。

2. **技术引用已排除**: 文件名（bot-templates.json, rooms.json, llm-usage.json 等）、环境变量（BITBOT_LLM_API_KEY 等）、URL（https://...）、协议名（http, https）、工单号（CM-xxxx, GP-xx）、@-mention 语法示例（@Name, @everyone, @Piper）等。

3. **时区值已排除**: Asia/Shanghai, Asia/Hong_Kong, Asia/Taipei, UTC, America/Los_Angeles, Europe/Berlin 等标准时区名称。

4. **选项值已排除**: shell, channel_send, mail_send, purchase_item, mcp_call, computer_use, delegate_task 等内部值（不显示给用户）。

5. **协议短语已排除**: `runUserTurn("open settings anchor=…")`, `reply via ...`, `send mail provider=...` 等内核命令短语。
