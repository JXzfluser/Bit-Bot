# Replica Build 报告（C1–C6 全面实施）

> 分支 `cursor/desktop-layout-target-v1`，起点 `5cd04d9`（GP-152 后）。2026-10-23 晚。

## 一、关键纠偏（动手前）

活产品 `ui_chrome.css` 的 token 与 `replica/design/tokens.json`（规范目标态）不一致：

| 语义 | 规范目标词（tokens.json） | 活产品真实词（已采用） |
|------|--------------------------|------------------------|
| 次文本 | `--text-muted` | `--muted` |
| 分隔线 | `--border` | `--line` |
| 弱填充 | `--fill` | `--user-bubble`（#f4f4f5） |
| 代码块底 | `--code-bg` | 新增别名 `var(--bot-bubble)` |
| accent 上文字 | `--accent-ink` | `--on-fill` |
| 强调色 | `--accent #1a1a1a` | `--accent #1e86fc`（蓝，未动） |

实现**全部吃活 token**；缺失的 `--code-bg`/`--fill` 定义为现有 token 的别名（**零新 hex，自动随明暗切换**），未使用的 `--success` 已删。

## 二、已实现

| 缺口 | 组成 | 文件 | 状态 |
|------|------|------|------|
| 依赖 | marked v18.1.1 + DOMPurify 3.4.17（UMD，vendored） | `hosts/desktop/vendor/*`、`package.json`(build.files)、`index.html`(script 引入) | ✅ |
| C1 markdown | `renderMarkdownBody`：`marked.parse → DOMPurify.sanitize → innerHTML`，锚点补 `msg-link` 走 Host 打开 | `index.html` | ✅ |
| C2 代码块 | `decorateCodeblock`：语言标签 + 复制钮（`.bb-codeblock`）；按 Grok 无高亮，不做 hljs | `index.html` + `ui_chrome.css` | ✅ |
| C3 重新生成 | assistant 操作条加「重新生成」→ `bitbot:msg:regenerate`；main 复用 `runner.runTurn` 重跑前置 prompt，`sessions.removeMessage` 原子删旧条、仅存新 assistant 行 | `index.html` / `preload.js` / `main.js` / `sessions.js` / `ipc-contract.md` | ✅ |
| C4 composer 控件 | `.bb-composer-controls`：联网搜索 toggle（持久化 `settings.search_default`，`webSearch` 经 turnOpts→runner `search`）+ 模型芯片（复用 `openModelSheet`） | `index.html` / `main.js` / `ui_chrome.css` | ✅ |
| C5 语音 | **产品已内建**：`startVoiceInput`（MediaRecorder + `bitbot:voice:ingest`）/ `startVoiceChat` / `#voicechat-bar` 均接线，非缺失，未重建 | — | ✅（已存在） |
| C6 引用 + 真搜索 | 前端 `.bb-cite` 渲染；Host `webSearch()`（Tavily/Brave）→ `run_moon_turn` 先搜后答 → `executeLlmChat` 把真实来源注入 system → 末条 assistant 挂 `sources` 画引用；无 key 时诚实降级并说明 | `index.html` / `ui_chrome.css` / `host_ffi.js` / `run_moon_turn.js` / `main.js` / `index.html`(凭证表单) | ✅ |

### C6 凭据链路（和大脑 key 同一条开放配置）

- 表单：设置 → 凭证 → **联网搜索**（服务 Tavily/Brave、API Key 掩码显示、可选 API Base）。
- 落盘：`hosts/desktop/.env.local`（gitignored，权限 0600，保存即热加载），三个变量
  `BITBOT_SEARCH_PROVIDER` / `BITBOT_SEARCH_API_KEY` / `BITBOT_SEARCH_API_BASE` 已加入 `ALLOWED_SECRET_KEYS`，
  因此 `secrets:set` 不会再以 `key not allowed` 拒绝。
- 解析顺序：进程 env → `hosts/desktop/.env.local` → `<repo>/.env.local`（CLI 与打包应用同一口径）。
- 失败语义：无 key → `search_key_not_configured`，`main.js` 追加一条如实说明，**不编造来源**；
  有 key 但请求失败 → 同样的诚实降级，不阻断回答。

## 三、验证

- `node scripts/prove_ui_tokens.js` → **PASS=8 FAIL=0**（css hex 139≤141、`!important` 见 §八 已由 346 降到 247、行内 font-size 25、几何 280/56）。
- `node --check main.js / preload.js / sessions.js / host_ffi.js / run_moon_turn.js` 全过。
- `index.html` 3 个内联脚本 `vm.Script` 解析 **0 语法错误**。
- `replica/design/contrast.py` → 10 pairs / 0 AA fail（未变动）。
- **C6 降级路径**（无 key，真跑）：`{"ok":false,"error":"search_key_not_configured","sources":[]}`，不崩、不假装。
- **C6 正常路径**（本地 mock Tavily，真跑）：2 条来源正确映射（`snippet ← content`），`HAPPY PATH PASS`。
- **C6 凭据文件路径**（key 只在 `hosts/desktop/.env.local`，env 干净）：真请求带上该 key → `ENV-FILE PATH PASS`。
- **C1 可见文本不回归**（vendored marked 真跑 10 类回复）：纯文本回复可见文本与原文一致；粗体/行内码/列表/链接/引用/表格/代码块只吃语法符，不吞正文、不凭空造字（唯一"缺"的是围栏语言名 `js`，它在 UI 里由 `.bb-codeblock-lang` 单独显示）。

## 五、视觉自检（渲染真实截图后改的 5 个问题）

用产品真实样式表 + 从 `index.html` 原文切出的渲染函数生成了 `replica/preview/component-preview.html`
（`build_preview.js` 可重建），在真实 Chromium 里跑起来并截图，才发现下面这些光看代码看不出来的问题：

| # | 症状 | 根因 | 修法 |
|---|------|------|------|
| 1 | composer 两个 chip 显示成 `webSearch` / `modelSwitch` | i18n 三语字典里没这两个键，`wavegT()` 缺键时回落成键名，而 `wavegT` 的静态扫描会 `textContent = wavegT(k)` 覆盖掉写在 HTML 里的中文 | zh-CN / zh-TW / en 三处各补 `webSearch`、`modelSwitch` |
| 2 | 窄宽度下 chip 文字竖排（一列一个字） | `.bb-chip` 没设 `white-space` | 加 `white-space: nowrap` |
| 3 | 代码块的 `moonbit` 标签和「复制」钮叠字 | 两者都绝对定位在右上角，`right:16px` 与 `right:8px` 挤在一起 | 顶部留 24px 工具条：语言标签改左上，复制钮保持右上 |
| 4 | 引用区被挤到卡片**右侧**成一竖列巨 pill | `renderCitations` 挂在消息根上，而 `.msg.assistant` 是「头像 + 正文」的 flex 行，多出的节点成了第三个 flex 兄弟 | 引用改为 append 到 `.body` 内（真正的正文卡片里） |
| 5 | hover 时操作条压住第一行文字（加了「重新生成」后更明显） | `.msg-actions` 绝对定位在卡片右上角（GP-14 旧样式），按钮一变多就遮字 | assistant 消息 `flex-wrap: wrap`，操作条 `position: static; order: 3` 落到气泡下方，与正文左缘对齐（Grok 的做法） |

同时用真实计算色跑了新增组件配对的 WCAG 2.2 检查（浅/深各 7 对）：引用 pill、正文链接、代码文字、语言标签、复制钮、chip、用户气泡 —— **全部 ≥ 4.5，CONTRAST PASS**。

产物：`replica/preview/component-preview.html`（可交互：暗色切换、搜索开关、代码复制、悬停操作条）、
`preview-light.png` / `preview-actions.png` / `preview-dark.png`。

## 六、待办

1. **另外三个 e2e 需要 Linux 图形环境**：`e2e_desktop_layout_target` / `e2e_desktop_user_journeys` / `e2e_modal_computed`
   在 macOS 上没有 `DISPLAY` 也没有 `xvfb-run`，会老实打 `SKIP — no DISPLAY and no xvfb-run`（**SKIP ≠ PASS**），
   只能在 Linux CI 上跑。`e2e_grok_desktop_boot` 已能在 mac 上真跑，见 §八。
2. **内核侧搜索意图**：目前"要不要搜"由 Host 按 `ctx.search` + 是否存在 `llm_chat` effect 判定，
   MoonBit `cmd/desktop_turn` 尚未自己产出 `web_search` effect。功能已可用，但缺少内核层的自主判断。
3. **`--accent` 存在两份互相矛盾的定义**：`:root` 是蓝 `#1e86fc`（注释写着 "one clean blue"），
   `@media (prefers-color-scheme: light)` 里又写成黑 `#1a1a1a`。后者赢，所以产品现在整体是黑白调，
   `--accent-soft` 也从蓝染 `#e9f2fd` 变成灰 `#f0f0f0`。这是品牌决策，本轮**没动**；
   要与参考图的蓝色（未读点 / 主按钮）对齐就需要定一个。

## 七、如何跑门禁

```bash
node scripts/prove_ui_tokens.js          # 样式单一源 ratchet
node --check hosts/desktop/main.js        # JS 语法
python3 replica/design/contrast.py replica/design/tokens.json   # 对比度 AA

# e2e（真实 Electron；mac 需要 ELECTRON_RUN_AS_NODE 被清掉）
env -u ELECTRON_RUN_AS_NODE node scripts/e2e_grok_desktop_boot.mjs
```

## 八、为什么"对着 Grok 做却没复刻出来"——根因与修复

> 用户提问："为什么对照做 grok bot 的界面都没有复刻好了？找出问题，修复好"

结论：**不是没写 Grok 的规则，而是后来每一轮都把上一轮的规则用 `!important` 压掉了，
活下来的是 WorkBuddy 形态；而门禁又把那个形态冻结成了"契约"，于是没人能改回去。**

### 8.1 三层根因

| 层 | 证据 | 后果 |
|----|------|------|
| **① 皮肤层轮次覆盖** | `ui_chrome.css` 里 `body.grok-ui #composer` 有 **5 个**重复块（Round 2/4/4b/8 + 末尾），`#sidebar-toolbar` 有 **8 处**覆盖（Round 2/3/4/8/8b/9…）。文件里 `!important` 共 **346** 条 | 最后写入者赢，于是"搜索=全宽输入框 + 蓝色填充『＋』"、"输入框=两行 WorkBuddy 盒子"、"回复=带头像/描边/投影的卡片"活了下来。`index.html` 里本来就有的 Grok 规则（30px 圆钮、居中 760 列）被压成了死代码 |
| **② 门禁把错的样子写成契约** | `prove_m42_stream.js` 断言 `.msg.assistant .body` 必须有 `border-top-left-radius: 8px`（朝 32px 头像的尾角）、`.msg.assistant + .msg.assistant::before { visibility: hidden }`；`prove_m43_settings.js` 引用同一条 | 断言锚的是"某一轮的实现"，不是"参考图的事实"。参考图里 assistant 根本没有头像，尾角自然也不该存在；但改回去门禁先红 |
| **③ 文案与布局互相牵连** | 三份词典的 composer placeholder 长度不同（zh-CN 带 `/ 技能 · @ Bot · Shift+Enter 换行`），最长的那句在单行胶囊里被裁成两行；英文词典那条还写着中文 | 单行输入框里占位被裁、英文界面出现中文 |

### 8.2 修法（单一真源，零 `!important`）

- 在 `ui_chrome.css` **末尾**新增一个 parity 块，全部走正常层叠；同时**删掉 8 轮互相打架的覆盖块**。
  `!important` 从 **346 → 247（-99）**，`prove_ui_tokens` 的 T-1 棘轮只降不升，正好满足。
- assistant 气泡：去头像、去描边、去投影、去 85% 宽度上限 → 满列宽的平面块（参考图实测 `#f6f6f6`、无描边）。
- 侧栏顶部：两个 32px 圆形幽灵按钮、右对齐；搜索从"全宽输入框"改回**图标**（点开才显示真实 `#session-search` 行）。
- 输入框：单行胶囊 `[＋][输入][chips][麦克][↑]`；`#composer-controls` 从"第二行工具栏"搬进 `.row`；
  胶囊还给 `.row`（挂在 `#composer` 上会把「内核继续下一步」那行也吞进胶囊里）。
- 状态提示（未配 key / 正在执行）→ 胶囊**上方**居中灰字，不做告警卡片、不塞进胶囊。
- 占位文案三语统一缩短为「给 Bit Bot 发消息…」，快捷键提示移到 `title`；顺手修好英文词典里的中文。

### 8.3 顺带修掉的 5 个真问题（跑真机才暴露）

| # | 问题 | 根因 | 修法 |
|---|------|------|------|
| 1 | 输入框只有 **499px**，气泡却是 760px，一眼错位 | grid item 上 `margin: 0 auto` 会让 `justify-self: stretch` 失效，盒子退化成 fit-content | `width: 100% + max-width + justify-self: center` |
| 2 | 聊天区和输入框之间有一道**灰色长缝** | `body` 用 `--page-bg(#f5f5f7)`、`#main` 用 `--bg0(#fff)` | `body.grok-ui { background: var(--bg0) }` |
| 3 | Markdown 渲染打破了 **GP-93 fail-closed**：`![](…)` 会真去拉远端图片、`<img onerror>` 变真元素、锚点被加了 `target=_blank` | C1 引入 marked 时只在最后统一 `classList.add("msg-link")`，没做"危险构造降级为文字" | `defangMarkdown()`：原始 HTML / 图片语法 / 非 http(s)/mailto 链接一律降级成**文字**（围栏与行内代码原样保留），再加 `DOMPurify FORBID_TAGS` 兜底、去掉 `target` |
| 4 | Bot 面板「置顶」按钮连点两次，状态回不去（多 Bot 时才出现） | 按钮闭包了渲染时的 `bot.pinned` 快照，而面板重渲染是异步的 | 点击时现读一次 `bots.detail` 再决定 pin/unpin |
| 5 | 6 个 e2e 在 mac 上全部假 `SKIP — electron dist missing` | 写死 `node_modules/electron/dist/electron`（Linux 布局），mac 在 `Electron.app/Contents/MacOS/Electron` | 新增 `scripts/electron_bin.mjs`，按 electron 自己的 `path.txt` 解析 |

另外把 4 条"锚在实现细节上"的断言放宽到语义等价（`applyLinkBodyTo(el.querySelector(".body"), …)` 字面量、
`attachMessageActions` 的 3000 字符窗口、`placeholder.includes("Shift+Enter")`），
并让 `prove_m24` 在"本地少于 2 个可见 Bot"时显式 `SKIP` 而不是 `FAIL`（那是数据前置，不是代码）。

### 8.4 验证（本轮真实数字）

- `node scripts/prove_*.js`：**33 个脚本全绿**（`prove_m24_window` 1 条显式 SKIP：本地只有 1 个 Bot）。
- `node scripts/prove_ui_tokens.js`：**PASS=8 FAIL=0**，`!important` 346→**247**，hex 139≤141。
- `node scripts/e2e_grok_desktop_boot.mjs`（真实 Electron）：**PASS=127 FAIL=0**。
  首次真跑是 **106 / 7**，其中 2 条是上面第 3 号真问题、4 条是"本机只有 1 个 Bot"的数据前置、
  1 条是 quote chip 的空白敏感比较。
- 多 Bot 用例现在会临时补一个探针 Bot（极早时间戳，避免改变侧栏行序），退出时按快照还原 `bots.json`。
- `renderMarkdownBody` 逐类喂样本实测：正常链接→真 `<a class="msg-link" rel=noopener>` 且 **无 target**；
  `javascript:` 链接 / `<img onerror>` → 纯文字、0 锚点、0 图片；围栏代码 `1 < 2` 只转义一次、语言标签与复制钮在位。
- 交互实测：搜索图标点开→真实输入行出现→再点收起；联网搜索 chip `false→true→false`，激活态带 `✓` 前缀与实心边框。

## 九、左侧列表本体：从「一排小卡片」改成「一条列表」

> 用户追问："为什么左侧一直没有处理呢"

上一轮（§八）只改了侧栏**顶部那两个圆钮**，列表本体一行没动。这次补上，
并且**不是凭印象改，是把参考图逐像素解出来再改**。

### 9.1 先把参考图的数字量出来（不靠目测）

`replica/screens/grok-composer.png` 是 2080×1520 的 2x 截图（CSS 尺寸 1040×760）。
用一个最小 PNG 解码器（node `zlib` 手工反滤波）沿横竖线取色，得到：

| 事实 | 实测值（CSS px） | 我们原来的实现 |
|------|------------------|----------------|
| 侧栏底色 | `#f5f5f5`，右缘 1px `#e4e4e4` 线，宽 280 | `#f7f7f7` + `--line` |
| 行与行之间 | **没有任何分隔线**，靠留白分开，行高 **58** | 12px 圆角白卡 + 1px 描边 + 投影 + 8px 间距 |
| 选中行 | **内缩 12px 的圆角色带**，高 54、半径 ≈12、亮度 ≈90% | 通栏 `#f0f0f0` + 左侧 2px 强调条 |
| 图标 | ≈32×36，左缘 x≈23.5，彩色插画（不是白字实心圆） | 30px 实心色圆 + 白色字母 |
| 标题 | 左缘 x≈65.5，15px/600 `#1c1c1c` | 13px/600 |
| 预览 | 13px `#626262`，单行省略 | 11px |
| 分组标签 | 比标题淡的 13px | 10px/600 `#6f6f6f` |
| 区块标题 | 一套（大小/颜色一致） | 「Bot 列表」「会话」深色 12px，「群组」灰 11px |

第一版我按"通栏行 + 1px 细线"改完，然后用像素探针复核，发现**这两条都是错的**：
参考图行间没有线、选中行是内缩圆角块。于是按测量值再改一度。
这一步是本轮最有价值的地方——目测放大图会把留白看成描边。

### 9.2 改法

- 形状单一真源：`index.html` 的 `.sess-row`（`border: 0` / `radius 12` / `padding 9px 12px` / `gap 10px`）
  与 `.sess-avatar`（32px、`color-mix` 浅底 + 同色字形）。
- 容器与标题单一真源：`ui_chrome.css` 末尾新增 **parity block 2**，
  零 `!important`，只靠 `body.grok-ui` 前缀权重覆盖基类。
- 新增 3 个变量（**全部用 `color-mix` 从既有 token 混出，不新增字面色**）：
  `--nav-row-hover`（ink 4%）、`--nav-row-active`（ink 8% over side）、`--nav-label`（muted 55% over side），
  深浅色模式自动跟随。
- 身份色从"行内 `style.background`"改成 `--av` 变量：**样式决定形态，数据只给颜色**，
  这样"浅底 + 彩色字形"是样式表说了算。
- 删掉 Round 2 / 7 / 8 / 8b / 9 里互相打架的 `#agents`、`.sess-row`、`#bot-new-btn`、
  `.panel-title.panel-head`、`#bot-list > *` 覆盖块 → `!important` **247 → 198**，hex **141 → 139**。
- `#bot-new-btn` 从"绝对定位压住「Bot 列表」标题"改成列表里的一行动作（`+ 新建 Bot`）。
- 侧栏空状态（"还没有群组。"）原来裸写 `padding: 2px 0 4px`，贴着边被切 →
  统一成 `.sess-empty` 类，与行同左边距。
- 底部账户行改成真正的胶囊（`[头像][名称][chevron]`，999px 圆角），分隔线通栏。

### 9.3 门禁跟着形状改（而不是让形状迁就门禁）

`prove_m39_micro.js` 原来钉的是 `.sess-row:hover { transform: translateX(1px) }` 与
`:active { scale(0.995) }`——那是给"带描边的卡片行"做微交互。参考图里行只变色不位移，
所以断言改成：悬停走 `var(--nav-row-hover)`、行是 `radius-xl` 圆角色带、**且不存在行间分隔线规则**。
`prove_m40_a11y.js` 的 reduced-motion 断言同步改成"行色带渐变关闭"。

另外修了一个**假门禁**：`prove_gp96_progress.js` 用绝对阈值 `firstWall < 100ms` 断言
"首个进度事件早于回合结束"。并行跑 33 个脚本时机器负载会把首帧推到 101~149ms，
于是时红时绿，而它的语义（边想边显示）其实完全成立。改成相对判据
（`firstWall < 400 && firstWall * 2 < lastWall`），断言的对象回到行为而不是机器速度。

### 9.4 验证

- `node scripts/prove_*.js`：**33/33 全绿**。
- `node scripts/prove_ui_tokens.js`：**PASS=8 FAIL=0**，`!important` **198**、css hex **139**、html hex **28**，
  基线已按"只许降"下调到当前值。
- `node scripts/e2e_grok_desktop_boot.mjs`（真实 Electron）：**PASS=127 FAIL=0**（几何改完后重跑），
  侧栏相关的 GP-116 / 117 / 123 / 127 未受影响。
- 实测（CDP 计算样式）：行 `x=12 w=256 h=57 radius=12 border=0 shadow=none`；
  图标 `32×32 radius=50% background=color-mix`；标题 `15px/600 #1a1a1a`；预览 `13px #6f6f6f`；
  选中行 `color(srgb .899)` = ≈`#e5e5e5`；账户胶囊 `259×42 radius=999px`。
- 对照图：`replica/preview/reference-sidebar-rows.png`（参考裁图）/
  `after-sidebar-search.png`（改前，旧卡片行）/
  `after-sidebar-list.png`（改后）。
