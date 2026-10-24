# Grok 真源对齐 —— 差量对照稿 v1（待点头）

> 生成：2026-10-24 · 状态：**待用户点头，未改任何源码**
> 真源：本机 `/Applications/Grok Bot.app` v0.75.0，以 CDP(:9224) 实探渲染层取到的 resolved 像素值。
> 基准文件：[grok-real-spec.json](file:///Users/zfl/Downloads/bitbot/docs/design/desktop-target/reference/grok-real-spec.json)（Grok 侧）·[bb-real-spec.json](file:///Users/zfl/Downloads/bitbot/docs/design/desktop-target/reference/bb-real-spec.json)（我方侧，同字段同量纲，1040×760 浅色）
> 复现命令见 §6。

---

## 1. 目标 → 支柱 → 需求

**目标**：Bit Bot 桌面宿主的皮肤与 Grok Bot 真机一致到「可指认」——同一屏摆在一起，除内容与品牌名外指不出视觉差；且这套一致性由**门禁 + 单一 token 源**长期守住，不靠一次性手工微调。

- **支柱 P1 真源唯一**：所有视觉期望值只能来自 `grok-real-spec.json` 的实测数；文档、脚本常量、记忆里的"我记得 Grok 是这样的"一律作废。
- **支柱 P2 单源可守**：值只定义在一处 token 块，主题切换靠变量而非重复色值；ratchet 预算由收敛重复块腾出，而不是靠新增硬编码。
- **支柱 P3 门重锚**：三条互相冲突的门（`e2e_grok_desktop_spec` / `prove_m33_grokchrome` / `smoke_grok_desktop_parity`）统一改成读实测真源，改完必须**先红后绿**——先让旧的错值变红，证明门真的在管。
- **支柱 P4 可感面**：每批改动都能在真机窗口里指出「这里变了」，并有截图对照。

---

## 2. 已裁决项（用户 2026-10-24 点头）

| # | 裁决 | 后果 |
|---|------|------|
| D-1 | **主操作色跟真源走近黑 `#1c1c1c`**，紫色 `#7c3aed` 不再是 accent | `ui-unified-spec §2.1` 的 accent 权威值要改；`--accent` 5 处定义（css:34/130/165/199/232）连同门 A1/A2/A9 一起换；紫色只在「作者名按作者着色」这类真源确有紫色的位置保留为 per-author 色，不作全局 accent |
| D-2 | **先出对照稿，点头后才改代码** | 本文件即对照稿；§5 的改动清单在点头前不落源码 |

---

## 3. 真源关键值（实测摘要）

窗口 1040×760 @dpr2，浅色。色值取自 Grok 自己的 CSS 变量：`--sand-bg-primary #1c1c1c`、`--sand-bg-secondary #1c1c1c0f`、`--sand-text-primary #1c1c1c`、`--sand-text-secondary #1c1c1cad`、分隔 `rgba(28,28,28,.08)`、未读点 `#0b6dd3`、在线绿 `#14c16f`。

| 位置 | 真源实测 | 出处（Grok 选择器） |
|------|----------|---------------------|
| 应用底 / 侧栏底 | `#fcfcfc` / `#f5f5f5`，右侧分隔线 **0.5px** `rgba(28,28,28,.08)` | `body`、`.sand-agents-sidebar` |
| 侧栏宽 | **280**（与我们现值一致，唯一已对上的大几何） | 同上 |
| 会话行 | **255.5 × 54**，圆角 **10**，padding 8，gap 8，行距 58（间隙 4），标题 **16px/420** `#1c1c1c`，预览 **13px/18px** `rgba(28,28,28,.68)` | `.sand-agent-item` |
| 侧栏头像 | **36×36**，容器 `border-radius: 0` —— 形状来自 SVG blob 放大 153% 溢出，**不是圆形裁剪** | `.sand-agent-item__avatar` |
| 分组标题 | 高 30，padding 8/8/6，文字 **12px/420** `rgba(28,28,28,.68)`，`text-transform: none` | `.sand-agents-section__header` |
| Composer | dock 高 60（padding `0 16 16`），白 pill **728 × 44**，圆角 **22**，边框 **0.5px** `rgba(28,28,28,.12)`，阴影 `0 2px 8px -1px rgba(0,0,0,.05), 0 1px 2px rgba(0,0,0,.03)`；输入 14px/20px，左缩进 44.5 | `.sand-kit-message-input-frame` |
| ＋ / 麦克风 / 发送 | 全部 **28×28** 圆（radius 9999）。＋与麦：底 `rgba(28,28,28,.06)` + `0.5px` inset 环，图标 `rgba(28,28,28,.56)`。发送（有字态）：**实心 `#1c1c1c`**，白箭头，无阴影 | `.sand-prompt-actions-row button` |
| 气泡 | 圆角 **18**，padding **7px 12px**，无边框；助手底 `rgba(28,28,28,.06)`，**用户底 `#1c1c1c` + 白字**；阴影只有 0.5px inset 高光三件套；正文 **14px/420/20px** | `.sand-message` |
| 作者名 / 流内头像 | 名字 **12px/420** `rgba(28,28,28,.68)`（**不是强调色**）；流内头像 **22×22**，`border-radius: 0`（同为 SVG blob） | `.sand-author-run` |
| 消息列 | 面板 760、行 **728**（两侧各 16）、气泡 max **558.4px ≈ 76.7%** | `.sand-virtual-transcript__row` |
| 底部账户条 | 高 **52**，padding `0 16 16`，gap 2；白胶囊 **171.5×36**（radius 9999，无边框无阴影）内含 36px 圆头像 + **14px/500** 邮箱；右侧**独立的「连接应用」白胶囊 68×36** | `.sand-agents-sidebar__footer` |

---

## 3.5 截图复核补充（数值测不出来、但一眼能看出的形态差）

来自 `/tmp/grok_ref/00-window-full.png`（真机团队会话满屏态）逐项目视核对：

1. **作者名是按作者着色的**，不是统一灰、也不是统一强调色：`kkk` 近黑、`选题策划师` 棕、`内容主笔` 青 —— 与各自头像同色系。我方现在是**统一紫色 600 字重**，两头都不对（既不是灰也不是按作者）。真源实测的 `rgba(28,28,28,.68)` 只是 `kkk` 那一条的样本值，落地时必须走 **per-author 色**（复用 `AVATAR_PALETTE`，与头像同源）。
2. **流内头像挂在气泡的左下，不是气泡上方**：结构是「作者名（上）→ 气泡 → 头像（气泡左下外侧）」。我方现在是「头像+名字并排在气泡上方」。这条是**结构差**，不是数值差，只改 CSS 数值改不出来。
3. **代码块是气泡里再嵌一张白卡**：外层灰气泡 radius 18，内层代码块是纯白卡（无边框、有自己的圆角与内边距）。我方现在代码块是独立深底块，没有这层「灰包白」关系。
4. **composer 尾部那颗圆钮是实心深色**（空态即深色），＋ 是浅灰底 + 极细 inset 环；两颗尺寸同为 28。我方现在是「浅灰 ＋ + 紫色发送」，空/有字态也没有区分。
5. **顶部是浮起的团队胶囊**（多头像叠放 + 团队名）压在一段渐隐遮罩上，不是通栏 header 条。我方 `--header-h: 56` 的通栏结构与之不同 —— 属结构差，需单独裁决是否本轮动。
6. **未读点是行右侧的小蓝点**（`#0b6dd3` 8×8），且**只有未读行有点**，不是每行常驻。
7. 侧栏底部右侧那枚是**已连接应用的图标胶囊（含数量角标）**，不是文字「连接应用」按钮 —— 与 §4.5 的结构差相关，等 `accountPopup` 实测确认点击行为。

---

## 4. 差量清单（现状 → 目标）

> 逐字段全量差表自动生成在 [docs/design/desktop-target/alignment-delta-tables.md](file:///Users/zfl/Downloads/bitbot/docs/design/desktop-target/alignment-delta-tables.md)（重跑：`node scripts/grok_delta_report.mjs --md docs/design/desktop-target/alignment-delta-tables.md`）。最新一轮（含弹层/＋菜单/连接应用/交互态四区）：**同值 110 · 差值 420 · 仅真源 1315 · 仅我方 396**。注意「仅真源 1315」被连接应用面板的 **67 行插件**逐字段放大了（Grok 装了 67 个，我方 2 个），按结构看真正的缺件是 §4.5 末尾列出的 4 处入口 + 13 段分组标题。

> 现状列来自 `bb-real-spec.json`（我方 1040×760 浅色实测）与源码定义位置。标注 ⚠️ 的是**改了会让现有门变红**的项，必须与 §5 的门重写同批落地。

### 4.1 Token 层（单一源）

| token | 现状 | 真源目标 | 定义位置（需同步的份数） |
|-------|------|----------|--------------------------|
| `--accent` ⚠️ | `#7c3aed` 浅 / `#a855f7` 暗 | `#1c1c1c`（浅）；暗色态下主操作为反白 | css:34/130/165/199/232 —— `--accent` **5 份**；连 `--accent-soft` 一起是 10 份（见 §7 W1） |
| `--text` / `--ink` | `#141414` / `#1a1a1a` / 暗 `#ececec` | `#1c1c1c`；暗 `#fcfcfc` | css:29/30/126/127/161/162/195/196/228/229 |
| `--text-muted` | `#6f6f6f` 系 | `rgba(28,28,28,.68)` | 同上各块 |
| `--border` / `--line` | `#e3e3e3` 实线 1px | `rgba(28,28,28,.08)` **0.5px** | 各块 + 消费处的 1px 描边要降为 0.5 |
| `--bg` | `#f5f5f7` | `#fcfcfc` | css:119-252 各块 |
| 侧栏底 | `--side` | `#f5f5f5` | 同上 |
| 弱填充 `--fill` | `#f4f4f5` | `rgba(28,28,28,.06)`（= `#1c1c1c0f`） | 同上 |
| 未读点 | 现值 | `#0b6dd3` 8×8 | 消息行 |
| 圆角阶 | `--radius-composer 22` 但被 css:1798 硬写 24 覆盖；`--radius-bubble 16` | composer **22**（消灭硬写 24）、气泡 **18**、行/控件 **10** | css:83-92 + css:1798 + css:1189-1199 |
| 字阶 ⚠️ | 合同禁 11/12px，正文 15px | 真源确有 **12px 分组/作者名**、**13px 预览/菜单**、**14px 正文**、**16px 行标题**（weight 420） | 需同时改 `ui-unified-spec §2.3` 与 `prove_ui_tokens` 的字号白名单 |

**ratchet 预算（已实测，`node /tmp/w0_sim.js` 口径 = 声明行里的字面色值）**：`ui_chrome.css` 现有 **142** 个硬编码色值，其中 **115 个**落在 5 个调色声明块（`:14-117`、`119-151`、`152-186`、`187-219`、`220-252`），另有 6 个在 `1239` 的暗色补充块。24 个主题变量在 `media-light` 与 `force-light`、`media-dark` 与 `force-dark` 之间**逐字相同、零漂移** —— 也就是说这 4 个块现在只是同一份色被抄了 4 遍，改色必须 4 处齐改。

收敛方案：把这 24 个（+ 只在暗色侧出现的 5 个）抽成 `:root` 里的 `--p-lt-*` / `--p-dk-*` 原语 **43 个色值**（`scripts/w0_palette_consolidate.mjs` 实跑输出），4 个主题块变成不含字面量的 `var()` 映射。**实测（不是预测）**：把 5 块删除并并入生成物后，注释剥离口径的 css hex 从 **139 → 67**，其中块内 115 → 43、块外 24 不变 —— 一次腾出 **72** 个预算槽，供后续四区改动消费。这是 P2 的前置动作，**必须在换色之前做**。

### 4.2 侧栏会话区（两侧均 CDP 实测，force-light 1040×760，同宽 280 侧栏）

> 本表数值可由 `node scripts/delta_emit_regions.mjs markdown` 从两份 real-spec 重新生成（§6）。本轮已逐行核对生成值与下表一致。
>
> **对照成立的前提（本轮验证）**：我方渲染器给侧栏行挂的类就是 `"agent-item sess-row"`（[index.html:5087](file:///Users/zfl/Downloads/bitbot/hosts/desktop/index.html#L5087)、5395、9946），真源是 `button.sand-agent-item` —— 同一个角色、同一命名族；实测到 **27 条真实可见行**（`left 12 / width 255`，落在 280 侧栏内），不是隐藏区采样。

**会话行 `.sess-row` ⇄ Grok `button.sand-agent-item`**

| 实测项 | Grok 真源 | 我方现状 | 差 |
| --- | --- | --- | --- |
| 行高 height | **54** | 58 | −4 |
| 行间距 interRowGap | **4** | 0 | +4 |
| 垂直节距 verticalPitch | **58** | 58 | **已同值** |
| 行宽 width | 255.5 | 255 | 0.5（可忽略） |
| 圆角 borderRadius | **10px** | 12px | −2 |
| padding | **8px 8px 8px 8px** | 11px 9px 11px 6px | 上下 −3、右 −1、左 +2 |
| column-gap（头像→文字） | **8** | 11 | −3 |
| 标题字号/字重 | **16px / 420** | 13.5px / 600 | +2.5px、−180 重量 |
| 标题行高 | normal（实测 20） | 18px | +2 |
| 预览字号/字重 | 13px / **420** | 13px / 400 | 字重 +20 |
| 预览色 | **rgba(28,28,28,.68)** | rgb(111,111,111) | 换成语义化墨色 alpha |
| 文字起始 left | 64 | 65 | −1（padding 左 8 + 头像 36 + gap 8 = 64，**结构自洽**） |
| 空闲底 | transparent | transparent | 同 |
| hover 底 | **rgba(28,28,28,.06)** | `color-mix(in srgb, var(--ink) 4%, transparent)` → 实测 rgba(26,26,26,.04) | 机制**已经同类**，只差比例 4%→6% 与墨值 26→28 |
| 选中底 | **rgba(28,28,28,.08)** + `aria-current` | `color-mix(in srgb, var(--ink) 8%, var(--side))` → 实测 **不透明 rgb(229,229,229)** | 比例 8% **已经对**，错的是混合基色：`var(--side)`（实色底）应改 `transparent` |
| 选中阴影 | none | none | 同 |

**三态的真实修法（本轮定位，比「换成半透明」更准）**：两侧都用「墨色按百分比洗」的机制，我方 token 已经存在 —— [ui_chrome.css:1936-1937](file:///Users/zfl/Downloads/bitbot/hosts/desktop/ui_chrome.css#L1936-L1937) 两行改成 `4%→6%` 与 `var(--side)→transparent` 即可，**不新增任何硬编码色值，ratchet 零成本**；剩下 26→28 随 W1 的 `--ink` 一起走。我方此前在暗色态刺眼，正是因为 `color-mix(…, var(--side))` 把选中态合成了**不透明**灰，而真源是浮在任意底上的 alpha。

**关键耦合（本轮新发现，决定改动不能拆半）**：真源的 54 = `padding 8+8` + 标题 20（16px/normal）+ 预览 18。若只把行高压到 54 而标题仍 13.5/18，算式变成 `8+8+18+18 = 52`，仍差 2；而 `11+11+18+18 = 58` 是我们现在的自洽解。**行高、padding、标题字号/行高必须同批改**，否则 `interRowGap` 会把 verticalPitch 58 顶掉（该项两侧已同值，是整区唯一已经对齐的指标）。

**分组标题 `.bot-group-head` ⇄ Grok `.sand-agents-section__header`**

| 实测项 | Grok | 我方 | 差 |
| --- | --- | --- | --- |
| 容器高 | **30**（padding 8/8/6/8） | 18.84（padding 0 9px，margin 14 0 2） | 构造不同：Grok 把留白放在 padding，我们放在 margin |
| 容器字号/字重 | 13px / 420 | 13px / 500 | 字重 −80 |
| 文字实测 | **12px / 420 / rgba(28,28,28,.68) / lh 16** | 13px / 500 / rgb(172,172,172) / lh 18.85 | −1px、语义 alpha 色 |
| 组数 count | 2 | 2 | 同 |
| 左内缩 | 20（12+8） | 21（12+9） | −1 |

**头像（结构差，不是数值差）**：Grok 的 `.sand-agent-item__avatar` 与内部 disc **都是 `border-radius: 0px` + 透明底 + `overflow: visible`**，真正看到的是 36px 盒内 **153% 缩放的 SVG bot mark（`sand-grok-bot-mark`）**；我方 `.sess-avatar` 是 36×36、`border-radius: 46% 54% 48% 52% / 52% 46% 54% 48%`（有机 blob 裁切）、`overflow: hidden`、**实色底 rgb(24,194,114)** + 白字形。两者外形都「不是正圆」，但机制完全不同：**彩色胶囊 + 首字母** ⇄ **透明线稿标记**。换 accent 不会改变这一层，属独立裁决（§8-8）。

### 4.3 Composer（表由 `node scripts/delta_emit_regions.mjs markdown` 从两份 real-spec 直接生成，不手抄）

| 实测项 | Grok 真源 | 我方现状 | 判定 |
| --- | --- | --- | --- |
| 容器高 height | 44 | 52.5 | 差 |
| 容器宽 width | 728 | 760 | 差 |
| 容器圆角 radius | 22px | 24px | 差 |
| 容器底色 background | rgb(255, 255, 255) | rgb(255, 255, 255) | 同值 |
| 边框宽 borderTopWidth | **0.5px** | 1px | 差 |
| 边框色 borderColor | **rgba(28,28,28,0.12)** | rgb(227,227,227) | 差（实色 vs 墨 alpha） |
| 阴影 boxShadow | `rgba(0,0,0,.05) 0 2px 8px -1px, rgba(0,0,0,.03) 0 1px 2px, rgba(228,228,228,.04) 0 0 0 1px` | `rgba(0,0,0,.04) 0 1px 2px` | 差（真源是三层组合，第三层是假边框） |
| padding | **0px** | 5px 8px 5px 10px | 差 |
| 输入区字号 | 14px | 15px | 差 |
| 输入区色 | rgb(28,28,28) | rgb(26,26,26) | 差（近黑基准 26→28） |
| 输入左内缩 fieldLeftInset | 44.5 | 51 | 差 |
| ＋ 钮尺寸 | **28px** | 36px | 差 |
| ＋ / 麦 / 发送 圆角 | **9999px** | 50% | 同族（都圆，语义不同） |
| ＋ 钮底色 | **rgba(28,28,28,0.06)** | transparent | 差 |
| ＋ 钮描边环 | `rgba(28,28,28,.08) 0 0 0 .5px inset` | none | 差 |
| 麦克风尺寸 | **28px** | 36px | 差 |
| 发送键尺寸 | **28px** | 34px | 差 |
| 发送键底色 | **rgb(28,28,28)** | rgb(124,58,237)（= G-28 紫） | 差（D-1 已裁决改近黑） |
| 发送键字形色 | rgb(252,252,252) | rgb(255,255,255) | 差 |
| 发送键阴影 | **none** | `rgba(0,0,0,.15) 0 2px 6px` | 差（真源无投影） |

**构造差（比数值更重要）**：真源容器 `padding: 0px`、`gap: normal` —— 三枚圆钮是**绝对定位浮在 44px 胶囊内侧**（＋ 在 left 12，输入区从 44.5 起），而我方是 `padding 5/8/5/10` 的 flex 行。所以把我方的 padding 清零之前，单改按钮尺寸不会得到真源的贴合感；`fieldLeftInset 44.5` 也是这个构造的产物，不是独立数值。
**按钮尺寸三连冲突**：真源 28，ui_chrome 现状 34，`scripts/prove_m33_grokchrome.js` 要求 index.html 出现字面 36 —— 三者互斥，W2 重锚时必须把这条门一起改掉（见 §5 与 §8-9）。

### 4.4 消息流（同一命令生成）

| 实测项 | Grok 真源 | 我方现状 | 判定 |
| --- | --- | --- | --- |
| 气泡圆角 radius | 18px | 16px | 差 |
| 用户气泡圆角 | **18px（四角同值）** | `18px 18px 6px`（带尾巴） | 差：真源**不做尾巴** |
| 气泡 padding | **7px 12px** | 14px 18px | 差（我方纵向厚一倍） |
| assistant 气泡底色 | **rgba(28,28,28,0.06)** | rgb(244,244,245) | 差（墨 alpha vs 实色灰卡） |
| assistant 气泡字色 | rgb(28,28,28) | rgb(26,26,26) | 差 |
| **用户气泡底色** | **rgb(28,28,28) 近黑实底** | rgb(236,238,240) 浅灰 | **差（形态反转）** |
| **用户气泡字色** | **rgb(255,255,255)** | rgb(26,26,26) | **差（随底色反转）** |
| 气泡内 0.5px 高光 | `rgba(255,255,255,.16) 0 ±.5px 0 inset` + `rgba(28,28,28,.06) 0 0 0 .5px inset` | none | 差（深底描边全靠这层内高光） |
| 正文字号/字重/行高 | 14px / **420** / 20px（文字叶实测 22） | 15px / 400 / 24px | 差 |
| 作者名字号 | 12px | 12px | 同值 |
| 作者名字重/色 | **420 / rgba(28,28,28,.68)** | 600 / rgb(124,58,237) 紫 | 差 |
| 流内头像尺寸 | **22** | 28px | 差 |
| 流内头像圆角/底色 | **0px / transparent**（153% SVG mark，overflow visible） | 50% / 绿色 alpha 圆 | 差（与 §4.2 头像同一条结构裁决） |
| **文字列 maxWidth** | **558.4px** | 760px | **差 202px —— 整区最大的单一观感变量** |
| 面板宽 paneWidth | 760 | 760 | 同值 |
| 行 left | 296 | 296 | 同值 |
| 行宽 rowWidth | **728** | 760 | 差 |
| 两侧留白 sideMargin | **16** | 0 | 差 |
| 代码块宽 | 534.4 | 692px | 差（随列宽收敛） |
| 代码块圆角 | **0px** | 12px | 差 |
| 代码块底色 | **rgba(0,0,0,0)（没有卡片）** | rgb(244,244,245) | 差：真源代码块**无底无框** |

**读法**：真源的消息区不是「把 760 的列塞满」，而是 **760 面板 → 728 行（两侧各 16）→ 558.4 文字列（≈ 行的 76.7%）** 三层收敛，代码块再随文字列走 534.4。我方三层都是 760，所以同样字号下每行字数多约 36%，这是「看起来不像 Grok」的主因，字号本身只差 1px。
**用户气泡反转**是 D-1（近黑主色）在消息流的直接后果：底色 `#1c1c1c` + 白字 + 0.5px 内高光，浅灰底黑字要整体换掉，不能只改 accent token —— 我方 `--user-bubble` 是浅灰语义值，改名换值都要走 §4.1 的原语层。

### 4.5 底部账户区与弹层（两侧均为 CDP 实测，force-light 1040×760）

**账户弹层 `#account-popup` ⇄ Grok `.ui-menu`**

| 字段 | Grok 实测 | 我方实测 | 差 |
|------|-----------|----------|----|
| 容器尺寸 | 228 × 212.5 | **260 × 421** | 宽 +32，高 +208.5（项多且行更高） |
| 定位 | `absolute`，锚在 (16, 491.5)（贴着账户条上方） | `fixed`，left/right 12、bottom 68，实测 top 271 | 形态不同：Grok 跟随触发元素，我方钉在侧栏底部 |
| 圆角 | **12px** | 10px（`--radius-lg`） | -2 |
| 边框 | **0**（`border-*-width: 0px`） | 1px `rgb(227,227,227)` | 我方多一圈描边 |
| 阴影 | **`none`**（靠 12 圆角 + 白底浮起） | `rgba(0,0,0,.16) 0 12px 32px` | 结构性差：Grok 弹层无阴影 |
| z-index | 10000 | 走 `--z-modal`(60) 阶 | 层级体系不同（我方自有体系，保留） |
| 过渡 | `opacity .1s + transform .1s`，`cubic-bezier(.165,.84,.44,1)` | `opacity/transform .16s` | 时长 +60ms、缓动曲线不同 |
| 段落 | **2 段 / 1 条分隔**（`::before` 0.5px `rgba(28,28,28,.12)`，margin 4px 8px） | **5 段 / 4 条分隔**（1px `rgb(227,227,227)`，margin 4px 6px） | 分段过碎 + 分隔线粗一倍 |
| 行 | 6 项，h **30**，padding `6px 8px`，radius **6**，13px/**420**，gap 4，列表 gap 2 | 10 项，h **34.5**，padding `8px 10px`，radius 8，13px/**400** | 行高 +4.5、内边距 +2/+2、圆角 +2、字重不同 |
| 图标 | **14×14**，`rgba(28,28,28,.66)`；子菜单 chevron 14×14 `rgba(28,28,28,.52)` | 18px 盒子 / 13px 字形，`rgb(111,111,111)`；无 chevron | 图标尺寸与小标题色不同；**我方没有子菜单机制** |

**条目集合差**（Grok 6 项 vs 我方 10 项，实测文本）
- 两侧都有：设置、每周用量、获取移动版、支持、添加账户、退出登录。
- 仅我方 4 项：**管理 Bot / 应用**、**连接应用**、**模板市场**、**发现新版本**。
- Grok 的「每周用量」带副文本 `7% 已用` 且有子菜单（管理用量），「支持」也是子菜单；我方两项都是平铺一行、无副文本。
- 顺序差：Grok 把「设置」放在第一段末尾（第 4 项），账户类操作（添加账户/退出登录）单独成第二段；我方把设置放在第 2 项。

**功能可用性（已由 [scripts/bb_account_popup_audit.mjs](file:///Users/zfl/Downloads/bitbot/scripts/bb_account_popup_audit.mjs) 逐项验证，报告 [account-popup-audit.md](file:///Users/zfl/Downloads/bitbot/docs/design/desktop-target/account-popup-audit.md)，gate/real 两环境 11 项结果逐字节一致；以下每条都回源码复核过）**

| 项 | 用户可见落点 | 判定 | 根因（已复核） |
|----|--------------|------|----------------|
| ap-settings / ap-connect / ap-market | 打开设置·通用 / 连接应用 / 模板市场 | 正常 | — |
| ab-sessions-btn（账户条图标） | 打开 `#sessions-popup`，24 行分组会话 | 正常 | — |
| **ap-manage** | **无反应** | **死控件，需修** | 它只翻转隐藏的 `#grok-adv-toggle`，而 `ui_chrome.css:1122-1127` 把 `:has(#grok-adv-toggle:checked)` 命中的三组元素**恒 `display:none !important`**，`css:1164-1166` 又让 `#sb-bots-rooms` 恒 `block !important`。翻转后 DOM 无变化，且它是唯一不收起弹层的项 |
| **ap-update / ap-usage / ap-add-account** | 设置面板弹开、**停在通用页**、**零反馈** | 落点错 + 反馈不可见，需修 | 渲染层发 `open settings entry=account anchor=…`（`index.html:9638-9641`），但 [hosts/shared/host_ffi.js:5026-5028](file:///Users/zfl/Downloads/bitbot/hosts/shared/host_ffi.js#L5026) 的白名单只收 `sidebar-account-button｜keyboard-shortcut｜command-palette` → 硬编码 CM-1901 拒绝；拒绝回执写进 `#settings-meta`，而 [ui_chrome.css:1388](file:///Users/zfl/Downloads/bitbot/hosts/desktop/ui_chrome.css#L1388) `body.grok-ui #settings-meta{display:none!important}` 把它藏了 |
| ap-mobile / ap-support / ap-signout | 只在 `#log` 追加一条气泡 | 占位待接 | `ap-signout` 读码确认只有 `addMsg` + 收弹层（`index.html:9663-9666`），不登出、不清凭据 |

两点要记进结论：**「refused」不是隔离环境假象**（白名单在源码里硬编码）；**`#log` 的 `settings_open` 气泡是 debug-only、默认不渲染**，所以用户看不到任何回执。

**弹层整理后的目标形态（这就是「功能全部整理」的落点，点头即照此改）**

真源条目实测：段一 `每周用量（带 7% 已用）· 获取移动版 Grok Bot · 支持`，**1 条 `::before` 分隔（200px 宽、0.5px `rgba(28,28,28,.12)`、margin `4px 8px`）**，段二 `设置 · 添加账户 · 退出登录`；6 行 × h30。
我方实测：10 行 × h34.5、**4 条分隔（5 段）**、容器 260×421、radius 10、带 `rgba(0,0,0,.16) 0 12px 32px` 阴影、padding 6、gap 2。

| 我方项 | 处理 | 归入段 | 理由（全部回源码/实测复核） |
| --- | --- | --- | --- |
| ap-settings 设置 | **留**，挪到段二首位 | 段二（账户操作） | 真源段二第一项就是它 |
| ap-usage 每周用量 | **留**，升到段一首项，补「N% 已用」后缀 | 段一 | 真源段一首项；后缀是真源形态的一部分（实测文本 `每周用量7% 已用`） |
| ap-mobile 获取移动版 | **留** 段二 | 段一 | 与真源同位（当前只 `addMsg`，属占位待接，不影响归段） |
| ap-support 支持 | **留** 段一末 | 段一 | 真源有；且真源此项带子菜单 chevron |
| ap-add-account 添加账户 | **留** 段二 | 段二 | 真源有；需先修 6a① 的 `entry=account` 拒绝 |
| ap-signout 退出登录 | **留** 段二末 | 段二 | 真源有（当前不真登出，属功能缺口，另案） |
| ap-connect 连接应用 | **留**，但**升为账户条第二枚胶囊**（§8-4），段一保留同名项 | 段一 | 真源把「连接应用」放在胶囊层；两处同一绑定不会分叉 |
| ap-market 模板市场 | **留** 段一 | 段一 | 真源无此项，但我方实测能打开 —— 功能面差，不是坏按钮 |
| ap-update 发现新版本 | **留** 段一 | 段一 | 同 `ap-connect`：当前被白名单拒绝（6a①），修好后是真功能 |
| **ap-manage 管理 Bot / 应用** | **退役**（默认建议） | — | 唯一无落点的死控件：只翻转隐藏 checkbox，`:has()` 目标恒 `display:none!important`（css:1122-1127）。要留必须先给它真实行为，见 §8-5 |

段数 **5 → 2**、分隔 **4 → 1**；行形态换真源规格（h30 / padding `6px 8px` / r6 / 13px-420 / 图标 14 / chevron `.52`）；容器 **260→228 宽、radius 10→12、去掉阴影、border 换 0.5px 墨 alpha**；进出场动画换 `opacity/transform .1s cubic-bezier(.165,.84,.44,1)`。
**必须说清的偏差**：10 项 × h30 + 1 分隔 ≠ 真源的 212.5 高（约 **330**）。这是「采纳真源形态、保留我方功能面」的有意结果，不是没对齐 —— 若要把高度也压到 212.5，就得砍掉 `ap-manage / ap-market / ap-update / ap-connect` 四项，那属 §8-5 的产品裁决，不该由样式批次顺手做。

**连接应用面板 Grok `.ui-dialog` ⇄ 我方 `#connect-apps-modal .bb-sheet`**（两侧同条件实测）

| 字段 | Grok 实测 | 我方实测 | 差 |
|------|-----------|----------|----|
| 容器 | **800 × 666**，`fixed`，z 10001，radius **14**，border 1px `rgba(28,28,28,.12)`，**shadow none** | 720 × 623.2，`static`（靠 `.bb-modal` 遮罩定位），z auto，radius **16**，border 1px `rgb(232,232,234)`，shadow `rgba(0,0,0,.18) 0 24px 64px` | 尺寸 -80×-42.8；圆角 +2；**我方多一层重阴影**（Grok 全屏弹层也无阴影，靠描边分层） |
| 标题 | 17px/**500**，`rgb(28,28,28)`，h24，宽 734（近乎占满） | 21px/**600**，`rgb(26,26,26)`，h31.5，宽 83.16 | 字号 +4、字重 +100 |
| 关闭 | 28×28，radius **9999**，透明底，`rgba(28,28,28,.66)`，文案「关闭」 | 27.02×36，radius 8，透明底，`rgb(117,117,122)`，文案「关闭」 | 形状：圆形图标钮 vs 方角文字钮 |
| 搜索 | 571.6 × **20**，radius **0**（嵌在通栏分隔里），14px，占位「在应用和技能中搜索」 | 636 × **39**，radius 10，白底有框，占位「搜索插件」 | 我方是独立输入框，Grok 是无框行内搜索 |
| 分类 chips | **7 枚**（全部/密码管理器/效率/通信/设计/代码/**更多**），46–85 × **28**，radius 9999，激活底 `rgb(28,28,28)` 字 `rgb(252,252,252)`，13px/420 | **6 枚**（无「更多」），56–95 × **32.5**，radius 9999，激活底 `rgb(26,26,26)` 字白，13px/**500** | 少 1 枚 + 多 4.5px 高 + 字重不同 |
| 网格 | `.sand-plugins__grid` **758 宽 / 2 列 375px**，gap `2px 8px`，**67 行**，行 259.2 × **40** | grid 686 宽 / 2 列 339px，gap 8px，**2 行真插件 + 1 条空态文案**，行 339 × **167.5** | 行高 40 ⇄ 167.5 —— **卡片形态整体不同**（Grok 是紧凑行，我方是大卡） |
| 分组标题 | **13 段**（为你推荐/密码管理器/效率/…/团队插件），14px/500，h34，`rgb(28,28,28)` | **0 段**（headings 实测为空数组） | 我方完全没有分组结构 |
| 行尾操作 | 「添加」钮 79.8 × **26**，radius **13**，底 `rgba(28,28,28,.06)`，12px/420；已添加标记 53×20 `rgba(28,28,28,.56)` | 只有「卸载」文字链，无 radius/尺寸规范 | 状态表达不同（添加/正在添加/已添加 三态 vs 单态） |
| 顶部辅助 | 「已连接 6 个」预览 164.4×28（12px/420）+「Bot 模板」白胶囊 113.4×32（r9999，0.5px 描边）+ 搜索框右侧图标 | 实测 **absent：installedPreview / botTemplate / viewAll / teamBadges 全 true**（DOM 里不存在） | 我方缺 4 处真源已有的入口 |
| 团队徽章 | 「团队」标签 49×18，11px，底 `rgba(28,28,28,.07)`，r9999，padding `1px 6px 1px 5px` | 无 | 缺 |

**Grok ＋ 菜单实测**：容器 200×74，radius **12**，**shadow none**，`absolute`，仅 **2 项**（添加附件 · paperclip 12px / **教它做一项任务**），项 h30、padding `6px 8px`、r6、13px/420。**我方 ＋ 菜单 3 项**（添加附件/联网搜索/模型）—— 「联网搜索」「模型」是我方功能，Grok 用别的入口；Grok 的「教它做一项任务」我方没有。

**会话行交互态实测**（同选择器语义：Grok `button.sand-agent-item` ⇄ 我方 `.sess-row`）

| 态 | Grok 实测 | 我方实测 |
|----|-----------|----------|
| idle | `rgba(0,0,0,0)` 透明，radius **10**，`box-shadow: none` | 同透明，radius **12** |
| hover | **`rgba(28,28,28,.06)`**（注意：JSON 里 `hover` 采到的节点正好是 `aria-current` 行，其值 .08 是选中态；按同文件 `note` 的三态描述，hover = **.06**） | `color(srgb .101961 .101961 .101961 / .04)` = `rgba(26,26,26,.04)`（**弱 1.5 倍**） |
| 选中 | **`rgba(28,28,28,.08)`（与 hover 同值）**，靠 `aria-current` 标记而非变色 | `rgb(229,229,229)` 实心（≈10% 黑），无 current 语义 |

即：真源的层级是「透明 → 8% → 8% + 语义标记」，我方是「透明 → 4% → 实灰」。选中态改弱底 + `aria-current`，行圆角 12→10。

### 4.6 暗色真值补测（2026-10-24，已授权临时切换，测完已还原「跟随系统」）

真源暗色全量落盘：[reference/grok-real-spec-dark.json](file:///Users/zfl/Downloads/bitbot/docs/design/desktop-target/reference/grok-real-spec-dark.json)（26 键，与浅色同构，可直接进 delta 表）；暗色截图在 `/tmp/grok_ref_dark/`，浅色截图已还原回 `/tmp/grok_ref/`。关键暗色实测值：

| 区 | Grok 暗色实测 |
|---|---|
| 窗体底 windowShell | `rgb(18, 18, 18)` |
| 侧栏底 sidebar | `rgb(14, 14, 14)`（浅色 245 系 → 暗色 14/18 系） |
| 侧栏行选中底 | `rgba(245, 245, 245, 0.08)` —— 墨色 alpha 机制不变，基色从墨换成纸 |
| 行主文字 / 预览 | `rgb(245,245,245)` / `rgba(245,245,245,.66)`（alpha 比例与浅色一致） |
| 分隔线 | `rgba(245, 245, 245, 0.06)` |
| 用户气泡 | `rgb(14, 159, 90)` 绿底 —— **暗色不是近黑**，W5 需按主题分支 |
| sand 变量组 | `--sand-bg-primary:#f5f5f5` 等：暗色下 sand 系整体反相 |

含义：`body.force-dark` 侧在 W1-W5 每一步都必须对照这份文件，不能拿浅色真值线性外推。主题入口已探明：设置 → 通用 → 外观 → 主题（`ui-select`，跟随系统/浅色/深色）。

---

## 5. 门与文档重写清单（必须与改动同批）

| 文件:行 | 现在写死 | 改成 |
|---------|----------|------|
| [scripts/e2e_grok_desktop_spec.mjs:34-35](file:///Users/zfl/Downloads/bitbot/scripts/e2e_grok_desktop_spec.mjs#L34) | `ACCENT_LIGHT rgb(124,58,237)` / `ACCENT_DARK rgb(168,85,247)` | 从 `grok-real-spec.json` 读 `sendButton.backgroundColor`，不再手写常量 |
| 同文件 A1/A2/A9 | 断言紫 | 断言 = 真源 `#1c1c1c`；A9 作者名由 accent 改 12px/420 灰 |
| 同文件 A4 | `send` 34px + 50% | 28px + 9999 |
| 同文件 A5 | composer radius ≥ 20 | `=== 22`（消灭 css:1798 的 24 硬写） |
| 同文件 A10 | bubble radius `=== 16` | `=== 18`，并新增「用户气泡深底白字」「inset 高光存在」两条 |
| 同文件 S3 | 行高 56–62 | 52–56（真源 54）；S2 头像区间保持 34–40 |
| [scripts/prove_m33_grokchrome.js:91-92](file:///Users/zfl/Downloads/bitbot/scripts/prove_m33_grokchrome.js#L91) | 要求 index.html 里字面 `#composer #send{width:36px…}` | 改为 28px；或让该门不再做源码字面匹配（它和渲染层实际值本来就打架，是 css `!important` 34px 的来源） |
| [scripts/smoke_grok_desktop_parity.sh:1296](file:///Users/zfl/Downloads/bitbot/scripts/smoke_grok_desktop_parity.sh#L1296) | grep 文案「Composer 发送按钮：36px 圆形」 | 与上一行同步；780 的 assistant bubble 合同文案同步 |
| [scripts/prove_ui_tokens.js:44](file:///Users/zfl/Downloads/bitbot/scripts/prove_ui_tokens.js#L44) | `sidebarW 280px` 钉死 | 保留（真源也是 280）；字号白名单加 12/16、`--radius-bubble` 值变化同步 |
| [docs/design/desktop-target/ui-unified-spec.md:§2.1](file:///Users/zfl/Downloads/bitbot/docs/design/desktop-target/ui-unified-spec.md) | accent 权威值 `#7c3aed`、禁 11/12px | 按真源改写；并声明真源文件为唯一基准 |
| [docs/design/desktop-target/layout-contract.md:§3](file:///Users/zfl/Downloads/bitbot/docs/design/desktop-target/layout-contract.md) | 行高/圆角合同值 | 按真源改写，与门容差一致 |
| [replica/design/tokens.css](file:///Users/zfl/Downloads/bitbot/replica/design/tokens.css) · tokens.json | `--accent:#1a1a1a`（第三套值） | 删除或指向真源，避免再次互相打架 |

**当前门禁基线（本轮重新实跑，不是引用旧数字）**：`node scripts/prove_ui_tokens.js` → PASS=8 FAIL=0，`!important 189 ≤ 189`、`css hex 139 ≤ 139`、`html hex 28 ≤ 28`、`行内 font-size 23 ≤ 24`、`[style*=] 5 ≤ 5`。注意 139 是「去掉注释后」的口径（文件文本实测 142，差 3 个在注释里）。W0 之后 css hex 基线应下调到 **67**（实跑口径，见 §4.1），这 72 槽即为四区换色/换几何的预算。

---

## 6. 复现命令（对照稿的每一格都能重跑）

```bash
# 1) Grok 侧真源（需本机已装 Grok Bot.app，且带 CDP 启动）
env -u ELECTRON_RUN_AS_NODE "/Applications/Grok Bot.app/Contents/MacOS/Grok Bot" \
  --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=9224
node scripts/grok_real_spec_capture.mjs      # → reference/grok-real-spec.json

# 2) 我方侧同量纲实测（1040×760 浅色）
node scripts/bb_spec_capture.mjs             # → reference/bb-real-spec.json

# 3) 差量表面板（§4.2 / §4.3 / §4.4 三张表就是它打的，不手抄）
node scripts/delta_emit_regions.mjs markdown

# 3b) 全字段交叉差量表（同值 / 差值 / 仅真源 / 仅我方 四桶计数）
node scripts/grok_delta_report.mjs           # → alignment-delta-tables.md

# 3c) 验收期望值（所有断言取自 grok-real-spec.json，禁止手打常量）
node scripts/grok_acceptance_expectations.mjs --write   # → reference/grok-acceptance-expectations.json

# 3d) W0 的三重证明（去重是否真的零变化）
node scripts/w0_palette_consolidate.mjs       # 生成 /tmp/w0a.css + w0b.css
node scripts/w0_prove_token_equiv.mjs         # 主证：6 种主题场景 × 81 token 级联求解，期望 0 差异
node scripts/w0_control_injection_check.mjs   # 反向对照：证明注入通道有效（防止「0 差异」是假绿）
node scripts/prove_w0_no_visual_change.mjs    # 交叉验证：127 个可见元素 resolved 样式指纹

# 4) 门
node scripts/e2e_grok_desktop_spec.mjs
node scripts/prove_ui_tokens.js
node scripts/prove_m33_grokchrome.js
```

---

## 7. 落地顺序（点头后）

1. **W0 收敛重复调色块**（P2 前置，只为腾 ratchet 预算，视觉零变化 —— **已证，见下两种独立证法**）
   - **证法 A（确定性级联求解，主证）**：`node scripts/w0_prove_token_equiv.mjs` 把 5 个调色块 + 生成物读成变量表，按真实 CSS 优先级（`force-*` 类 (0,1,1) > 匹配的 `@media :root` > `:root`）在 **6 种主题场景**下逐 token 递归展开 `var()` 到字面量，比较「仅源码」vs「源码 + 0a」：
     **486 条 (token × 场景) 比较，差异 0 条** → 0a 是纯去重，可落地。块内硬编码色值 **115 → 43**，腾出 **72** 个 ratchet 额度。
   - **证法 B（真渲染交叉验证）**：`node scripts/prove_w0_no_visual_change.mjs` 起一个隔离临时 profile 的宿主，注入生成物后对 **127 个可见元素**采 resolved 计算样式指纹（背景/前景/边框/阴影/圆角/渐变/描边 7 项），亮暗两色主题下 **0a 差异 0 条 ✓**。
   - **上一版工具的判决是假的**：它用「全局序号 + 截图逐字节相等」当判据 —— 活宿主会在两次采样之间插入会话行与日志气泡，序号 key 集体错位成「元素消失」，而光标闪烁/计时器让截图永远不可能逐字节相同。现在 key 换成 `tag:nth-of-type` 路径、采样前先 `quiesce()` 等 DOM 静置、截图降级为「仅供肉眼复核」，判决只看 resolved 样式。
   - 0b **折掉第二套 token 家族**（本轮新发现）。`body.grok-ui` 在 css:1224-1256 另立 `--text-ink / --text-sub / --ui-border / --ui-fill / --ui-card / --ui-pill` 六个色，再经 `--g-*` 别名转发，实际消费点 39 处（`--g-ink` 18、`--g-sub` 7、`--g-line` 6、`--g-card` 5、`--g-soft` 2、`--g-pill` 1；`--ui-*` 与 `--text-ink/--text-sub` 各只被别名自己消费 1 次）。这套色与 `:root` 同一语义但数字不同：`--text-ink #1a1a1a` vs `--text #141414`、`--text-sub #75757a` vs `--muted #6f6f6f`、`--ui-border #e8e8ea` vs `--line #e3e3e3`、`--ui-pill #ebebee` vs `--user-bubble #eceef0`。
     **但 0b 的口径本轮被实测修正**：真渲染交叉验证里注入 0b 后 **差异 0 条** —— 因为上面那些分歧数字只存在于 `:root` 兜底块，而宿主实际生效的是 `force-light`/`force-dark`/`@media` 块，两侧在这些块里数值相同。结论：**0b 不是「必须做否则只对齐一半」，而是「清理死值」**；`--ui-*`/`--g-*` 仍然该折（它们让 W1 换色要改 7 份而非 2 份），但它不阻塞 W1。
     折法：删 `--ui-*` 与 `--text-ink/--text-sub`，`--g-*` 直接指到 `:root` 规范 token。
2. **W1 Token 换值**（§4.1，一次改定 accent + 色板 + 圆角阶 + 字阶白名单）
   - accent 实测拼写：**10 处声明**分布在 5 个调色块里 —— `--accent` 亮 `#7c3aed` @css:34/130/232、暗 `#a855f7` @css:165/199；`--accent-soft` 亮 `#f3e8fd` @css:36/132/234、暗 `#3b0764` @css:167/201。另有 1 处门常量 [scripts/e2e_grok_desktop_spec.mjs:34](file:///Users/zfl/Downloads/bitbot/scripts/e2e_grok_desktop_spec.mjs#L34)。`index.html` 无紫色拼写（已 grep 确认）。
   - 这正是 W0 必须先行的原因：0a+0b 之后 accent 只剩 **2 个原语**（`--p-lt-accent` / `--p-dk-accent`）+ soft 2 个，W1 改 **4 行**即可全局换色；不做 W0 就要改 10 处、漏一处即串色。
3. **W2 门重锚到 json**（§5，先让门红，再修绿）
4. **W3–W5 三区几何**：侧栏会话区 / composer / 消息流（各区互不重叠，逐区截图验收）
   - **W3 侧栏会话区**（值全部来自 §4.2）：行 58→**54**、gap 0→**4**、圆角 12→**10**、padding `11 9 11 6`→**8 四面**、列 gap 11→**8**、标题 13.5/600→**16/420**、预览字重 400→**420** 且色改 `rgba(28,28,28,.68)`、分组标题带 18.8→**30**（padding `8 8 6 8`，margin 归零）、分组文字 13/500→**12/420**、三态走 `--nav-row-hover/active` 两行 token（4%→6%、`var(--side)`→`transparent`）。
     **不可拆的耦合**：54 = 8+8+标题20(16px/normal)+预览18。只压行高不改字号会得到 52，pitch 58（两侧唯一已同值的指标）反而被破坏 —— 所以 W3 内部必须先换字阶（依赖 §8-2 的 420/字体栈裁决），再压行高。
   - **W4 composer**（§4.3）：胶囊 52.5→**44** 高、radius 24→**22**、border 1px→**0.5px** 且色改 `rgba(28,28,28,.12)`、阴影换真源三层组合、padding 清零 + 按钮改绝对定位（这是构造差，不是数值差）、三枚圆钮 36/36/34→**28/28/28**、＋ 钮加 `rgba(28,28,28,.06)` 底 + 0.5px inset 环、发送键去投影、底色随 W1 变近黑。
   - **W5 消息流**（§4.4）：**先收列宽再改样式** —— 行 760→728（两侧各 16）、文字列 760→**558.4**、代码块随列走 534.4；气泡 radius→18、padding 14/18→**7/12**、assistant 底改 `rgba(28,28,28,.06)`、用户气泡反转成 `rgb(28,28,28)` 底 + 白字 + 三层 inset 高光、四角同 18（去掉 6px 尾巴）、正文 15/400/24→**14/420/20**、作者名 600 紫→**420 灰**。代码块「无底无框 radius 0」是与真源最大的一处观感反转，见 §8-9。
5. **W6 底部账户区与弹层**（含结构差：是否把「连接应用」提为底部独立胶囊）
   - 6a **修 3 个失效落点**（不依赖换色，可最先做）：① `entry=account` 改发 `sidebar-account-button` 或给 [host_ffi.js:5026](file:///Users/zfl/Downloads/bitbot/hosts/shared/host_ffi.js#L5026) 白名单加 `account`，让 ap-update/ap-usage/ap-add-account 真正跳到对应 anchor；② `ui_chrome.css:1388` 的 `#settings-meta{display:none!important}` 改成「成功态隐藏、拒绝态可见」，回执不再被吞；③ `ap-manage` 要么接到 `#sb-bots-rooms` 的真实展开逻辑，要么整项退役（当前是死控件）。
   - 6b **弹层对齐真源形态**：228 宽 / radius 12 / 无边框无阴影 / 2 段 1 分隔（0.5px）/ 行 30、padding `6px 8px`、r6、13px/420 / 图标 14 / 子菜单 chevron；我方现有 10 项里的 4 项（管理、连接应用、模板市场、发现新版本）Grok 没有 —— 保留与否属产品裁决，见 §8。
   - 6c **连接应用面板**：Grok 是 800×666 无阴影 fixed dialog + 13 段分组 + 40px 紧凑行 + 三态「添加」钮 + 团队徽章；我方是 720×623 带 64px 大阴影的 sheet + 0 分组 + 167.5px 大卡。这区改动量大，建议排在几何三区之后。
6. **W7 文档同步**（spec / layout-contract / replica tokens 三处真源合一）

每批之间跑 `node scripts/bb_spec_capture.mjs && node scripts/grok_delta_report.mjs`，差量表应收窄到 0 行。

---

## 附录 A：建议落地的 token 单一源（点头即照此改）

### A.1 先把 4 份重复调色收敛成「原语 + 映射」两层

现状问题（实测）：`ui_chrome.css` 的 115/142 个硬编码色值分布在 5 个调色块（`:14-117`、`119-151`、`152-186`、`187-219`、`220-252`），同一套浅色被抄 3 遍、暗色被抄 2 遍，且 4 个主题块之间**零漂移**（24 个共享变量逐字相同，已用脚本逐个比对）。改色必须 5 处齐改，漏一处就是主题串色。

做法：色值只在 `--p-*`（原语）里出现一次，主题块只做 `var()` 映射、**不含任何字面色值**。

```css
:root {
  color-scheme: light;

  /* 原语：每个色值全仓只出现这一次。light 组来自 Grok 真源实测。 */
  --p-lt-bg: #fcfcfc;          /* Grok windowShell */
  --p-lt-side: #f5f5f5;        /* Grok sidebar */
  --p-lt-surface: #ffffff;     /* Grok composer pill / account pill */
  --p-lt-ink: #1c1c1c;         /* --sand-text-primary */
  --p-lt-muted: rgba(28, 28, 28, 0.68);   /* --sand-text-secondary */
  --p-lt-line: rgba(28, 28, 28, 0.08);    /* 分隔线，配合 0.5px 描边 */
  --p-lt-line-strong: rgba(28, 28, 28, 0.12); /* composer 边框 */
  --p-lt-fill: rgba(28, 28, 28, 0.06);    /* --sand-bg-secondary */
  --p-lt-accent: #1c1c1c;      /* --sand-bg-primary，D-1 裁决 */
  --p-lt-on-accent: #fcfcfc;
  --p-lt-unread: #0b6dd3;
  --p-lt-online: #14c16f;

  /* 暗色原语：⚠️ Grok 暗色态尚未实测（见 §8 待补），先保持现值，
     实测回来后只改这一组，其它地方一律不动。 */
  --p-dk-bg: #151515;
  --p-dk-side: #111111;
  --p-dk-surface: #1f1f1f;
  --p-dk-ink: #ececec;
  --p-dk-muted: #9a9a9a;
  --p-dk-line: #2e2e2e;
  --p-dk-fill: #2a2a2a;
  --p-dk-accent: #a855f7;      /* 待真源替换 */
  --p-dk-on-accent: #ffffff;

  /* 语义层：默认取 light 原语 */
  --bg: var(--p-lt-bg);
  --bg-elev: var(--p-lt-surface);
  --side: var(--p-lt-side);
  --surface: var(--p-lt-surface);
  --text: var(--p-lt-ink);
  --ink: var(--p-lt-ink);
  --text-muted: var(--p-lt-muted);
  --muted: var(--p-lt-muted);
  --border: var(--p-lt-line);
  --line: var(--p-lt-line);
  --fill: var(--p-lt-fill);
  --accent: var(--p-lt-accent);
  --accent-ink: var(--p-lt-on-accent);
  --unread: var(--p-lt-unread);
  --bubble-bot: var(--p-lt-fill);
  --bubble-user: var(--p-lt-accent);
  --hairline: 0.5px;           /* 真源分隔线/描边一律 0.5px */

  /* 几何与阶（真源值） */
  --sidebar-w: 280px;          /* 真源实测 280，与合同一致，不动 */
  --content-max: 760px;        /* 真源聊天面板 760 */
  --stream-side: 16px;         /* 真源行两侧各留 16 → 行宽 728 */
  --bubble-max: 76.7%;         /* 真源 558.4 / 728 */
  --r-row: 10px;               /* 真源会话行圆角 */
  --r-control: 10px;
  --r-bubble: 18px;            /* 真源气泡（取代现 16） */
  --r-composer: 22px;          /* 真源 pill（消灭 css:1798 的 24 硬写） */
  --r-pill: 9999px;
  --fs-label: 12px;            /* 真源分组标题 / 作者名 */
  --fs-meta: 13px;             /* 真源行预览 / 菜单项 */
  --fs-body: 14px;             /* 真源正文、composer，行高 20px */
  --fs-row-title: 16px;        /* 真源会话行标题 */
  --fw-regular: 420;           /* 真源全站 420，见 §8 待裁决 */
  --sh-pop: 0 2px 8px -1px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03); /* 真源 pill 阴影 */
}

/* 暗色只做映射，零字面色值 */
@media (prefers-color-scheme: dark) { :root:not(.force-light) { --bg: var(--p-dk-bg); /* …逐条映射… */ } }
body.force-dark  { --bg: var(--p-dk-bg); /* …同一份映射… */ }
body.force-light { /* 无需任何声明：:root 默认即 light */ }
```

净效果：`force-light` 整块删除，`force-dark` 与 media-dark 变成无字面量的映射；css hex 从 **142 降到 56**（实测预测：44 个原语 + 6 个 root 非主题色 + 6 个 `:1239` 暗色补充块），一次腾出 **86** 个 ratchet 预算槽，供后续四区改动消费（`prove_ui_tokens` 的基线数字随之下调，并把「调色块内不得出现非 `--p-*` 字面色值」升级为硬规则）。

### A.2 逐区规则改动（值全部来自 §3 实测）

| 区 | 改哪条规则 | 从 → 到 |
|----|-----------|---------|
| 侧栏行 | `index.html:656-671` + `ui_chrome.css:2058` 双写的 padding | 统一为 `8px`、`gap 8`、行高 54、圆角 `var(--r-row)`，删掉两处并存 |
| 侧栏行文字 | `ui_chrome.css:2061-2062`（13.5px/13px 硬写） | 标题 `var(--fs-row-title)`、预览 `var(--fs-meta)/20px` 走 `var(--text-muted)` |
| 分组标题 | `ui_chrome.css:2006-2017`（13px/500） | `var(--fs-label)`、`var(--fw-regular)`、`var(--text-muted)` |
| 侧栏分隔 | `#agents` 右边框 | `var(--hairline) solid var(--border)` |
| Composer | `ui_chrome.css:1791-1800`（radius 24 硬写） | `var(--r-composer)`=22、高 44、`var(--hairline) solid var(--p-lt-line-strong)`、阴影 `var(--sh-pop)` |
| 三枚圆钮 | `#send` `ui_chrome.css:1189-1199`（34px !important）/ `index.html:1212-1217`（36px） | 统一 **28px**、`var(--r-pill)`；＋/麦底 `var(--fill)` + `0.5px` inset 环、图标 `rgba(28,28,28,.56)`；发送底 `var(--accent)`、空态/有字态分离 |
| 气泡 | `index.html:942-953`（radius 16、padding 14/18） | `var(--r-bubble)`=18、padding `7px 12px`、无边框、加 0.5px inset 高光三件套 |
| 用户气泡 | `--user-bubble` 浅灰 | `var(--accent)` 近黑 + `var(--accent-ink)` 白字 |
| 作者名/头像 | `index.html:957-967`（28px 圆 + 紫名 600） | 名字 `var(--fs-label)/var(--fw-regular)` + **按作者着色**；流内头像 **22px**、形状走 blob（与侧栏同源 SVG，不再 `border-radius: 50%`） |
| 消息列 | `#log` `ui_chrome.css:961`（760 硬写 !important） | 面板 760、行 = `100% - 2*var(--stream-side)`、气泡 `max-width: var(--bubble-max)` |
| 底部条 | `ui_chrome.css:2092-2117`（胶囊 min-height 44、头像 32） | 条高 52、胶囊 **36** 高、`var(--r-pill)`、无边无阴影、邮箱 `var(--fs-body)/500`；「连接应用」是否提为独立胶囊见 §4.5 |
| 账户弹层 | `index.html:552-618`（radius 10、项高 35、图标 13px 灰） | 等 §4.5 Grok 实测落表后一次改 |

---

## 8. 待补 / 待裁决

> **2026-10-24 裁决回填**：① 按本稿全量 W0→W7 开工；③ 暗色已补测（§4.6）；④ 字重 420 + 字体栈首项 `-apple-system`（跟真源）；⑨ 消息列宽取**完全跟真源 558.4**。以下原文保留供追溯。

1. **Grok 暗色态未实测**：本轮只取了浅色（切主题会改用户 app 设置）。`--p-dk-*` 目前是旧值占位，A.1 落地后暗色仍是旧的 —— 需要一次「临时切 Grok 到暗色、取完切回」的实测。**要你点头**才动 Grok 的外观设置。
2. **`--fw-regular: 420`**：真源全站用 420（可变态字重）。我们的字体栈首选 `Source Han Sans SC`，未必有 420 这一档，浏览器会就近取整。要么接受渲染成 400，要么把字体栈首项换成 `-apple-system`（真源即如此）。**建议**：换字体栈 + 保留 420。
3. **两处结构差是否本轮动**：① 流内头像挂气泡左下（§3.5-2）；② 顶部浮起团队胶囊取代通栏 header（§3.5-5）。这两条不是数值改，要动 DOM 与 `--header-h` 合同，建议单列批次。
4. **底部「连接应用」独立胶囊**（§3.5-7）：Grok 实测确实存在第二枚白底胶囊（68×36，r9999）。我方把它收在弹层第 3 项，且 `ap-connect` 实测功能正常 —— 所以这是纯信息架构裁决，不是 bug。**建议**：提到账户条第二枚胶囊，弹层内保留同名项（两处同一绑定，不会分叉）。
5. **弹层里 Grok 没有的 4 项怎么处理**（实测条目集见 §4.5）：管理 Bot/应用（**死控件**）、连接应用、模板市场、发现新版本。**建议**：`ap-manage` 先按 6a③ 修或退役；其余 3 项保留 —— 它们是我方真实功能面（连接应用与模板市场实测都能打开），Grok 没这项不等于该砍。
6. **连接应用面板改到多大程度**（§4.5 末表）：完全对齐要重建 sheet→dialog、加 13 段分组、把 167.5px 大卡压成 40px 行、补三态「添加」与团队徽章。这已超出「样式对齐」，是功能面重写。**建议**：本轮只做容器（去大阴影、radius 14、border 0.5px 语义、标题 17/500、关闭改圆钮、chip 高 28、行高与分组），大卡→紧凑行留单独批次。
7. **`#settings-meta` 拒绝回执隐藏规则**（`ui_chrome.css:1388`）：这是「弹层点了没反应」的真正原因之一。改成拒绝态可见会露出一句灰字，属可见行为变化，需要你确认口径（**建议**：只在 `settings-refused` 时显示，文案走 `--warn-ink`）。
8. **头像机制是两套东西，不是数值差**（§4.2 末表）：真源侧栏与流内头像都是 **`border-radius: 0` + 透明底容器，内部放 153% 缩放的 SVG bot mark（`sand-grok-bot-mark`，`overflow: visible`）**；我方是 36px（流内 28px）**彩色实底胶囊 + 白字形**，侧栏还带有机 blob 圆角 `46% 54% 48% 52% / …`。换 accent 完全不会触及这一层 —— 要对齐就得设计一枚我方自己的 SVG mark 并保持「透明底 + 溢出」构造。**建议**：单列批次；W1–W5 落地后视觉已能同族，本轮强行改需要新图形，超出「样式对齐」。
9. **消息列宽 760 → 558.4（−202px）与代码块去卡片化**：整区最大的单一观感变量（同字号每行字数少约 27%），也是「一眼像不像 Grok」的主因；真源代码块 **radius 0 / 无底 / 无框**，我方是 12px 灰卡。两条都属「改了就不能回头」的版式决定，且 `--content-max` 参与 layout-contract 的字符串比对（§5）。**建议**：W5 照真源收。**要哪一档**：完全跟真源 558.4 / 折中 640 / 保持 760 只改样式。
10. **发送键尺寸三门互斥**（§4.3 末）：真源 28、ui_chrome 现状 34、`prove_m33_grokchrome.js` 要求 index.html 出现字面 36。W2 重锚时这条门必须一起改，否则改完一定红。**建议**：取真源 28，并把该门从「字面文本比对」改成读 `grok-acceptance-expectations.json`。


