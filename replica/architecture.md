# Architecture: Bit Bot 对标 Grok 的对话 UX 缺口方案（rebuild of Grok Bot 的核心体验层）

> 对应 `replica/recon.md` + `replica/features.csv`。本文件是《Replica 技能包》第 2 步产出，下游接 `replica-design` → `replica-build`。
> **关键适配**：技能默认栈是 Next.js/Postgres 绿地 Web 应用；但 Bit Bot 是**已有 Electron 桌面端**（Host 层 Node + 渲染层 vanilla JS + 本地 JSON 文件存储 + IPC + OpenAI 兼容 LLM）。技能明确「用户已有栈就用已有的」，故本方案**全部落在 Bit Bot 真实架构上**，不引入关系库/Web 框架，不重写现有内核/Host 能力（GP-134~147 已落地，见 `docs/grok-desktop-parity/`）。
> 范围（用户确认）：只补对话 UX 体验层 5 个缺口，目标=提升 Bit Bot 自身。

---

## 1. Stack（Bit Bot 真实栈 + 缺口所需最小新增）

| layer | 现有选择 | 缺口所需新增 | why |
|-------|----------|--------------|-----|
| 桌面壳 | Electron（打包为 `/Applications/Bit Bot.app`，扁平 `Resources/app`） | 不变 | 已有，渲染层即 Chromium |
| 渲染层 | `index.html` + `ui_chrome.css`，**vanilla JS，无框架** | 加 `<script>` 引本地 vendored 库（marked/markdown-it、highlight.js、DOMPurify）+ 新 composer 控件 | 无打包器，vendor 最小 JS 最稳 |
| Host 层 | `main.js` + `product_surface.js` + `host_ffi.js`（Node） | `host_ffi` 新增 `web_search` effect；`product_surface` 新增 `regenerateAssistant` / `setActiveModel` | 复用现有 IPC/FFI 通道 |
| 存储 | **本地 JSON 文件**，原子写（tmp+rename）：`sessions.json`/`rooms.json`/`settings.json`/`bots.json`/`computer.json` | transcript_entry 加字段；`settings.json` 加 `active_model`/`search_default`/`voice`；`.env.local` 加搜索 key | local-first 桌面，单用户，无多租户 |
| LLM | OpenAI 兼容 API（DeepSeek 等），key 在 `.env.local` | 不变（搜索/语音复用 key 模型） | 一致密钥体系 |
| 渲染管线 | 当前消息体纯文本 | `marked`/`markdown-it` + `highlight.js` + `DOMPurify` | 见 §4 XSS |
| 语音 | `#voicechat-btn` 隐藏，依赖外部二进制 | Chromium **Web Speech API**（渲染层 `SpeechRecognition` STT + `speechSynthesis` TTS）；STT 离线回退 Whisper API（用户 key） | 去外部二进制依赖、默认可用 |
| 联网搜索 | 无 | 公开搜索 API（**用户自有 key**）：Tavily / Brave Search / SerpAPI | 技能纪律：只用官方公开 API + 用户 key，不碰 Grok 私有端点 |

> 不引入：Postgres/Supabase/Next.js/Stripe（本波无账号/支付/多租户需求）。

---

## 2. Data model（JSON 文件存储，非关系库 → 无 schema.sql）

本地 JSON 原子存储，**无 SQL 表**。等价「schema」= 记录形状 + 新增字段 + 访问规则（单用户本地文件，访问靠文件系统权限，不做 RLS）。

### 2.1 `transcript_entry`（sessions.json 单聊 / rooms.json 群聊）— 新增字段
```jsonc
{
  "id": "uuid",
  "role": "user | assistant",
  "body": "原始 markdown 源文本（持久化，显示时渲染）",   // 新增：改存 markdown 源，不再只存纯文本
  "model": "deepseek-chat",                                 // 新增：本次用的模型（regenerate/审计用）
  "rendered": null,                                          // 可选：缓存渲染 HTML；默认显示时现渲，避免脏 HTML 落盘
  "search": {                                                // 新增：仅搜索开启时
    "enabled": true,
    "sources": [ { "title": "...", "url": "...", "snippet": "..." } ]
  },
  "regenerated": 0,                                          // 新增：重生成次数（UI 标记）
  "created_at": "2026-10-23T12:00:00Z"
}
```
> 仅加字段，向后兼容（旧 entry 无 `body` 则回退纯文本，无 `search` 则普通回复）。

### 2.2 `settings.json` — 新增键
```jsonc
{
  "active_model": { "provider": "deepseek", "model_id": "deepseek-chat" }, // 新增：composer 即时切换目标
  "search_default": false,                                                 // 新增：composer 搜索开关默认态
  "voice": { "stt": "webspeech", "tts": "webspeech", "fallback_stt": "whisper_api" } // 新增
}
```

### 2.3 `.env.local` — 新增（沿用 `SEC_*` 密钥范式）
```
BITBOT_SEARCH_PROVIDER=tavily      # 或 brave / serpapi
BITBOT_SEARCH_API_KEY=xxxx         # 用户自有公开搜索 API key
# 语音 Whisper 回退（可选）：
BITBOT_WHISPER_API_KEY=xxxx        # 复用 LLM provider 的 whisper 端点
```

---

## 3. API（Electron IPC 契约 + 外部公开 API）

桌面应用无 HTTP 路由；下表以 **IPC 通道**表达。`preload.js` 暴露、`main.js` 转发到 `host_ffi`/`product_surface`。

| kind | channel / 外部 API | does | who | input | output | flow |
|------|-------------------|------|-----|-------|--------|------|
| ipc | `bitbot:msg:regenerate` | 重生成最后一条 assistant 回复 | 当前会话用户 | `{ sessionId, entryId }` | 新 `transcript_entry`(assistant) | F02 |
| ipc | `bitbot:settings:set-active-model` | composer 即时切模型 | 用户 | `{ provider, modelId }` | `settings.active_model` + 落盘 | F05 |
| ipc | `bitbot:settings:get-models` | 取可选模型（Managed/User + 已配 key） | 用户 | — | `llmCatalog[]` | F05 |
| ipc | `bitbot:turn:set-search` | composer 搜索开关 | 用户 | `{ enabled }` | `settings.search_default` | F04 |
| ipc | `bitbot:voice:start` / `stop` | 起/停语音对话（Web Speech） | 用户 | — | 转写流 / 合成状态 | F06 |
| host effect | `web_search`（在 `host_ffi.js` 新增） | 联网检索 → 注入上下文 | Host（持 key） | `{ query, topN }` | `sources[]` | F04 |
| 外部 API | `GET https://api.tavily.com/search`（用户 key） | 公开网页检索，返回带 citation 的结果 | Host | `{ query, max_results }` | `{ results:[{title,url,content}] }` | F04 |

Webhooks：无（本地桌面，无支付/日历）。
Jobs：复用现有 `host_routine_daemon.sh`（GP-134~139 已落地），本波不新增后台作业；搜索/语音为请求-响应式。

---

## 4. The parts that bite（难点与护栏）

- **XSS（最高危）**：模型输出不可信，markdown 渲染必须防注入。`marked`/`markdown-it` 默认不渲原始 HTML，但代码块/链接仍需 sanitize；**渲染后过 `DOMPurify`**，禁止 `on*` 属性/`javascript:`/`data:`（除图片 data-uri 白名单）。Bit Bot 已有 `untrusted_fence.js` 纪律，渲染层复用同一信任边界。
- **搜索成本/限流**：每次开搜索都调外部 API，按次计费 + 有 QPS 上限。护栏：composer 默认 `search_default=false`；每次检索 `topN≤5`；同一 turn 去重；key 缺失时 composer 开关置灰并提示去设置填 key（不静默失败）。
- **语音权限/可用性**：Web Speech STT 需麦克风授权 + 网络（Chromium 走 Google 语音服务）；TTS 用本地 Chromium 嗓音（离线）。护栏：首次进入提示授权；STT 失败/离线自动回退 Whisper API（用户 key）；`#voicechat-btn` 仅在能力探测通过后才显示，避免假入口（呼应 parity 文档「不伪造状态」纪律）。
- **regenerate 幂等/竞态**：同一消息连点重生成 → 加 `in_progress` 锁，二次点击忽略；regenerate 前先移除上一条 assistant entry（原子写），避免重复气泡；群聊 regenerate 仅作用于最后一条 `bot_reply`（按 `speaker`），不碰他人。
- **模型切换一致性**：composer 切模型只影响「下一条」turn，不回溯历史；`active_model` 落 `settings.json` 并广播 `bitbot:settings-changed`（现有机制），避免多窗口状态漂移。
- **搜索结果真实性**：注入 LLM 的 sources 必须如实回显为可点 citation（markdown 链接），禁止模型编造来源；`search.sources` 随 entry 持久化，刷新后可复核。

---

## 5. Build order（里程碑，按 features.csv 优先级）

> 垂直切片先证明渲染管线，再 must，再 should。

1. **Vertical slice（验证渲染管线 + 防 XSS）**
   - 屏：S02（消息气泡）。数据：transcript_entry.`body` 改存 markdown 源。IPC：渲染层 `renderMarkdown(body)` = `DOMPurify.sanitize(marked.parse(body))`。
   - 交付：普通回复正确渲染标题/列表/代码块高亮，恶意 HTML 被净化。

2. **Must-haves**
   - **Markdown + 代码高亮**（①）：vendor `marked`+`highlight.js`+`DOMPurify`，全量消息应用（S02/S07）。
   - **消息重生成**（②）：`bitbot:msg:regenerate` + `product_surface.regenerateAssistant`（S02/F02）。
   - **联网搜索开关**（③）：composer toggle + `web_search` effect + Tavily/Brave（用户 key）+ citation 渲染（S05/F04/S02）。

3. **Should-haves**
   - **composer 内模型即时切换**（④）：`#model-picker` 下移进 composer + `set-active-model`（S04/F05）。
   - **语音 STT/TTS 默认可用**（⑤）：解 `#voicechat-btn` 隐藏 + Web Speech API + Whisper 回退（S06/F06）。

4. **Fixes from replica-entrepreneur**：跑一轮真实使用后，按用户差评/卡点收口（如 citation 样式、语音中断恢复、搜索默认开关位置）。

---

## Output summary

- **Stack（一句话）**：现有 Electron 桌面端原栈，缺口用 vendored marked/highlight.js/DOMPurify（渲染）+ Chromium Web Speech（语音）+ 公开搜索 API 带用户 key（搜索）补齐，不引入 Web 框架/关系库。
- **表数量**：0 张 SQL 表（本地 JSON 文件存储）；新增 3 类记录形状变更（transcript_entry / settings.json / .env.local）。
- **IPC/路由数**：5 条新增 IPC 通道 + 1 个 host effect（`web_search`）+ 1 个外部公开 API（Tavily/Brave）。
- **三个最高风险**：① markdown 渲染 XSS（必须 DOMPurify）；② 搜索成本/限流与 key 缺失降级；③ 语音权限/离线回退的「默认可用」可信呈现。
- **下一步**：`/replica-design` —— 把上述 5 项落成 Bit Bot 设计系统（composer 搜索/模型控件、markdown/代码块视觉、`bot_reply` 重生成操作条、语音态），token 接 `ui-unified-spec.md` 单一源。
