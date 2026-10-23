# Bit Bot Grok 缺口 · 组件规格（replica-design 产出）

> 5 个缺口对应的可复用组件。全部消费 `body.grok-ui` 下的 token（治理 M-1/M-5），
> 新增类一律用 `bb-` 前缀的**通用基类**（治理 M-4），不写死色值、不写内联字号、不新增 `!important`。
> 每个组件登记进 `ui-unified-spec.md §4` 基类清单。

---

## C1 · Markdown 渲染器（`.bb-md`）

**缺口**：Bit Bot 当前把 LLM 回复当纯文本渲染，无 markdown / 代码高亮。
**来源**：`replica/architecture.md` 缺口 (1) —— `marked` + `highlight.js` + `DOMPurify` 本地 vendored。

| 项 | 规格 |
|----|------|
| 容器 | `.bb-md`：`font: var(--fs-body)`；`color: var(--text)`；`line-height: var(--fs-body-lh)`；`word-break: break-word` |
| 标题 | `h1/h2/h3` → `font-size: var(--fs-card-title)`；`font-weight: var(--fs-card-title-weight)`；`color: var(--text)`；上下 `--sp-4` |
| 段落/列表 | `margin: 0 0 var(--sp-2)`；`ul/ol` 左 padding `--sp-4` |
| 引用 | `blockquote` → 左侧 `3px solid var(--border)`；`color: var(--text-muted)`；padding-left `--sp-3` |
| 链接 | `a` → `color: var(--accent)`；`text-decoration: underline`；`target="_blank" rel="noopener"` |
| 行内代码 | `code`（非围栏）→ `background: var(--code-bg)`；`font-family: var(--font-mono)`；`font-size: var(--fs-caption)`；`padding: 1px 5px`；`border-radius: var(--r-control)` |
| 表格 | `border: 1px solid var(--border)`；`th` 背景 `var(--fill)` |
| 安全 | 渲染前 **必须** `DOMPurify.sanitize(marked.parse(raw))`；禁止 `innerHTML` 直接塞原始 LLM 文本 |
| 存储 | `transcript_entry` 新增 `markdown: 1` + `rendered_html` 字段（见 architecture §数据模型） |

```html
<div class="bb-md" role="article"><!-- sanitized HTML 注入 --></div>
```

---

## C2 · 代码块（围栏，` .bb-codeblock`）

**缺口**：无语法高亮、无复制。
**来源**：缺口 (1) 的围栏代码子组件。

| 项 | 规格 |
|----|------|
| 容器 | `.bb-codeblock`：`background: var(--code-bg)`；`border: 1px solid var(--border)`；`border-radius: var(--r-card)`；`font-family: var(--font-mono)`；`font-size: var(--fs-caption)`；`max-height: var(--codeblock-max-h)`；`overflow: auto` |
| 语言标签 | `.bb-codeblock-lang`：绝对定位右上；`color: var(--text-muted)`；`font-size: var(--fs-caption)` |
| 复制钮 | `.bb-btn .bb-btn--ghost`（`bb-` 基类，见 §4）；点击写剪贴板 → 短暂显示 `已复制`（`color: var(--success)`，--motion-fast 后复位） |
| 高亮 | `highlight.js` 主题改用 token 变量覆盖（不引入新色族；暗色随 `--bg-elev/--text` 切换） |

```html
<div class="bb-codeblock">
  <span class="bb-codeblock-lang">ts</span>
  <button class="bb-btn bb-btn--ghost" data-act="copy">复制</button>
  <pre><code class="hljs">…</code></pre>
</div>
```

---

## C3 · 消息动作条（`.bb-msg-actions`）

**缺口**：只有"编辑消息"，无"重新生成"、无显式复制。
**来源**：缺口 (2) `bitbot:msg:regenerate` IPC。

| 项 | 规格 |
|----|------|
| 容器 | `.bb-msg-actions`：行内 flex，`gap: var(--sp-1)`；默认 `opacity: 0`；父消息 `:hover` → `opacity: 1`（`transition: var(--motion-fast)`） |
| 复制 | `.bb-btn .bb-btn--ghost`，`data-act="copy"` |
| 编辑 | 复用现有 `#tool-edit-message`（不改），`data-act="edit"` |
| 重新生成 | `.bb-btn .bb-btn--ghost`，`data-act="regenerate"`；点击 → `ipc.invoke('bitbot:msg:regenerate', {entryId})`；点击后置 `disabled` + 文案 `重新生成中`（`--motion-fast` 转圈） |
| 原子锁 | host 侧 `product_surface.regenerateAssistant`：删除该条 assistant 原子 remove + 写 `in_progress` 锁，避免重复触发（见 architecture §并发） |
| 状态回填 | 重新生成完成的 assistant 条 `transcript_entry.regenerated = 1`；动作条可切"上一条/下一条" |

```html
<div class="bb-msg-actions">
  <button class="bb-btn bb-btn--ghost" data-act="copy">复制</button>
  <button class="bb-btn bb-btn--ghost" data-act="edit">编辑</button>
  <button class="bb-btn bb-btn--ghost" data-act="regenerate">重新生成</button>
</div>
```

---

## C4 · Composer 控件（搜索开关 + 行内模型切换）

**缺口**：无联网搜索开关；模型切换只在设置 Sheet，不在输入框。
**来源**：缺口 (3) web_search effect + 缺口 (4) 行内 model switch。

### C4a · 联网搜索开关（`.bb-chip .bb-chip--toggle`）

| 项 | 规格 |
|----|------|
| 基类 | 复用 `bb-chip`（§4）；追加 `--toggle` 修饰：`aria-pressed` 驱动 |
| 常态 | `background: var(--fill)`；`color: var(--text-muted)` |
| 激活 | `aria-pressed="true"` → `background: var(--fill-strong)`；`color: var(--text)`；左侧小图标 |
| 文案 | `联网搜索`（`fs-caption`） |
| 行为 | 切换 → 写入 `composer.web_search = true/false`；发送时 host 走 `web_search` effect（Tavily/Brave，key 在 `.env.local`） |

### C4b · 行内模型切换（`.bb-chip` 或 `.bb-control` select）

| 项 | 规格 |
|----|------|
| 位置 | composer 底部一行，与搜索开关并列 |
| 基类 | `.bb-chip`（`bb-` 通用）；点击展开模型列表（`.bb-sheet` 子壳或 popover，用 `--shadow-sheet`） |
| 行为 | 选择 → `ipc.invoke('set-active-model', {modelId})`；回写 `settings.active_model` |
| 兜底 | 模型列表为空时禁用并提示"去设置添加模型"（复用现有 S-MODEL 入口） |

```html
<div class="bb-composer-controls">
  <button class="bb-chip bb-chip--toggle" aria-pressed="false" data-act="web-search">联网搜索</button>
  <button class="bb-chip" data-act="model-switch" aria-haspopup="listbox">模型：<span data-bind="active-model">默认</span></button>
</div>
```

---

## C5 · 语音状态（`.bb-voice`）

**缺口**：`#voicechat-btn` 被 `display:none` 隐藏；无 STT/TTS 态。
**来源**：缺口 (5) 解除隐藏 + Chromium Web Speech API（Whisper 兜底）。

| 态 | 规格 |
|----|------|
| idle | `#voicechat-btn` 解除 `display:none`；`color: var(--text-muted)`；mic 图标 |
| recording | `color: var(--danger)`；`animation: bb-pulse var(--motion-base)`（脉冲，尊重 `prefers-reduced-motion`） |
| processing | 旋转 spinner（`--text-muted`） |
| 实时字幕 | 用 `.bb-badge.is-current`（§4 三态基类）作"识别中"指示；识别文本作为 user 回合追加进消息流 |
| 失败兜底 | Web Speech 不可用 → 提示"本机不支持语音，已切换到文本"（不崩）；Whisper 二进制缺失同理降级 |

```css
@keyframes bb-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
.bb-voice[data-state="recording"] { color: var(--danger); animation: bb-pulse var(--motion-base) infinite; }
```

---

## C6 · 引用来源（`.bb-cite`，web_search 产出）

**缺口**：联网搜索无引用呈现。
**来源**：缺口 (3) citation 子组件。

| 项 | 规格 |
|----|------|
| 容器 | 出现在 assistant 条底部；`.bb-cite`：`display:flex; flex-wrap:wrap; gap: var(--sp-1); margin-top: var(--sp-2)` |
| 单条 | `a.bb-cite-item`：`background: var(--fill)`；`border: 1px solid var(--border)`；`border-radius: var(--r-pill)`；`color: var(--text-muted)`；`font-size: var(--fs-caption)`；hover → `background: var(--fill-strong)` |
| 内容 | 来源标题（截断）+ 域名；`href` 新标签打开；无 href 时渲染为纯文本 chip |

```html
<div class="bb-cite">
  <a class="bb-cite-item" href="https://…" target="_blank" rel="noopener">来源标题 · example.com</a>
</div>
```

---

## 治理自检（提交前）

- M-1：本文件组件样式除 token 定义外 **0 个新色值**（全 `var(--*)`）。
- M-2：字号全走 `--fs-*` 类型阶，**0 个内联 font-size**。
- M-3：**0 个新增 `!important`**（脉冲动画用普通 keyframes）。
- M-4：新增类均为通用 `bb-` 基类，已登记 §4。
- M-5：token 仅在 `body.grok-ui` 作用域消费。
- M-6：模型列表 popover 用 `--z-modal` 层（`position:fixed` 仅限此）。
- 对比：运行 `python3 contrast.py replica/design/tokens.json` → 期望 0 失败（见 contrast-report）。
