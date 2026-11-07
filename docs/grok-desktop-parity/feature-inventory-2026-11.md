# Grok Bot 功能面清点（2026-11-07）

> 口径：**证据来自本机安装包本身**，不是猜界面。方法：`npx @electron/asar extract`
> 解 `/Applications/Grok Bot.app/Contents/Resources/app.asar`（Electron + anysphere
> `sand` 壳，bundle id `com.anysphere.sand`，asar 53MB，`dist/renderer/assets/` 下
> 641 个 js、5 个 css），从 `index.eager-common-*.js` 抽出 **2701 条 message 条目**，
> 其中 **1850 条是纯英文文案**（hash key → 文案数组）。每条文案就是真机的一个可见
> 状态；再与 `docs/grok-desktop-parity/gaps.md` 的 GP 表、`hosts/desktop` 实际接线
> 逐条对账。文案命中数只能说明「这块界面有多厚」，不能说明功能一定对等 ——
> 所以每条都注明我方证据（GP 编号或文件位置）。

## 一、覆盖面（按文案密度排序）

| 功能域 | 真机文案量 | 我方现状 | 结论 |
| --- | --- | --- | --- |
| 电脑操作（computer / takeover / screen） | 79 | GP-30…36 已实现 | 对等（真实 cookie/云 VM 仍是残留口径） |
| 更新与日志（update / logs） | 64 | 有更新检查与日志导出 | 对等 |
| 分享与协作（share / invite / workspace） | 60 | 账户/团队面板部分有；共享 Bot、邀请链接未做 | **部分** |
| Slack 分发 | 57 | 未做（需外部服务与管理员审批） | 残留 |
| 技能 / 插件（skill / plugin） | 45 + 42 | GP-135 三来源去重已实现 | 对等 |
| Teams 分发 | 38 | 未做（同上） | 残留 |
| 任务（routine） | 23 | GP-108…110、M22 已实现（草稿 → 执行） | 对等（**归档视图未做**） |
| 用量（usage / credits） | 19 + 3 | 每周用量面板已实现 | 对等（真实账单在云端） |
| 审批（approval） | 18 | GP-20…25 已实现 | 对等 |
| 语音（voice / call） | 17 + 15 | 录音 + 诚实转写（GP-15） | **部分**：语音通话（“End and Chat”）未做 |
| 凭证（credential / secret） | 11 | GP-99…102 + M21 已实现 | 对等 |
| 连接器（connector） | 5 | GP-120 起已实现 | 对等 |
| 记忆（memory） | 1 | GP-111…113 按 Bot 分槽 | 对等 |
| 会话与消息 | 见下表 | — | 本轮补齐 4 项 |

## 二、聊天面逐项对账（本轮的重点）

真机聊天面能从文案里直接点名的动作/元素：

| 元素 | 真机证据（原文） | 我方原状 | 本轮 |
| --- | --- | --- | --- |
| 气泡形态 | `--conversation-bubble-max-width: min(640px,100%)`、7/12 内边距、18 圆角 | 已有（上轮对齐） | — |
| hover 操作条 | `Add reaction` / `Re-run` / `Copy failed` / `Reply in thread` | ghost 图标已有 | + 删除 |
| Find in chat | `Find in chat` | **没有** | ✅ 本轮 |
| 删除消息 | `Couldn't delete your message. Try again.` | **没有**（store 有 `removeMessage`，UI 没接线） | ✅ 本轮 |
| 日期分隔 | 真机截图「10月17日周六 15:13」居中灰小字 | **没有**（群里只有「谁·时间」） | ✅ 本轮 |
| 复制会话 ID | `Copy conversation ID` | **没有** | ✅ 本轮 |
| 停止生成 | `Stop` / `Stop & save` | 已有（`turnCancelBtn`） | — |
| 会话内滚到底 | 真机有回到底部的钮 | 有（`#log` 自动滚动；无独立按钮） | 未做 |
| 消息编辑重发 | 未见明确文案（只有 `Edit` 指 Bot 资料） | 无 | 不做（证据不足） |
| Canvas / 产物画布 | `Canvas`（1 条文案）、`Artifacts`（11 处 js 命中） | **没有** | **未做（最大缺口）** |
| 语音通话 | `End and Chat` / `Return to the voice chat` | 只有语音输入 | 未做 |

## 三、本轮实现的四项（判据在 `scripts/prove_m51_chatsurface.js` + `scripts/e2e_desktop_chatsurface.mjs`）

1. **Find in chat**：`Cmd/Ctrl+F` 打开浮条，TreeWalker 只包文本节点（`<mark>`），
   关掉时 `replaceChild` 拆回纯文本 + `normalize()` —— 不重建 `.body`，代码块的
   复制按钮与语言标签不会丢。计数 `{i}/{n}`，Enter / Shift+Enter 上下跳，Esc 关闭。
   顺带把 `Cmd+F` 从「电脑面板」让位给查找（真机就是这个键），电脑面板移到 `Shift+F`，
   快捷键面板同步（`hkFind` / `hkComputer`）。
2. **删除消息**：`bitbot:msg:delete` → `sessions.removeMessage` → 广播
   `sessions-changed`；ghost 条第 5 颗 🗑，删完当场摘行；失败把图标翻成 ✗ 并说明，
   不假装成功。删不存在的 id → `message_not_found`。
3. **日期分隔行**：历史加载与实时发送两条路都插（`lastDayKey` 去重），文案相对化
   （今天 / 昨天 / 本地化日期）。群聊不插：群里每条已带「谁 · 时间」。
4. **复制会话 ID**：会话详情 → 操作里一颗只读钮，clipboard 优先、`execCommand` 回退，
   复制后按钮文案变「已复制」1.2s。

验证：`prove_m51_chatsurface` **17/0**（4 条负向对照）；`e2e_desktop_chatsurface`
**13/0**（预置跨天会话做真渲染：两行分隔 + 4 处命中 + Enter 跳转 + Esc 还原 +
按钮删除真落 store + 负向 message_not_found）。

## 四、仍然没复刻的（如实，按块大小排序）

1. **Canvas / 产物画布**：真机有独立画布面（把回复里的产物铺开编辑）。我方只有
   「产物卡 + 打开文件」，没有可编辑画布。这是最大的一块，需要独立的渲染层与存储。
2. **语音通话**（`End and Chat`、`Return to the voice chat`）：我方只有录音输入。
3. **Slack / Teams 分发与团队协作**：真机文案量最大的两块（57 + 38），依赖外部
   OAuth 与管理员审批，本机沙箱不可达；如实标注残留，不 pretend。
4. **任务归档视图**（`Tasks you archive show up here`）：routines 列表有，归档态没有。
5. **共享 Bot / 邀请链接**（`Add teammates by email or share an invite link`）：账户侧
   团队面部分有，共享 Bot 没有。
6. **消息编辑重发**：真机文案里没有明确证据，不为了「看起来全」硬造。

> 说明：这张表按「证据强度」排序，不按「看起来像不像」排序。凡是标 ✅ 的都有可
> 复跑的判据；凡是没做的都写了为什么没做 —— 依赖外部服务的、缺存储能力的、或者
> 证据不足的，都不假装。
