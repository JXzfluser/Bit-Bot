# Bit Bot 桌面 · 待完善清单

> 基线：`1da8cdb`（Grok 视觉对照 v1 + C1/C4/C6 已提交）。
> 状态前缀：**[P0]** 阻塞"像不像/可信不可信"，**[P1]** 明显功能缺口，**[P2]** 体感与工程债。
> 每条都带证据位置与验收标准，不写"优化体验"这种没法验收的话。

## 一、已收敛（本轮确认完成，不再重复列）

| 能力 | 证据 |
|------|------|
| Markdown 渲染（标题/列表/表格/链接/围栏代码 + 复制） | `index.html` `renderMarkdownBody` + `vendor/marked`，GP-93 门禁 |
| 来源引用列表 | `bb-cite-item`（主机名 + 标题，走 openExternal 审计） |
| 重生成 | hover 工具条 `regenerate` → `messages.regenerate`，幂等原地替换 |
| 联网搜索开关 | composer chip → `turn.search` → Host 真搜，缺 key 如实降级 |
| 复制 / 反应 | M38 / M31 |
| 侧栏列表形状 | 按 `replica/screens/grok-composer.png` 像素测量重做（行高 58、内缩 12px 圆角色带、32px 图标、15/13 字号） |
| 样式单一真源 | 每个面一处声明，`!important` 346 → 189，门禁棘轮只降不升（现 180） |
| 代码块语法高亮（P1-1） | `vendor/highlight.min.js` 11.9（js/ts/py/java/go/sql/json/bash）+ `vendor/highlight-theme.css` 独立浅/深主题；`decorateCodeblock` 在 DOMPurify 之后 best-effort 上色；主题色不进 `ui_chrome.css`，避开 hex 棘轮 |
| 会话未读汇总（P1-6） | `#sessions-popup` 顶部 `#unread-summary`（文案 `sessUnreadMore`，三语）；`renderUnreadMarks` 联动；点击走 `jumpToOldestUnread` → `activateSessionById` |
| 未读落盘 + 行点击清未读（P2-7） | `persistUnread()` 整键覆盖 `settings.unread`（空表落 `{}`，不留 `sid:0`）；`restoreUnread()` 在 `refreshSessions()` 之后回填一次（`unreadRestored` 闸，防 settings-changed 覆盖内存）；行点击改走 `activateSessionById()`，不再"重画糊掉计数"；门禁 U-06/U-07 真关重开验证 |

## 二、[P0] 两个决定性问题（需要产品拍板，代码层面 1 小时内可落）

### P0-1 主色到底是蓝还是黑 —— **已闭环（决策 D-1：近黑）**

> **2026-10-31 收口**：定成「浅色 = 近黑 `#1c1c1c`、暗色反白 `#f5f5f5`」，依据是 Grok 实测
> `sendButton` / `--sand-bg-primary`，注释在 `ui_chrome.css:33`。四个模式块（默认 / light
> media / dark media / 显式 dark）都已收敛到 `--p-*-accent`，不再有 `:129` 那处蓝黑互斥。
> `prove_ui_tokens` 现 PASS=9 FAIL=0。下面保留原始描述作为决策依据。

- **现状**：`ui_chrome.css:33` 的 `:root` 写 `--accent: #1e86fc`（蓝），但
  `@media (prefers-color-scheme: light)` 在 `:129` 又把它改成 `#1a1a1a`（黑），
  `--accent-soft` 同步变 `#f0f0f0`。产品实际渲染是**全黑白**，而参考图
  （`replica/screens/grok-composer.png`）主色是蓝。
- **影响面**：发送键、链接、chip 激活态、选中行强调、按钮 hover —— 所有"该有颜色"的地方。
  这也让"复刻 Grok"在观感上永远差一截，且不是布局问题。
- **为什么没直接改**：去品牌化可能是刻意选择（避免撞色/版权），必须产品定。
- **验收**：定成一个值；链接 / 发送键 / chip 激活 / 焦点环四处统一；
  截图与参考图并排无色偏；`prove_ui_tokens` 仍 PASS=8。

### P0-2 真实 provider 没有验证过

- **现状**：`hosts/desktop/.env.local` 指向已死的 mock
  （`BITBOT_LLM_BASE_URL=http://127.0.0.1:8793/v1`、`BITBOT_LLM_MODEL=e2e-stub`），
  8793 与 15721 都没有监听。所有"真实回合"验证都是用 e2e stub 跑的。
- **风险**：stub 与真实 provider 的差异（流式分片、usage 字段、错误码、超时）从未暴露。
- **验收**：指向可用 provider，跑 3 类回合（普通问答 / 长回复流式 / 报错重试），
  `data/llm-usage.json` 有真实 tokens 记录，错误路径在 UI 上如实显示而不是空白气泡。

## 三、[P1] 功能缺口

| # | 缺口 | 证据 / 定位 | 验收标准 |
|---|------|-------------|----------|
| P1-2 | 没有推理档（Think / 深度模式） | `features.csv` 该行 `no`，无档位字段 | composer 内可切"快/深"，随回合下发；Host 侧透传到 provider |
| P1-3 | 语音对话入口被隐藏 | `body.grok-ui #voicechat-btn { display:none }`；依赖外部二进制 | 二选一：要么接可用的 STT 并恢复按钮，要么在设置里说明"本平台不支持"并彻底移除入口（不留死按钮） |
| P1-4 | 消息内联编辑入口不在气泡上 | `#tool-edit-message` 已接线，但不在 hover 工具条 | 气泡 hover 出现"编辑"，就地改完重发，旧回复标记为已替换 |
| P1-5 | 附件预览不分类型 | GP-90 文件卡 + 全屏查看 | 图片走灯箱、PDF 内嵌翻页、代码高亮只读、其余给下载；都可 Esc 退出 |
| P1-7 | 侧栏账户行缺参考图的两个圆钮（应用网格 / 上传云） | 参考图底部是 `[头像][名称…][▦][☁]` | 两个 32px 圆钮，功能分别接"连接应用"和"上传到云端"（已有 IPC 就复用） |
| P1-8 | 侧栏 IA 与参考图结构不同 | 我们是「Bot 列表 / 群组 / 会话」三段；Grok 是单一会话列表 + `bitbot` 分组标签 | 产品决定：保留三段（则补一致的折叠记忆）或合并成单列表 + 分组。**不建议现状长期挂着——三段各自有一套标题，是最容易再次走样的地方** |

## 四、[P2] 体感与工程债

| # | 项 | 说明 | 验收 |
|---|----|------|------|
| P2-1 | 3 个 e2e 在 macOS 恒 SKIP | `layout_target` / `user_journeys` / `modal_computed` 需要 `DISPLAY` 或 xvfb | Linux CI 上全绿，且不再打印假 SKIP |
| P2-2 | 没有 CI | 33 个 `prove_*` + 6 个 e2e 全在本机手跑 | 一条 `npm run gate` 串起来，PR 上必须绿 |
| P2-3 | 视觉回归靠人眼 | 现在只有源码级 lint + 行为断言，没有像素比对 | 把 `replica/screens/` 当基线，对侧栏/输入框/气泡三个区域做分区像素差（阈值放宽到抗字体渲染差异），进 CI 报警不阻塞 |
| P2-4 | `index.html` 单文件约 1.2 万行 | 样式 / 脚本 / 三语词典混在一起，这正是"轮次覆盖"能累积的土壤 | 拆成 `styles.css` / `i18n.js` / `app.js`（含 index.html 只留结构），拆完门禁正则同步改 |
| P2-5 | `--nav-*` 只挂在 `body.grok-ui` | 当前安全（`<body class="grok-ui">` 是静态的） | 若将来加第二套皮肤，把这三个变量提到 `:root` 的分主题块里 |
| P2-6 | 侧栏行没有 hover 上下文菜单 | 只能右键（`showSessionMenu`） | hover 出现 `…`，与右键同一份菜单；键盘可达 |

## 五、建议的下一步顺序

1. **P0-1 + P0-2**（1~2 天）：P0-1 已闭环（D-1 近黑）；**P0-2 仍开着**，不定它后面所有"真实回合"验证都建在 stub 上。
2. **P1-8 侧栏 IA**（1 天）：结构定了，样式才不会反复改。
3. ~~**P1-1 代码高亮 + P1-6 未读汇总**~~ → **已完成**（详见 §一）。
4. **P2-2 CI**（0.5 天）：趁门禁还是全绿，把闸门先装上，后面才有人兜底。
5. ~~**P2-7 未读持久化**~~ → **已完成**（P1-6 落地的同一批，详见 §一）。
6. 其余按 P1 → P2 排。
