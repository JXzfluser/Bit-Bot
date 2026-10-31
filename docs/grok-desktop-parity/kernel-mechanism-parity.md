# 机制对标：Grok Bot 的内核形状 vs 我们今天的形状 —— 以及由此长出的需求

> 取材（两条腿，可信度不同，分开记账）：
> - **Grok 侧真值**来自会话「深入分析Grok Bot内核机制」的**第二、三部分**（该会话自称逐字复核了
>   `app.asar/dist/electron-main/proto.cjs` 1.34MB、`daemon.cjs`、以及本机 `~/.cursor/` 磁盘）。
>   那份分析的第一部分（§1–12：客户端循环、`seq/updatedSeq` 的细节）**不在我能读到的窗口里**
>   （`hasMoreBefore: true`），本文凡引 §8/§9 都是二、三部分里的逐字回指，不是原文。**我没有在本机重跑 Grok 侧的任何计数。**
> - **我们侧每一个数字都是我在本机 grep / 读文件复跑出来的**，口径写在行内或 §7。
> - 判定口径沿用仓库三态：**已实现 / 残留（诚实，不 pretend）/ 未做**。
>
> ID 关系：本文的需求是**机制层缺口**，编号 `KP-nn`；凡 `docs/next-target-requirements.md` 的 `T*-nn`
> 或 `parity-gaps-next.md` 的 `GP-nn` 已经覆盖的，本文**只挂别名与引用，不另起一套平行账**（映射见 §5）。

---

## 1. 为什么功能都在、体验还是差

**一句话：我们造的是「33 个各自读整份快照的推送 + 28 个全量读面」，Grok 造的是「一条有序流 + 一堆幂等命令」。**
功能清单能追平，状态的**形状**追不平，体验就永远差那一层——差在「切回来消息顺序变了」「按了停止不知道停没停」「手机上转圈三十秒」。

四条机制，每条都能指到行：

1. **没有一条有序的读源在被用。** `hosts/desktop/sessions.js:96` 的 `list()` 每次调用都 `load()` 整份 JSON；
   `hosts/desktop/main.js:1111,1197,1214,1222,1227` 每次变更后把**整个** `sessions.list()` 重发给渲染进程。
   全仓 `seq/cursor/since/etag` 在活路径上**一个都没有**——`seq` 只存在于 T1-02/03 那套默认关闭、
   且装机运行时开不出库的旁路脚手架里（`report.md` §8.47 ⑪）。
2. **动作只有一跳，没有回执。** `await window.bitbot.turn(...)` 要到回合整个跑完才返回
   （`hosts/desktop/index.html:8586`）；HTTP `/v1/turn` 同样同步跑完再一次性返回整个消息数组
   （`hosts/shared/cn_inbound_server.js:697-771`）。Grok 的 `SendGrokBotUserMessage` 只回
   `dispatched`，第二段 `GetGrokBotSendStatus` 才给 `accepted_at_ms` / `rejection_code`。
3. **失败没有码。** 我们的 `DesktopTurnResult` 只有 `error : String?`（`cmd/desktop_turn/turn_json.mbt:480`），
   实际值是自由文本（`"empty user text"`、`"cancelled"`、`invalid JSON from MoonBit: …`）；
   `rejection_code` / `accepted_at_ms` / `echo_entry_id` 三个词在 `hosts/ cmd/ runtime/ skills/ tools/ channels/`
   里**命中 0 个文件**。
4. **客户端没有核心。** 状态与渲染挤在同一个 18,387 行的 `hosts/desktop/index.html` 里（行数实测），
   收到「变了」通知就再走一次 RPC 全量重读——`docs/next-target-requirements.md` §3.1 的第 5 个概念
   **Client Core（schema + reducer + 缓存 + 乐观命令）到今天一个字节都没建**（仓库里没有 `client-core/` 目录）。

这四条不是「设计漏了」：**§3.1 六个概念、§3.3 七条不变量把这套形状写得比 Grok 还克制**
（12 个 command / 14 个 event，对照 Grok 的 441 个 RPC）。差别是我们只建成了概念 1 的一半和概念 2 的影子，
概念 3/4/5 **整块未做**。所以体验差的根因不是功能少，是**目标态架构里最关键的那三块没落地**，
UI 只能靠整份快照 + 运气活着。

---

## 2. 差异对照表

| 维度 | Grok 的实测形状（二手，未在本机复跑） | 我们的实测形状（本机复跑） | 屏幕上看得见的后果 |
|---|---|---|---|
| 状态主干 | 全 API 441 个方法里**只有 4 个流**；一条 `WatchGrokBotTranscripts(cursors[], include_unlisted_agents, inline_body_max_bytes)` 镜像一切 | 92 个 `ipcMain.handle("bitbot:…")`、108 个唯一 `bitbot:*` 字面量、33 处 `broadcast()`；其中 15 处是「整份列表」型通道 | 每次变更全量重发 → 列表闪、顺序漂移、切换会话像回到过去 |
| 增量语义 | `seq` + `updatedSeq` 游标，任意 `seq` 可续订（不变量 I3 的产物） | 活路径**零游标**；`docs/events.md:66` 定义了 `subscribe(session_id, from_seq)`，消费方只有 `scripts/prove_event_dual_write.mjs` | 重复消息 / 丢消息只能靠事后人眼发现（历史事故：重复消息 = resume 不是 restart） |
| 发送回执 | 两段式：`dispatched` → `GetGrokBotSendStatus(status, echo_entry_id, rejection_code, accepted_at_ms)` | 一跳，`await` 到跑完 | 「发出去了但没人接手」和「还在排队」在屏幕上长得一样 |
| 延迟度量 | 请求字段里就写着 `enter_epoch_ms`、`composed_at_ms`、`first_sent_age_ms`、`send_source` | 这 9 个计时/追踪字段（含 `sent_at_ms`、`traceparent`）**命中 0 个文件**；唯一的时间是每条消息一个 `at` | §7 度量表「首 token 延迟 = 待测」**永远填不上** |
| 打断 | `InterruptGrokBotAgentRun(agent_id, reason, session_id)` → `had_active_run` | `main.js:3339-3342` 的 cancel **无条件** `return { ok: true }`；`had_active_run` 命中 0；`releaseActiveTurnCancel` 全仓只有 4 处（`:530` 声明、`:3340` 调用、`:3375` 单会话回合注册、`:3559` finally 置空），群聊处理器 `bitbot:rooms:orchestrate`（`:2256` 起）全程不碰它 | 按了「停止」，界面不知道停没停；群里 @ Bot 时停止按钮是假的 |
| 跨端进度 | `NotifySandAgentTurnFinished` + `WatchGrokBotUserComputerRequests` 把 `connected / notify / heartbeat` 三段分开 | `cn_inbound_server.js` 里 `progress`、`event-stream`、`chunked` **各 0 次命中**；`bitbot:room-turn-progress` 在 `main.js:2241` 广播但 `preload.js` 没有对应通道（**死线**） | 手机上只剩一个转圈的图标；桌面群里看不到 Bot 走到哪一步 |
| 授权粒度 | 按 `machine_id` 存 `local_tool_permission`；消息同意三态 `STANDING \| ASK \| REFUSED`；`retire_approval` 帧作废已给的长期授权 | 一次性授权键 `(turnId, "Tool:{排序后参数}")` 用完即焚（`host_approval_gate.js:37-50`）；长期规则是**整机** `approval-rules.json`（`product_surface.js:23`），只有 `allow \| ask` 两态 | 手机上点「总是允许」= 给这台机器全局开了口子，且**作废不了** |
| 扩展注入 | skill 作为结构化字段进 `RequestContext.skill_options`，**服务端渲染**，客户端不拼 prompt | 内核只有 3 条硬编码 skill（`skills/catalog.mbt`: `agent-email`/`routines`/`source-control`）；`runtime/*.mbt` 里 `skill` **命中 0**——UI 的 `/` 菜单能列，模型看不见 | 「装了个 skill」这件事对 Bot 的行为**没有任何影响** |
| 工具身份 | 每个 MCP server 物化成目录：`tools/<tool>.json` + `INSTRUCTIONS.md` + `STATUS.md`（鉴权状态写成文件给模型读），`~staging`/`~prev` 原子替换 | 编译期数组：`Read`/`Shell`/`TodoWrite`（`agent_loop_product_tools.mbt:355,362,374`）+ `product_tool_specs()` 里 7 个 = **10 个**；每请求重新序列化 | 现在不痛（10 个工具上下文塞得下）；加到 30 个就痛——本文把它排到最后，不是忽略 |
| 能力协商 | 插件清单 `capabilities[]`（当前唯一合法值 `"canvas"`）决定给不给 canvas 工具 | 无能力协商字段；`TurnIntent` **107 个**变体只能靠硬编码意图解析器到达（`cmd/desktop_turn/turn_json.mbt:50-220`） | 新增一个动作要同时改内核枚举 + 意图正则 + Host 分发，三处不一致就静默失败 |
| 生命周期钩子 | 22 个具名事件（`beforeShellExecution` … `workspaceOpen`） | **0 个**可挂事件（`beforeShellExecution`/`preToolUse`/`afterFileEdit`/`hooks.json` 全仓无命中） | 用户想让「每次执行 shell 前问我」只能改我们源码 |
| 灰度与真值 | 111 个具名 gate 当公开路线图；模型路由在服务端，客户端硬编码**恰好 1 个**模型 id | **243** 个 `BITBOT_*` 读点名（本机 grep 口径见 §7），其中 **26** 个能被 UI 热改（`main.js:384-412`）；无 gate 注册表 | 「装机版现在到底开成什么样」没有单一答案；`BITBOT_EVENT_DUAL_WRITE` 这种新开关同样无人知晓它开着会不会写库 |

**绿得最响的两处，恰好是最不能当体验证据的两处**：`docs/capability-matrix.md` **234 行全是 PASS**
（`todo` / `GAP` 标记命中 0），矩阵今天 **446 / 0**（mac）、**455 / 0**（CI）。这两把尺子量的是
「功能存在」和「结构不破」，**没有一条断言「用户等了多久」「这条消息为什么没落」**。

---

## 3. 支柱（对齐既有架构，不另起）

支柱直接挂在 `docs/next-target-requirements.md` 已有的骨架上：§3.1 六个概念、§3.3 七条不变量、§7 度量。

| 支柱 | 对应的概念 / 不变量 | 今天的完成度 |
|---|---|---|
| **P1 一条有序流** | 概念 2 Session Log + 概念 4 Transport；**I2、I3** | 影子：日志能写能折（G-62 31/0），**没人读** |
| **P2 命令两段式且可作废** | 概念 3 Effect Bus；**I4、I7** | 未做：一跳、无码、无作废 |
| **P3 客户端核心** | 概念 5 Client Core | 未做：`client-core/` 目录不存在 |
| **P4 每设备的能力与授权** | **I5**（`machine_id` 由密钥派生，已有）+ 授权模型 | 半：身份有了，授权是整机一把 |
| **P5 扩展层是文件且真进模型** | §3.4 词表 + 概念 1 Kernel 不做 I/O | 未做：skill 不进模型，hooks 为 0 |
| **P6 体验是被量的** | **§7 度量表**（首 token 延迟 待测 / 崩溃后重复投递 未知） | 未做：产品里 0 个计时字段 |

**顺序不是可选的**：§6 已经写过「为什么不是先做 T4」——没有 client-core 就先接手机，等于把 renderer 的协议与状态机复制一份。
本文全部需求的排序都服从这一条。

---

## 4. 需求

每条给：**现状（证据）→ 目标 → 可感面 → 验收门 → 规模**。
「可感面」是硬要求：**必须写出一条能敲的命令 + 屏幕上看得见的变化**，否则不算交付。

### 第一批：不动架构就能把体验拉起来（合计约 3d）

**KP-01 把那条已经存在却没人接的进度线接活**（别名：`GP-166` 残留列的「无统一查询面」）
- 现状：`main.js:2241` 广播 `bitbot:room-turn-progress`，`preload.js` 里没有对应通道 → 渲染进程订阅不到。
- 目标：进度是**推**给 UI 的，不是 UI 猜的。
- 可感面：群里 @ 一个 Bot 说一句活，Bot 名字旁边**立刻**出现「正在读文件 / 正在跑 shell / 正在写」的当前步；
  以前是整段沉默到回复落地。命令：`node scripts/e2e_desktop_room_progress.mjs`（新增）打印收到的帧序列。
- 验收门：新增 `G-63`——断言 preload 暴露该通道、渲染侧有 handler、真 Electron 里收到 ≥1 条进度帧且
  **注入对照**（把 `main.js:2241` 那行摘掉必须翻红）。
- 规模：0.5d。**这是今天形状与 Grok 差最近、代价最小的一格。**

**KP-02 取消要给回执，群聊回合必须真能取消**
- 现状：`main.js:3339-3342` 无条件 `return { ok: true }`；`releaseActiveTurnCancel` 只在单会话回合注册（`main.js:3375`），群聊处理器（`:2256` 起）不碰它。
- 目标：返回值改成 `{ok, had_active_turn}`；群聊回合注册与释放同一条 cancel 句柄。
- 可感面：按「停止」后，若**根本没有在跑的回合**，按钮旁边写「没有在执行的回合」而不是假装成功；
  群里点停止，那条 Bot 的进度行**停在当前步**并标「已取消」。
- 验收门：断言两态（有在跑 / 无在跑）+ 群聊取消后 transcript 里落下 `cancelled` 那一行；注入对照：把 `had_active_turn` 写死 `true` 必须翻红。
- 规模：0.5d。

**KP-03 失败从自由文本升成码，并把码显示出来**
- 现状：只有 `error : String?`（`turn_json.mbt:487`）；房间侧有一堆散装串
  （`room_surface_unavailable`、`orchestrator_unavailable`、`budget_max_wall_ms`）。
- 目标：把已有的串**收敛成枚举**（不新造词，先收编），Host→UI→手机端同一份表；`docs/events.md` 词表加一节。
- 可感面：把供应商 key 清空后发一条消息，屏幕上出现的是
  「**发送失败：未配置模型（`provider_unconfigured`）**，去设置 > 模型」而不是一行 `invalid JSON from MoonBit`；
  终端可证：`node scripts/approve.js --last-failure` 打印同一码。
- 验收门：码表穷举断言（每个码至少一条路径能产生）+ 一条反向对照（未知串必须落 `unknown_failure` 而不是崩溃）。
- 规模：1d。

**KP-04 发送加计时字段，把 §7 的「待测」变成有基线**
- 现状：`sent_at_ms`/`enter_epoch_ms`/`composed_at_ms`/`first_sent_age_ms`/`traceparent` **0 命中**；
  唯一每回合的时间在 `data/traces/<turn_id>.json` 的一个 `at`（`run_moon_turn.js:732-774`）。
- 目标：请求带 `enter_epoch_ms`（按下回车）与 `composed_at_ms`（开始构造）；结果落
  `first_token_at_ms` / `accepted_at_ms` / `turn_id` 关联；`traceparent` 从 Host 一路带到内核（替换 `desktop-<Date.now()>-<rand>` 这种断链 id）。
- 可感面：`node scripts/measure_turn_latency.mjs`（新增）打印
  `回车→发出 X ms · 发出→首字 Y ms · 首字→落库 Z ms`，并写进 `data/latency/*.jsonl`；
  连续发三条，屏幕上的三个数字**各不相同且可核对**。
- 验收门：一条门限断言（首字延迟有非零样本、且能从日志反查到 `turn_id`）+ 自证覆盖面（样本数、无样本必须红，不许「0 条也算绿」）。
- 规模：1d。**这是 §7 里唯一能把「体验」变成数的入口，后面所有优化的前后对比都靠它。**

### 第二批：状态底座（**有一个需要你点头的前置**，见 §6）

**KP-05 = `T1-04` 读切换**：UI 改读 `fold(events)`，`BITBOT_EVENT_READ_FROM_LOG=1` 才生效、默认仍走 JSON。
完成定义沿用原句「关闭双写后 smoke 全绿」，**外加**一句可感面：
删掉 `data/desktop/sessions.json` 后重启，会话列表**还在**（今天必然空）。规模 1d。

**KP-06 = `T1-09` `subscribe(from_seq)`**：`kernel_server.js` 的行协议加一条 `subscribe`，
`cn_inbound_server.js` 加 `GET /v1/events?since=<seq>`；手机与桌面共用。
可感面：手机上把 App 切后台 2 分钟再回来，消息**不重不丢**、顺序与桌面一致；
终端可证：`curl -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:18765/v1/events?since=0" | jq '.events[].seq'` 严格递增。
依赖 KP-05。规模 0.5d。

**KP-07 广播从整份快照改成 diff**：`sessions-changed` 不再 `sessions.list()` 全量重发
（`main.js:1111,1197,1214,1222,1227`），改发 `{surface, entity_id, changed_fields}`；渲染侧按 P3 的 reducer 应用。
可感面：一条长回复流式写入时，侧栏**不再整列闪动**、滚动位置不跳。规模 1d。

**KP-08 = `T3-01..07` Client Core**：新建 `client-core/`（schema + reducer + 缓存 + 乐观命令 + `checkJs`），
renderer 只渲染。可感面：输入框回车后**立刻**出现自己那条消息（乐观），落库后 `echo_entry_id` 对上；
服务端拒绝时那条乐观消息变红并带上 KP-03 的码。规模 6d（M3）。**这条不做，P1/P2 的收益一半都看不见。**

**KP-09 = `T1-06` 单写者**：14 个直写 `data/` 的文件收敛到 actor（沿用原完成定义「并发压测无覆盖；`kill -9` 恢复正确」）。
可感面：两个窗口同时改同一个会话标题，**不再互相吞掉**。规模 1–2d。

### 第三批：扩展层与授权（价值确定，但可以等）

**KP-10 skill 必须进模型**（今天最荒的一格）
- 现状：内核 `skills/catalog.mbt` 只有 3 条硬编码；`runtime/*.mbt` 里 `skill` **命中 0**；
  Host 侧磁盘发现只有 `fs.readdirSync(skillsRoot)`（`host_ffi.js:20847`）+ 一条正则提描述（`host_ffi.js:20909-20913`）；
  `SkillRef` 给的是虚拟路径（`skills/skill_ref.mbt:12`：`"/skills/managed/" + name + "/SKILL.md"`），
  全仓除了 `routines/types.mbt:71` 把它当字符串字段带着走，**没有按该路径读盘的调用**。
- 目标：磁盘上的 `SKILL.md` 正文随回合进内核上下文（按 §3.4 词表走 `--seed-*` 一类的显式入参，
  **不在 renderer 拼 prompt**）；补 `name≤64`/`description≤1024`/`environments[]` 校验与
  `disable_model_invocation` / `disable_user_invocation`。
- 可感面：`data/desktop/agent-tools/skills/demo-skill/SKILL.md` 里写一条只有它知道的行为规则，
  重启后**在对话里点名让它做一次**，Bot 的输出按该规则变；`node scripts/prove_skill_reaches_model.mjs`
  断言内核收到的 skill 数 > 0（今天这个数**必然是 0**，也就是这条门的红是先有的）。
- 验收门：注入对照——把注入点摘掉必须翻红。规模 1.5d。

**KP-11 = `T2-04/T2-06` 的授权升级：按设备 + 三态 + 可作废**
- 现状：一次性授权键 `(turnId, "Tool:{排序后参数}")` 用完即焚（`host_approval_gate.js:37` 造规范串、`:52-60` 的 `record({turnId, action, source})`），长期规则**整机**作用域
  （`product_surface.js:23` `APPROVAL_RULES_PATH`），只有 `allow|ask`；内核侧另有一套长期许可
  （`security/standing_permission.mbt:25` `StandingGrant`，`:130-140` 的 reconfirm 判定里已经有 `g.active=false` 这一「已作废」态）。
- 目标：规则键加 `machine_id`；三态 `standing|ask|refused`；新增「作废」动作（对照 Grok 的 `retire_approval` 帧），
  作废必须跨端可见（§7「设备吊销生效时间 ≤30 s」是现成的数）。
- 可感面：手机对某台 Box 点「总是允许 · 只读」后，在**桌面**的设置 > 审批里看得见这条**绑在那台机器上**的规则，
  并能一键撤销；撤销后 30 秒内手机再触发同类操作重新弹审批。
- 规模 1d。

**KP-12 hooks 事件面（今天 0）**：先只开三个点（`beforeShellExecution`、`afterAgentResponse`、`sessionStart`），
落 `hooks.json` + 一条 `beforeShellExecution` 的 deny 用例。**不做 22 个事件的全集。**规模 1d。

**KP-13 开关的单一真值**：243 个 `BITBOT_*` 读点名（26 个可热改、其余需重启），无注册表。
目标是一张 `flags` 表：名字 / 默认值 / 作用域 / 是否可热改 / 装机包里实际取值，
`node scripts/dump_flags.mjs` 打印它，装机版「设置 > 高级」里能看见自己开成了什么。规模 0.5d。

**KP-14 MCP 物化成文件**（`tools/<tool>.json` + `STATUS.md`）：**明确排到最后**。
理由诚实：我们只有 10 个工具，上下文成本还没痛；今天唯一真跑的 MCP 是我们自己的桩
（`scripts/host_h4_mcp_stdio.py`，用户加不了 server）。这条在工具数上 30 之前不做，
只做「用户可自己加 MCP server」那一半（它今天就是缺的）。规模 2d，延后。

---

## 5. 与既有账的映射（不另起平行编号的地方）

| 本文 | 既有 ID | 关系 |
|---|---|---|
| KP-01 | `GP-166` 残留「无统一查询面」 | 本文给最小落地（接死线），GP-166 的其余残留不变 |
| KP-05 | `T1-04`（`docs/next-target-requirements.md:260`） | 别名，完成定义原文照抄，**加**一句「删 JSON 后重启列表还在」 |
| KP-06 | `T1-09`（`:265`） | 别名，原句「任意 seq 续订事件完整、有序」 |
| KP-08 | `T3-01..07`（`:285-291`）+ M3 | 别名 |
| KP-09 | `T1-05`、`T1-06`（`:261-262`） | 别名 |
| KP-11 | `T2-04`、`T2-06`（`:277-279`）、§7「设备吊销 ≤30 s」 | 本文补上 Grok 的三态与作废帧两个具体形状 |
| KP-04 | `§7` 的「首 token 延迟 待测」「崩溃后重复投递 未知」 | 本文给填这两格的机制 |
| KP-02/03/10/12/13/14 | **无既有 ID** | 建议登记为 `GP-185..GP-190`（下一个空号，`parity-gaps-next.md` 现最大 GP-180 之后的批次里排） |

`parity-gaps-next.md:11` 那句「真正还差的，集中在六类」（自动化事件触发/Teach a Task、Skills 来源分类呈现、
Cloud Agent 结果闭环、共享 Computer 跨 Bot 可见 + 关窗不中断、Auto-review 独立通道、附件诚实拒绝）——
**KP-10 正好是第二类（Skills）的根因**：那类的症状列在 UI 呈现层，而真正的洞是 skill 根本没进模型。
这一条我要单独说：**六类清单里没有「skill 不进模型」，因为它在功能清单上长得像「已有 Skills 功能」。**

---

## 6. 需要你点头的一件事（它挡住第二批全部）

`T1-04` 的完成定义要求「关闭双写后 smoke 全绿」，也就是产品改读事件日志。但今天装机运行时是
**Electron 33 = Node 20.18.3，没有 `node:sqlite`**（本机实测 `sqlite MISSING`，`report.md` §8.47 ③/⑪）。
把读切过去，等于让发布出去的产物从一份**它自己开不出来的库**里读数据。三条路：

| 路 | 做法 | 代价 |
|---|---|---|
| **A. 升 Electron** | 把宿主运行时换到带内置 SQLite 的 Node 大版本（`hosts/desktop/package.json:121` 现在钉 `^33.2.0`） | 一次运行时跳版：真开机门（G-16/G-46/G-59）全量重跑，打包体积与签名重验，可能撞 GP-172 那类只读 asar 事故 |
| **B. 换后端** | 日志后端不绑 `node:sqlite`（纯 JS/WASM 或自建 append-only），代价是 `event_log.js:7-9` 那条「零原生依赖」的刻意决定要重新论证 | 日志层重写 + T1-02/03 两条已交付的门要重做；但产品运行时不再被版本卡住 |
| **C. 先只做第一批 + KP-13** | 第二批整块挂起，等运行时定调；先把死线接活、取消回执、失败码、延迟度量做掉（≈3d） | 状态形状不改；§1 的四条里只解决后两条（回执与度量），前两条（有序流、客户端核心）继续欠 |

我的建议是 **C 先行 + A 做选型验证**：第一批不依赖任何运行时决策，且 KP-04 一旦落地，
A 还是 B 的取舍就有前后对比的数可依，而不是像现在这样在「待测」上做架构决定。
**但这一条是方向性选择，我不替你定。**

---

## 7. 口径、未验证与限制（诚实清单）

- **我复跑过的数**（全部本机 grep/awk，命令在括号里）：92 个 `ipcMain.handle("bitbot:…")`；108 个唯一 `bitbot:*` 字面量（`grep -ohE '"bitbot:[a-zA-Z:-]+"' main.js | sort -u`）；
  33 处 `broadcast(`、其中 15 处属 `sessions-changed`/`rooms-changed`/`bots-changed`；index.html 18,387 行；
  `TurnIntent` 定义块 107 个变体（`awk NR 45..225 | grep -cE "^  [A-Z]…("`）；`BuiltinTool` 21；产品工具 10（3 注册 + 7 spec）；
  内置 skill 3 条；`runtime/*.mbt` 里 `skill` 命中 0；`hooks`/`beforeShellExecution`/`preToolUse`/`hooks.json` 全仓命中 0；
  9 个计时/回执字段（`sent_at_ms`…`had_active_run`）在 `hosts/ cmd/ runtime/ skills/ tools/ channels/` 命中 0 个文件；
  234 行 CM 且非 PASS 标记命中 0；矩阵 mac **446/0**（`/tmp/matrix-t103c.log`）、CI **455/0**（artifact `parity-matrix-log`，run `41091196664`）。
- **口径声明**：「28 个读面」是按**通道命名形状**（名字含 `list/get/detail/status/state/pending/read/match/week/catalog/rules`）数的，
  不是按语义数的——真正的读面数取决于是否把 `bots:detail` 这类算两次，我不想给一个装精确的数。「243 个 `BITBOT_*` 读点名」同理，
  是 `process.env.BITBOT_x` 与 `process.env["BITBOT_x"]` 两种写法去重后的**名字数**（子代理报 246，差 3 个来自拼接碎片，我没逐条核对是哪 3 个）。「26 个可热改」是 `main.js:384-412` 那段白名单里的字面量去重数（子代理报 29）。
- **Grok 侧全部数字是二手**：441/4/437、22 字段、111 gate、22 hooks 事件、六根 skill 目录，都出自那个会话的第二、三部分，
  它自称逐字复核过（并修正了子代理的 367→312），**但我在本机没重跑**。要重跑就得用 CDP 9224 起本机 Grok Bot.app，
  而那里我只做只读测量（不发消息、不改设置）——你要的话我再花一轮去核。
- **那个会话的第一部分（§1–12）我读不到**：`seq/updatedSeq`（§8）与 `[user-computer-watch]`（§9）的细节是二、三部分里逐字回指的句子，
  不是我读到的原文。这直接影响 KP-06 的字段设计——落地前**应当**把那部分补读或复测。
- **未验证**：本文没有一条需求做过真机验证（App 未跑、手机未连）。每条的「可感面」是**验收口径**，不是已观测结果。
  另一格明确没查：**内核 `StandingGrant` 到底落不落盘、跨重启还在不在**（`security/standing_permission.mbt` 我只读到
  结构体与 reconfirm 判定 `:25`、`:130-140`）——KP-11 落地前必须先答这一格，否则「作废能不能跨端可见」是空话。
- 一条自我约束：KP-01/02/03 都写明了**注入对照必须翻红**，因为这一轮之前我们刚栽在「尺子绿着、包是坏的」上
  （`report.md` §8.47 ⑥/⑦：闭包尺只认 `./x` 时，P-01 一路绿）。
