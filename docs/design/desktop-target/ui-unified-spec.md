# Bit Bot 桌面 UI 统一规范（Design System · 单一源）

> 目的：终结"各写各的样式"。布局/颜色/字体/间距/圆角/组件只允许有**一套**受治理的 token 与组件层，新功能一律复用，不再新增内联样式、原始色值、`!important`。
> 适用：`hosts/desktop/index.html` + `hosts/desktop/ui_chrome.css`（Electron 渲染层）。
> 交叉合同：`layout-contract.md`（几何/面板状态/渲染门 D-L-*、文案 D-C-*、调试面 D-D-*）。本规范管**样式与 token**，几何以 layout-contract 为准绳。
> 状态口径：现状实测基线 → 目标单一源 → 分阶段收敛 → 门禁冻结。

---

## 0. 现状基线（实测，作为 ratchet 起点）

| 指标 | 现状 | 合同/规范目标 | 出处 |
|------|------|----------------|------|
| `!important` 总数（ui_chrome.css） | **418**（其中 Round 10 `grok-ui` 段 **148**） | ≤ **1**（仅 `[hidden]{display:none!important}`） | layout-contract §3 明文，已违背 |
| index.html 内联 `style="` | **349** | 结构性 0；仅允许运行时 JS 计算的动态尺寸（见 §6） | — |
| 内联硬写 `font-size`（style 属性内） | **25** | 0（走类型阶 class） | Round 10 用 `[style*="font-size:11px"]` 反补，属补丁 |
| 原始十六进制色值（css+html） | **160** | 仅 token 定义处可出现色值；其余全走 `var(--*)` | — |
| 并存 token 家族 | **2 套**：`--bg0/--surface/--page-bg/--muted/--line/--accent/--radius-sm`（旧）↔ `--g-ink/--g-sub/--g-line/--g-soft/--g-card/--g-pill`（Round 10） | **1 套语义 token** | — |
| 几何冲突 | `body.grok-ui{--sidebar-w:248px;--header-h:0px}` ↔ layout-contract §3 MUST `280 / 56` | 单一真值（见 §5） | ui_chrome.css:835,1127 |
| `--accent` 语义漂移 | 蓝 `#1e86fc`（旧主题）/ 墨 `#1a1a1a`·`#fff`（grok 主题） | 一个受控"操作强调色" | ui_chrome.css:33,127,162,225 |

---

## 1. 唯一原则（写进 lint 的精神）

1. **单一源**：颜色、字体、字号、行高、字距、间距、圆角、阴影、层级、几何尺寸——只有 token 文件一处定义；其余全 `var(--token)`。
2. **按规范写，不靠覆盖写**：新样式写进组件基类，禁止"叠一层 `!important` 压旧内联"。`!important` 视为缺陷，只许减不许增。
3. **复用优先**：先查 §4 组件清单是否已有对应类；有则用，无则按 §4 命名规范新增一个**通用**基类（不得新增只服务单页/单弹窗的一次性类）。
4. **一切在 `body.grok-ui` 之下消费 token**：不再有"脱离 grok-ui 作用域的第二套皮肤"。

---

## 2. 设计 Token（单一源，语义命名）

> 落点：合并到 ui_chrome.css 顶部**一个** `:root`/`body.grok-ui` 块；旧 `--bg0/…` 与 `--g-*` 过渡期保留为**别名**指向新语义 token（见 §7 收敛），最终删除。

### 2.1 颜色（中性为主，Grok 黑白密度；浅色为默认，暗色见 media/force-dark）

| token | 语义 | 浅色值 | 暗色值 | 取代（别名） |
|-------|------|--------|--------|--------------|
| `--bg` | 页面底 | `#f5f5f7` | `#151515` | `--page-bg` |
| `--bg-elev` | 卡/面板/sheet 面 | `#ffffff` | `#1f1f1f` | `--surface`/`--bg0`/`--g-card` |
| `--text` | 主文本 | `#1a1a1a` | `#ececee` | `--g-ink` |
| `--text-muted` | 次文本/说明 | `#6b6b6b` | `#98989f` | `--muted`/`--g-sub` |
| `--border` | 分隔线/描边 | `#e6e6e9` | `#2e2e2e` | `--line`/`--g-line` |
| `--fill` | 弱填充/hover 底 | `#f4f4f5` | `#2e2e33` | `--g-soft` |
| `--fill-strong` | 选中底/active pill | `#ebebee` | `#3a3a40` | `--g-pill` |
| `--accent` | 操作强调（唯一受控值，默认近黑） | `#1a1a1a` | `#ffffff` | 语义统一，消除蓝/墨漂移 |
| `--accent-ink` | accent 上的文字 | `#ffffff` | `#1a1a1a` | 保留现有 |
| `--danger` | 拒绝/危险态 | 需定义一处 | — | 取代散落红值 |

### 2.2 字体（族）

- 正文/UI：`-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`
- 等宽：`ui-monospace, "SF Mono", Menlo, monospace`
- 规则：族只在 token 定一处；**禁止**逐元素写 `font-family`。

### 2.3 类型阶（Type Scale，取 Round 10 实测数值固化为 token）

| token | 用途 | size/weight/line/ls |
|-------|------|---------------------|
| `--fs-display` | sheet 标题 / `st-title` | 21px / 600 / 1.25 / -0.01em |
| `--fs-card-title` | 卡标题 `st-card-title` / rail 标题 | 15px / 600 / 1.4 / — |
| `--fs-body` | sheet/输入/tab/正文默认 | 14px / 400–500 / 1.5 / — |
| `--fs-caption` | 组标题 `gp-label`/说明 `st-note`/chip/卡内按钮 | 13px / 500 / 1.4 / — |
| — | **11px/12px 一律禁用**：现有硬写归一到 `--fs-caption`；不再用 `[style*="font-size:11px"]` 补丁 |

### 2.4 间距阶（4px 基，取现有实测值归一）

`--sp-1:4 --sp-2:8 --sp-3:12 --sp-4:16 --sp-5:20 --sp-6:24 --sp-7:32`；卡节奏 `gap:14`（st-card margin）、`padding:16 18`、组标题 `margin:18 0 8`。散落的 `4px/6px/9px/10px` margin 归到最近阶。

### 2.5 圆角阶

`--r-control:10`（输入/选择）、`--r-card:12`（st-card/内容卡）、`--r-sheet:16`（bb-sheet/modal）、`--r-pill:999`（chip/按钮/分段 tab）。`--radius-sm:6` 并入 `--r-control` 或删除。

### 2.6 阴影 / 层级 / 几何时序

- `--shadow-sheet: 0 24px 64px rgba(0,0,0,.18)`（唯一 sheet 阴影源）。
- 层级：`--z-rail < --z-modal(60) < --z-toast`（modal/lightbox/toast 之外的 `position:fixed` 一律禁止——见 layout-contract §3）。
- 几何 token：`--sidebar-w:280 --header-h:56 --rail-w:340 --stream-w:760`（真值裁定见 §5）。

---

## 3. 字体/排版规范（明确条目）

1. 全站只在 `body.grok-ui` 设一次基础 `font: var(--fs-body)`；标题/说明一律挂类型阶 class，不写行内字号。
2. 中英混排：数字/单位/代码用等宽阶；界面词保持产品术语（Bot/Routine/Skill/Computer…），不硬翻（沿用 copy-contract）。
3. 行高：正文 1.5、标题 1.25–1.4；长说明用 `--fs-caption` + `--text-muted`，不靠缩小到 11px 挤压信息。
4. 暗色对比：`--text`/`--text-muted` 在暗色下必须达 WCAG AA 对比（token 层保证，不在元素上打补丁）。

---

## 4. 组件基类清单（复用这些，别再发明）

| 基元 | 唯一类名（消费 token） | 规格要点 |
|------|------------------------|----------|
| 模态 sheet | `.bb-sheet` / `.bb-sheet-title` / `.bb-sheet-note` | r-sheet、shadow-sheet、标题走 fs-display |
| 右侧抽屉 | `.bb-modal--right`（target-v2 新增，须并入本 token 体系） | 与 `.bb-sheet` 同 chrome |
| 关闭钮 | 统一 `×` 幽灵钮（现 `#ca-close/#model-close/#mk-close/#bf-close/#settings-close` 合并为 **一个** `.bb-close` 类，别再枚举 id） | 透明边、fs 归一、hover 提升 `--text` |
| 文本控件 | `.bb-control`（输入/select/textarea **单一** skin） | r-control、bg-elev、border、fs-body、focus→border 深 |
| 迷你动作/筛选 | `.bb-chip`（现 `gp-chip/ca-chip/bf-mini` 合并） | r-pill、fs-caption、active→accent |
| 主按钮 | `.bb-btn` + `.bb-btn--accent`/`--ghost`（卡内动作钮走此，别用内联色） | r-pill、fs-caption、accent 语义单值 |
| 分组卡 | `.st-card` / `.st-card-title` / `.st-field` / `.st-field-name` | r-card、gap sp-4/5、title fs-card-title |
| 组标题/说明 | `.bb-label`（现 `gp-label/bf-label` 合并） | fs-caption、text-muted |
| 列表行/会话行 | `.bb-row`（bot/room/session/rail 行共用） | hover fill、active fill-strong、统一 padding 阶 |
| 徽标 | `.bb-badge`（+is-current/is-ready/is-unset 三态） | 走 token，不写死色 |
| 右栏面板 | `.bb-rail`（bot-rail/conv-rail/computer-rail 同一壳，宽 = `--rail-w`） | 单一壳，内容变壳不变 |

> 命名规范：`bb-` 前缀 = Bit Bot 基类（通用、跨页复用）；**禁止**新增 `#某弹窗 .某东西` 这类只服务单实例的样式，也禁止 `[style*=…]` 属性反选补丁。

---

## 5. 布局几何裁定（消除 248/0 与 280/56 冲突）

layout-contract §3 已被 `e2e_desktop_layout_target.mjs` 的 **D-L-* 渲染门**在 1440x900 + 1280x800 双档断言（sidebar 280、header 56、rail 340、stream 760）。因此：

- **真值 = layout-contract（280 / 56 / 340 / 760）**；`body.grok-ui{--sidebar-w:248;--header-h:0}` 属**未同步的遗留覆盖**，须删除或改为与合同一致。
- 若确要采用 248/0 的更紧凑 Grok 密度：**先改 layout-contract §3 + D-L 门 + 本规范 §2.6**，三处一起，不许只改 CSS。二者取一，不允许"合同说 280、样式偷偷用 248/0"并存。
- 几何只能由 token + `body[data-panel]`/`data-sidebar` 单一状态源驱动（layout-contract §1–2），禁止按 class 组合穷举列宽。

---

## 6. 治理红线（"不能再乱来"的可执行条款）

**MUST（新增/改动代码强制）**
- M-1 颜色只允许 `var(--*)`；文件里除 §2 token 定义块外，**0 个新十六进制/rgb() 色值**。
- M-2 字号只允许类型阶 class；**0 个新增行内 `font-size`**、0 个新增 `11px/12px`。
- M-3 **0 个新增 `!important`**；总数只许随收敛下降。
- M-4 新样式必须挂到 §4 的基类；确无对应基类则新增一个**通用 `bb-` 基类**（跨页复用），并登记进本文件 §4。
- M-5 一切在 `body.grok-ui` 作用域内消费 token；禁止新增第二套 `:root`/脱离作用域的皮肤块。
- M-6 `position:fixed` 仅限 modal/lightbox/toast 层且用 `--z-*`；其余回归 layout-contract §3。
- M-7 几何改动与 layout-contract 同步（§5），改一处三处齐。

**SHOULD**
- S-1 动效统一 150–250ms 与 `prefers-reduced-motion` 归零（已有 M40 基线）。
- S-2 每个新增可视块在 1440x900 / 1280x800 × zh-CN/zh-TW 留截图进 `docs/design/desktop-target/reference/`。

---

## 7. 收敛路线（把现状拉回单一源，分阶段、可验证）

- **P1 合并 token（低风险）**：在 ui_chrome.css 建 §2 语义 token 块；把旧 `--bg0/--surface/--page-bg/--muted/--line/--accent/--radius-sm` 与 `--g-*` 全部改为**别名指向语义 token**。此阶段行为不变（值等价），只是单一源成型。裁定并固定 §5 几何真值（推荐 280/56）。
- **P2 去 `!important` 补丁层（核心）**：把 Round 10 `grok-ui` 段 148 处 `!important` **下沉**——将"统一 chrome"的规则改写成 §4 的基类正常样式；逐个删除 index.html 上被这些规则压制用的内联 `style="…font-size/color/…"`（349 个里与 token 冲突的那批），改挂基类。关掉的 sheet/modal 用类而非 id 枚举（`#ca-close/#model-close/…`→`.bb-close`）。每步跑 D-L/D-C 门 + boot e2e 非回归。
- **P3 冻结**：上线 §8 门禁，把 ratchet 基线钉死，之后任何 PR 只许降不许升；新增即红。

每阶段产出：改动前后 `!important`/内联 style/原始色值 计数对照 + D-L/D-C/D-R 全绿截图。

---

## 8. 门禁（把"规范"变成"过不去就合不了"）

1. **新增 lint 脚本 `scripts/prove_ui_tokens.js`（fail 非零）**：
   - T-1 `!important` 计数 ≤ 基线（ratchet），命中豁免清单外即 FAIL；豁免清单唯一项 `[hidden]{display:none!important}`。
   - T-2 除 §2 token 定义块外，行内/样式表**新增十六进制色值** = 0（与基线 diff）。
   - T-3 index.html `style="…font-size` = 0；`.bb-*` 之外无新增硬编码字号。
   - T-4 选择器卫生：禁止新增 `[style*=` 属性反选补丁、禁止新增 `#<modal> .<thing>` 一次性选择器（黑名单式扫描）。
   - T-5 几何单一源：若 `--sidebar-w/--header-h` 在 CSS 出现 ≠ 合同值，FAIL（钉死 §5 冲突不再复现）。
2. **渲染门扩展**：D-L-* 增加"grok-ui 态仍满足合同几何"；新增 **D-ST-*（样式契约）**：对关键基类（sheet/control/chip/card/rail）在双视口断言 `computed border-radius / font-size / color` 命中对应 token（防止有人又写死）。
3. **回归**：`smoke_grok_desktop_parity.sh` 与 boot/layout/shell-v2 全绿不回退；D-C 三语文案不受样式收敛影响。

---

## 9. 一句话执行口径

> 新界面 = 复用 §4 基类 + 只写 `var(--token)`；改旧界面 = 顺手把它从"内联 + `!important`"往基类迁一格；任何让 §0 基线数字上涨的改动，门禁直接拒。

---

## 10. 实施状态（本次波次，gate-verified）

**已完成并跑通门禁：**
- **几何单一源（§5 裁定落地）**：删除 `body.grok-ui{--sidebar-w:248}`、`--header-h:0` 与 `header{position:fixed;height:40px}` 这三处违反合同的"浮层 header"即兴实现——它们正是 layout-contract §3（header 属网格行、`position:fixed` 仅限 modal/lightbox/toast、区域矩形不重叠）被破坏、以及 `body.grok-ui header` 被写了 4 遍（52/48/flex-52/fixed-40 互相覆盖）的"乱"源头。现 `--sidebar-w`/`--header-h` 各仅在 `:root` 定义一次 = **280 / 56**，`body.grok-ui header` 收敛为 **1 条**。
  - 真实渲染门 `e2e_desktop_layout_target.mjs`：FAIL **41 → 3**（D-L 几何/重叠/主区宽 40 项转绿）。
- **Round-10 `--g-*` 家族单一源**：`--g-ink/--g-sub/--g-line/--g-soft/--g-card/--g-pill` 改为语义 token（`--text-ink/--text-sub/--ui-border/--ui-fill/--ui-card/--ui-pill`）的别名，三档（浅/暗/force-dark）取值与旧字面量**逐位相等**（行为不变）。
- **门禁冻结**：新增 `scripts/prove_ui_tokens.js`（LINT ONLY，ratchet 高水位：T-1 `!important`≤409、T-2 原始色值 css141/html28、T-3 行内 font-size≤25、T-4 `[style*=]`补丁≤5、T-5 几何单一源=280/56 且显式拦截 248/0 复发）。当前 **PASS=8 FAIL=0**；收敛后只许下调基线数字。
- **P2 首切片（已落地）**：删除被后置规则 100% 遮蔽的重复 `body.grok-ui header` 块（-2 `!important`，几何零变化，经渲染门复核 header 仍 56）；`!important` 418→**409**。

**非回归验证（本沙箱，真 Electron+xvfb+Playwright）：**
- 静态 lint：`prove_m37/m33/m40/m42/m43/m44/m26/m27` 全绿。
- 渲染门：layout 稳定 FAIL=3，三项均为 **HEAD 既有、非本改动引入**（已在干净 HEAD stash 复核复现同 3 项）：
  1. **D-D-03**（调试面 dev-mode 揭示）：`grok-ui` 用 `display:none` 过度隐藏 `#agents-lab`/`#tools-toggle-btn`，属"调试面治理"独立项；
  2. & 3. **msg column 796/1034 > 760**（none / collapsed）：`body.grok-ui #log{max-width:none!important}`（"全宽 feed、非窄居中列"的既存设计）与 layout-contract §3 的 stream≤760 相冲突。非 bug、是设计分歧，需一处显式裁定（收窄贴合同 / 或改合同+门），**未擅自收窄用户 feed**。
- `e2e_grok_desktop_boot.mjs`：0 FAIL。
- `e2e_desktop_shell_v2.mjs` S-MODEL 点击超时：`#model-entry` 在**干净 HEAD 同为 0×0**（本沙箱无 MoonBit 内核 → 模型芯片空文案、无尺寸），属环境性/honest-skip 类，**非本次改动引入**。

**待办（P2，需逐项渲染验证，勿盲改）：**
- 把 Round-10 段 148→（现≈141）`!important` 下沉为 §4 基类正常样式，并删 index.html 中被其压制的内联 `style="…font-size/color/…"`；`#ca-close/#model-close/#mk-close/#bf-close/#settings-close` 合并为 `.bb-close`。
- 旧 token 家族（`--bg0/--surface/--page-bg/--muted/--line/--radius-sm`）并入语义 token；`--accent` 蓝/墨漂移归一（此项跨明暗主题、影响面大，必须配 `D-ST-*` computed-style 门后再动）。
- 建议：修复 D-D-03 需就"dev-mode 应揭示哪些调试面"做一处显式产品决定，再改 CSS，勿顺手放开。
