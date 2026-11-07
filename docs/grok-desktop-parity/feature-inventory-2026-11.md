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
| 任务（routine） | 23 | GP-108…110、M22 已实现（草稿 → 执行） | 对等（归档视图 **M52 已补**） |
| 用量（usage / credits） | 19 + 3 | 每周用量面板已实现 | 对等（真实账单在云端） |
| 审批（approval） | 18 | GP-20…25 已实现 | 对等 |
| 语音（voice / call） | 17 + 15 | **GP-60/61 已实现语音对话**：composer 空才可发起 → 通话栏（脉冲/计时/监听文案/转述框）→ 挂断留 Voice chat 卡（真实麦克风录音优先，带时长） | 对等（形态差异：分段录音 + 转写，不是真机那种双工实时流） |
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
| 会话内滚到底 | 真机有回到底部的钮 | 有（`#log` 自动滚动；无独立按钮） | ✅ M52 |
| 任务归档 | `Tasks you archive show up here` | 有暂停 / 删除，没有归档 | ✅ M52 |
| 消息编辑重发 | 未见明确文案（只有 `Edit` 指 Bot 资料） | 无 | 不做（证据不足） |
| Canvas / 产物画布 | `Canvas`（1 条文案）、`Artifacts`（11 处 js 命中） | **没有** | **未做（最大缺口，原因见 §四）** |
| 语音通话 | `End and Chat` / `Return to the voice chat` | **GP-60/61 已有**（分段录音 + 转写 + 挂断留卡） | 对等（形态不同，不是双工实时流） |

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

1. **Canvas / 产物画布 —— 只读版已做（M52b），「可编辑」仍未做**。现在有的：
   「＋」菜单 →「🖼 画布」把**这个对话**的产物铺成三列墙，图片给缩略图、其它给
   种类+名字+字节、文件已经不在了标「已不在本机」，点开交给系统。
   还没有的是真机那种「在画布上继续生成/改稿」：那需要一条把画布上的改动写回
   文件的路径，不只是渲染 —— 独立一轮。
2. **Slack / Teams 分发与团队协作**：真机文案量最大的两块（57 + 38），依赖外部
   OAuth 与管理员审批，本机沙箱不可达；如实标注残留，不 pretend。
3. **共享 Bot / 邀请链接**（`Add teammates by email or share an invite link`）：账户侧
   团队面部分有，共享 Bot 没有。真正的「分享」需要一个能落到别人机器上的
   payload 与消费端，不是只生成一个链接字符串。
4. **消息编辑重发**：真机文案里没有明确证据，不为了「看起来全」硬造。

> **一处更正**：本文件 2026-11-07 首版把「语音通话」写成未做，这是错的 ——
> GP-60/61 早就实现了语音对话（composer 为空才可发起、通话栏脉冲+计时+监听文案、
> 转述框、挂断后留 Voice chat 卡并带真实录音时长）。真机与我们的差别只在形态：
> 它是双工实时语音流，我们是分段录音 + 转写。这条已经从「缺口」里移除。

> 说明：这张表按「证据强度」排序，不按「看起来像不像」排序。凡是标 ✅ 的都有可
> 复跑的判据；凡是没做的都写了为什么没做 —— 依赖外部服务的、缺存储能力的、或者
> 证据不足的，都不假装。

## 五、M52（2026-11-07 第二轮）：回到底部 + 定时任务归档

判据：`scripts/prove_m52_archive_bottom.js`（21/0，含 3 条负向对照）
+ `scripts/e2e_desktop_bottom_archive.mjs`（10/0，真 Electron）。

1. **回到底部**：`#to-bottom` 用 absolute 贴在输入卡上沿（不占流，输入卡高度不变），
   判据是 `scrollHeight - scrollTop - clientHeight > 240px` —— 不是 `scrollTop === 0`，
   否则空对话里它会永远亮着（e2e 专门有一条用空对话测这个）。
   三个触发点都接：`scroll`（用户翻）、`MutationObserver`（新消息追加不一定带 scroll
   事件，只接 scroll 会出现「消息来了钮不出现」）、`resize`。
2. **定时任务归档**：`host_ffi.routineLifecycle` 多收 `archive` / `unarchive` 两个动作。
   归档 = **先暂停**（走既有 `routine_pause`，不新造第二条改库路径）+ 在 Host 行上打
   `archived_at` 标记。只打标记不暂停，就会出现最坏的那种错位：面板里看不见它了，
   它却还在后台按 cron 发消息 —— 所以判据里最硬的一条是「归档之后到期真的不触发」
   （T16），而不是「列表里少了一行」。取消归档只摘标记、**不自动恢复排程**
   （T17），要跑再按「继续」（T18）。
   面板：常用列表把归档行剔出去，归档区折叠成「已归档 · n」，默认收起。


## 六、M52b（2026-11-07 第三轮）：产物落库 —— 画布的数据地基

判据：`scripts/prove_m52b_artifact_persist.js`（11/0，含 2 条负向对照）
+ `scripts/e2e_desktop_artifacts.mjs`（3/0，真 Electron）。

**问题**：私聊的 turn 落库时只写 `{ role, text }`。一轮里生成的图片、视频、图表、
ics、eml、skill.md、导出包，路径全都只活在渲染层内存里 —— 刷新之后库里那条回复还在、
文件卡没了，用户看到的就是「图被吞了」。

**做法**：`hosts/desktop/turn_artifacts.js` 从这一轮的 `host_results` 里挑出
**磁盘上真存在**的产物（ok:false、路径空、文件已删一律不收；同轮重复只收一次；
上限 24），turn 结束前挂到**最后一条 assistant 行**的 `artifacts[]` 上，
store 只留 `path / name / kind / bytes` 四个字段。

挂在消息行而不是单开一张索引：产物属于「那一轮」，一轮在库里就是那几行 ——
读历史时天然按时间顺序还原，删掉那条回复产物也一起消失（这正是用户对
「删掉这条回复」的预期）。

**读历史**：先问 Host 文件还在不在（`attachments.preview`）。在就按 `kind` 重建成
媒体卡 / 文件卡；不在就写一行灰字「产物已不在本机：<名字>」，不画一张点开是空的破卡，
也不让单个产物把整段历史加载打断。

### M52b 续：画布（只读）

「＋」菜单 →「🖼 画布」：三列网格铺开**本对话**的产物，数据来自消息行上的
`artifacts[]`（不扫目录、不猜归属）。三种状态分开：图片给缩略图（`attachments.preview`
的 data URL）、其它给「种类 + 名字 + 字节 + 日期」、文件已经被删的卡片压淡并标
「已不在本机」。三个出口：✕ / 点背景 / Esc。面板顶部一句话写明白它是只读的
（「这里只把本对话的产物铺开，不在画布上改文件」）—— 不假装它是可编辑画布。

判据同上（`prove_m52b_artifact_persist` T10…T15、`e2e_desktop_artifacts` 后四条）。
