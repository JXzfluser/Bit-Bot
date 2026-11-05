# 路线 A —— 「远程控制你自己的那台机器」执行计划

- 状态：Active（2026-11-01 起）
- 上游定调：`docs/adr/0014-cross-end-direction.md`（Accepted）
- 任务行编号沿用 `docs/next-target-requirements.md` §T1/T2/T3/T4，本文件只排**顺序与验收**，不重定义任务。
- 每片一刀的硬规矩（全程适用）：先写复现测试 → 留下「修复前红」原文 → 再修 → 留下「修复后绿」原文 → 诚实记残留。禁止假 PASS、禁止 `display:none` 式掩盖、禁止把 SKIP 当绿。

## 0. 为什么是 A 不是 B

Grok 手机能随时接管，根因不是它有账号系统，而是**活儿跑在厂商的机器上**，设备只是窗口。
Bit Bot 现在的活儿跑在**用户自己的机器**上（Electron 桌面，或 `hosts/shared/box_main.js` 那台常开小主机）。
所以 A 的定义是：**把「这台自己的机器」变成手机/网页随时能看见、能指挥的一端**，不改内容存放位置。
路线 B（Grok 那种云端电脑：给每个账号一台长期活着的 VM）**不在本计划内**，因为它与 ADR 0014 不变量 I6
（「云只见元数据与密文、不落内容」）直接冲突，必须先立一份新的 ADR 才能开工。B 的入口条件写在这里：
**W2 与 W3 完成后**，「云机器」与「用户 Box」在通道层同构，B 只是把 `box_main.js` 换到 VM 上跑。

账号在 A 里的位置：**账号 = 设备密钥对**（ADR 0014 §3），不引入 SaaS 账号体系、不做邮箱手机号注册。
「账号管理」在 A 里落地为三件具体的事：设备花名册（谁）、公钥登记（凭据）、吊销生效（撤销）。
它们分别是 W3 的三条验收，不是独立的一层。

## 1. 现状锚点（2026-11-01，HEAD `29e1725`，逐条一手核实）

| 事实 | 证据 |
|---|---|
| 唯一跑通的闭环 = 能连 + 能发一轮 + 能等整轮回包，且仅局域网 | `hosts/android/.../TurnBridge.kt:67-70`、`hosts/ios/.../TurnBridge.swift:86` |
| 跨网成功率基线为 0（§7 指标第一行） | `docs/next-target-requirements.md` §7 |
| HTTP 侧没有任何「持续」通道 | `hosts/shared/cn_inbound_server.js`：`text/event-stream`/`WebSocket`/`upgrade`/`from_seq` 全部零命中 |
| 事件游标只在库层，没露成端点 | `hosts/shared/event_log.js:230 readAfter({fromSeq})`，调用方只有 prove/live 脚本 |
| 事件底座三条开关全部默认关 | `BITBOT_EVENT_DUAL_WRITE/READ/ONLY`，且开关在 prove 脚本内部自设（`prove_event_read_model.mjs:196`、`prove_event_only.mjs:325`） |
| 配对与设备身份断开 | `/v1/pair/redeem` 返回共享 64 位 `turn_token`，不登记任何公钥 |
| 登记表非空即强制设备签名（现网端不具备签名能力） | `cn_inbound_server.js:854 const hasDevices = (deviceStore.devices || []).length > 0` |
| 吊销不能热生效 → §7「≤30 s」结构性不可达 | `device_keys.js:146` 有过滤 `!revoked_at`，但 `deviceStore` 仅在 `cn_inbound_server.js:382` 启动时 `loadDevices()` 一次，全仓无 reload/watch |
| 签名能力在 JS 侧已存在，只是没下沉到端 | `device_keys.signTurn`，真实调用者 `scripts/approve.js:81/127/173`（带私钥现签打 `/v1/approvals`） |
| `client-core/` 不存在，T3 整段 0% | 目录不存在；preload 面约 100 个 IPC（F6） |
| effect 契约 T2 整段 0% | `effect_id`/`approval_class`/执行器注册表 三组关键词全仓零命中 |
| 没有任何可部署的中转服务 | `cloud/` 只有 `DEPRECATED.md`；`agents/cloud` 是 Cursor Cloud Agent 集成（`lifecycle.mbt:16` 拼 `https://cursor.com/agents/<id>`） |

## 2. 分波

### W1 止血与诚实（**已交付 2026-11-01**，不动任何契约；红绿见 `report.md` §8.56 / §8.57 / §8.58，差距行见 `parity-gaps-next.md` GP-196..203）

这一波不新增能力，只把「看起来绿、其实看不见」与「看起来红，其实是尺子坏了」两类假象拆掉。
口径要说清：**A0-1..A0-4 与 A0-6..A0-9 已交付**；**A0-5 只登记、不销账** —— 它要的是产品改动
（真审批能双写），属于 T1-03 未完成部分，不能靠门禁补。

| 片 | 内容 | 复现测试（先红） | 结果 |
|---|---|---|---|
| A0-1 | 发布链路 tag 判定与触发不一致 | 新静态门 `scripts/prove_release_tag_gate.mjs`：解析 `desktop-macos.yml` 的 `on.push.tags` 与 `startsWith(github.ref_name, 'v')` 两处，断言每个触发前缀都能点亮 `BITBOT_PUBLISH` | **已交付**：未修时 4/1（`RT-03 desktop-v0.1.0 只点亮 0/3`）→ 修后 5/0，RT-04 负向对照在；接矩阵 **G-69** |
| A0-2 | 本地运行时落后于 lockfile（Electron 33.4.11 装、`^37.10.3` 声明） | 直接跑 live 双写对账门 | **已交付**：实装 37.10.3（内置 Node 22.21.1），真 Electron 进程实测 `node:sqlite` 可用；live 门 6/4 → **10/0**；`report.md` §8.47 三处过期口径已更正（保留原文 + 标注） |
| A0-3 | live 双写门没接进矩阵（CI 看不见这条） | `scripts/e2e_desktop_event_dualwrite_live.mjs` 接进 `smoke_grok_desktop_parity.sh` | **已交付 · 接矩阵 G-70**，并且**不认退出码只认汇总行**（该脚本 SKIP 走 `exit 0`，认退出码会把「压根没跑」记成通过） |
| A0-4 | 门禁写盘越界（本轮实测发生：`report.md` 被截成 182 行） | 矩阵开局记基线、收尾比对已跟踪文件 | **已交付 · 接矩阵 G-71**，白名单为空；负向对照真跑（截断→红、复原→绿）；`e2e_desktop_layout_target.mjs` 证据默认改到 `/tmp`，入仓需显式 `BITBOT_LAYOUT_SHOT_COMMIT=1` |
| A0-5 | 新发现：审批面在真机双写里是**空对空**验证 | live 门自己那行 `「delete bot」30s 内没亮审批卡 → approvals 面按空对账` | **未做**：`L-06` 只证明「没写事件也没写快照」，不证明真审批能双写 ⇒ T1-03 的审批这条仍要另做，不能算已交付 |
| A0-6 | 新发现：门禁**跨轮留状态**，下一轮红得像产品坏了 | 复现 = 放一份 `provider_id=qwen`、`api_key` 空的 `data/llm/active.json`，脚本退回未钉桩版本（`git stash push` → 跑 → `pop` → `diff -q` 确认还原） | **已交付**：矩阵开局快照 / trap 还原 / 末尾 **G-72**（含两个负向对照真跑）；`boot`+`gp14`+`gp93`+`m28` 显式钉 `BITBOT_LLM_PROVIDER=deepseek`。同一份污染文件下 `prove_gp14_reply` **11/5 → 16/0**、`prove_gp93_links` **20/1 → 21/0**、`prove_m28_usage` 钉桩侧 **14/0**。刻意**不做**统一钉子（会把 env 顶到 `active.json` 之前，毁掉 journeys 的 provider 切换门 ⇒ 假绿），理由写在 `scripts/electron_env.mjs` 的 GP-201 段 |
| A0-7 | 新发现：**门禁自己把用户文件写脏**了（G-71 本轮真抓到） | `smoke_desktop_turn.sh` 里 code_changes 的产品测把 `README.mbt.md` 尾部留了 4 行空行 → G-71 ✗。复现 = 跑完矩阵看 `git status`；现场用 `git checkout -- README.mbt.md` 清掉 | **已交付**：门自己收尾复原 —— stub 起来前快照 `README.mbt.md`，EXIT trap 里 `cmp -s` 不一致就还原（开局没有则把产物挪进 `/tmp` 再删）。**没有**走「把 `README.mbt.md` 加进 G-71 白名单」那条路，白名单继续为空：任何已跟踪文件被门禁改了都仍要点名 |
| A0-8 | 新发现：矩阵剩下的 7 条红全是**坏尺子**（上游删了 UI/函数，产品没坏） | 逐条对着代码与提交核实：`9d89d17` 删「按宽度自动收起」（`index.html:18788-18791`）、`29e1725` 删「设置 → 手机」页签、`8349-8371` 把「留空＝不改动」移进 placeholder | **已交付**：四把尺子重接（`e2e_desktop_sidebar_adapt` 重写并**新增 R-05/D-L-14 收起态重开条**、`e2e_desktop_layout_target` 换真实点击 + 窄窗期望按 §3.2 重算、新增 `e2e_android_roster.v2` 接 `#mc-*`、`e2e_desktop_llm_key_paste_guard` LK-05 兼读占位符）；`layout-contract.md` §3.2 + D-L-14 更正；矩阵 G-46/G-47/G-54 锚点与文案同步。单门实测 sidebar **6/0**、layout **14/0**、roster v2 **18/0**、lk **7/0**。**不删断言、不放宽、不改产品换绿**；被有意移除的能力登记 **GP-203**，不当绿也不当红 |
| A0-9 | 新发现（GP-204 的下一轮）：**门禁每轮漏 3 个进程**，真因是 CLI 在桌面常驻默认下不收尾 —— **桌面自己拉起的 routine daemon 卡死在第一轮 sweep** | 先写红：新断言 `KR-11`（一次性 CLI 开常驻跑完一轮必须自己退出、且不留内核；带「故意不关池」的**同型反向对照**）→ `FAIL KR-11 — … 跑到 45026ms 上限被 SIGKILL（常驻池没关）。那一轮其实已经打完 —— stdout 3683 字节、回合 ok=true，卡的是退出 …`；再把 `run_turn.js` 临时换回修复前版本、按 G-64 那面门新加的那行原样跑 → `exit=124 耗时=180003ms`、日志停在 `==> routine daemon long-lived sweep 1`（第二轮永远没开始） | **已交付**：`hosts/cli_host/run_turn.js` 收尾 `releaseKernel()`（`stopKernel()` 关 stdin 让内核见 EOF 自收 + 8s 上限后按 **stop() 之前**取到的 pid 强杀；异常路径同样收尾）—— 回合 JSON 形状、stdout/stderr 分工、exit code 语义一字未改。绿：`ok KR-11 — … 91ms 自己退出 … serve 进程 0→0 零残留 …`（`KR summary: pass=12 fail=0`）；`smoke_desktop_turn.sh:968` 新增「带桌面的常驻默认再跑一遍 long-lived daemon」（修复后 801ms、`sweeps 2 ok 2 fail 0`）；矩阵 G-58 加 `grep -q '^ok KR-11'` 锚点 + 6 行 echo；§8.58.4 的归因已在 §8.59.6 更正（来源是**门禁起的 Electron 桌面**所拉 daemon 的孙进程，不是 turn smoke）；9 个孤儿已清（`run_turn 9→0`、`desktop_turn --serve 18→0`）。**未盖章**：没起真 Electron 量「sweeps 连续 >1」；8s 兜底强杀那条分支未被实测触发；`host_routine_daemon.sh` 有意**不加** EXIT trap（真因已修，trap 属于掩盖）|

W1 不做的事：不打开任何事件开关进默认路径（那要等 W3 的单写者，见 §3）。

W1 的收口判据（本轮实测）：全量矩阵从 `PASS=478 FAIL=19` → `493/9` → **`PASS=502 FAIL=0`**，
日志里 0 条 `· skip`；G-71 收尾「基线 17 项，收尾 0 项」、G-72「开局 absent → 收尾也没有」。

**A0-9 之后的再一次全量复跑（同日 20:26 收尾）**：`smoke_grok_desktop_parity: PASS=503 FAIL=0`、0 条 `· skip`、整轮 43:50；G-71「基线 0 项，收尾 0 项」、G-72「开局 absent → 收尾也没有」。多出的那 1 项是 G-58 的 KR-11 锚点。**进程残留从「每轮 +3」变成收尾 0**（`run_turn 9→0`、`desktop_turn --serve 18→0`、`moon … --serve 9→0`）—— 取证见 `report.md` §8.59.9。
红绿原文与逐条归因在 `report.md` §8.58。

### W2 让手机「看得见这一轮」（性价比最高的一刀）

用户侧的病很具体：手机上发出回合后，几十秒内界面是空的（IPC 有 `llm-stream`/`turn-progress`/`agent-loop`/`room-turn-progress`/审批推送 5 类实时事件，HTTP 侧一个对应物都没有）。

| 片 | 内容 | 约束 |
|---|---|---|
| A1-1 | 服务端 `GET /v1/events?from_seq=<n>`（SSE，只读） | 复用 `event_log.readAfter`；**只加路由，不改任何既有响应体**；鉴权沿用当轮所选凭证体系，未鉴权一律 401 | **已交付 · 接矩阵 G-73**，红绿见 `report.md` §8.60；生产路径仍 503（event_mirror 未接进桌面 main.js，见 §8.60.4） |
| A1-2 | 事件面：`turn_started`/`turn_progress`/`turn_finished` 三类最小集，带 `seq` | 不新造 kind —— 以 `docs/events.md` 已定义的为准；缺就先补契约再补码 | **已交付 · 接矩阵 G-74**，红绿见 `report.md` §8.61。注：按「以 docs/events.md 为准」落的是契约真 kind `turn_started`/`progress`/`turn_ended`（§5.2），未自造 `turn_progress`/`turn_finished`；并顺带把 `event_mirror` 读句柄接进桌面 → A1-1 路由生产路径从 503 变可读 |
| A1-3 | 断线重连：客户端带 `Last-Event-ID` 续订 | 验收原话「任意 seq 续订事件完整、有序」（AC-T1-9） | **已交付 · 接矩阵 G-75**：`prove_cn_events_sse` EV-6（Node 层游标优先）+ `e2e_remote_progress_stream` RP-05（真 Electron 半程拔线 → 重连首帧正好接上、合并 == 整轮、重复 0 缺失 0）。同刀附带把三条只有真 app 才暴露的缺口修掉（`/v1/events` 鉴权与 `/v1/turn` 同构、桌面 `onTurn` 补 `onProgress`、`?session_id=` 会话隔离），红绿原文见 `report.md` §8.62 |
| A1-4 | 端上消费：Android/iOS 各加一个只读 SSE 订阅，界面显示进度 | 拿不到就退回现有整轮模式，**不许静默丢事件**；每条都写进残留清单 | **端上已接线、真机未验（2026-11-02，接矩阵 G-77）**：Android 侧订阅真的长在回合生命周期上（`submitTurn` 发起、`turn_ended`/`finally` 关）、进度行真的传到 `ProgressRow`、回退提示真的在 busy 分支显示、三语真的接上系统 locale、`ON_STOP`/`ON_START` 管连接边界。结构门 `prove_android_event_stream` **32/0**（17 判据 + 15 把真注入），JVM 单测 **167/0**（其中 10 条是渲染级：真 SSE 帧 → Compose 屏幕上有那行字，见 `EventStreamUiWiringTest`）。渲染级那一层还照出一条只有「线路两端都对上」才会暴露的真 bug：回合写死 `session_id=android-app`、订阅另算 `mobile-android`，服务端按会话过滤 ⇒ 手机**一条帧都收不到**；现在两边同源 `TurnBridge.sessionFor(...)`（取证与红原文见 `report.md` §8.63.10）。上一版的「半成品」判定成立且已被本轮闭掉 —— 更糟的是那把门自己没牙（删掉唯一调用点仍报 `PASS=12 FAIL=0`），取证与重写过程见 `report.md` §8.63.1。**仍不算交付的部分**：本机无 KVM/真机，「用户在真手机上看得见」没有被设备级证据确认（R-A1-4b），另有一条本轮取舍 R-A1-4a 与一条未复现的并发窗口 R-A1-4c；iOS 仍是 stub |

W2 完成判据（对应 §7 指标）：手机发一轮，能在界面上看到 ≥3 次进度更新；拔网 10 s 重连后无重复无缺失。

**判据现状（2026-11-02，两次核实）**：服务端到 SSE 帧这一半**已实测成立**（RP-03 一轮 9 帧、RP-04 `progress` 7 帧含 `tool_activity`、RP-05 续订零重复零缺失、RP-09 连续第二轮真看得见）；
「手机界面上看得见」这一半本轮**接上并过了结构门**（G-77：17 判据 + 15 把真注入 = 32/0，端上 JVM 单测 167/0，含 10 条渲染级），
但**没有被任何设备级证据确认**（本机无 KVM/真机）—— 所以本节状态写的是 **服务端收口 / 端上已接线未验收**，
不是「W2 完成」。要盖章，得有人照着 R-A1-4b 那份清单在真手机上走一遍。

顺带挖出并修掉的一条跨面缺陷（不止手机）：内核换 AgentLoop 后 §5.7 进度链路整条断掉，
桌面 `#turn-progress` 也不再更新；`prove_gp96_progress.js` 的真回合三条断言本地是红的，
而它的 2×N 排序断言在 0 对时**恒真通过**。修法与取证见 `report.md` §8.62.2 / §8.62.3，
尺子接线见矩阵 **G-76**（这道门此前不在聚合矩阵里，正是它坏了很久没人发现的原因）。

W2 遗留（下一轮要认领，别混进完成判据）：

| 项 | 内容 | 为什么归 W3 |
|---|---|---|
| R-A1-1 | 谁能订哪个 session：`?session_id=` 只挡「看得见谁」，不挡「有权看谁」；同一把 bearer 可订这台大脑上任意会话 | 授权主体是设备/账号，属 A2-3 的验签面 |
| R-A1-2 | `/v1/turn` 回执的 `host_results` 不含 AgentLoop 内 dispatch 的工具效果（RP-04 里 `effects:0` 而流里有 `tool_activity`）—— 既有响应体口径本轮按铁律没动 | 与 T2（effect 契约带 `effect_id`）同批改，避免两处各自扩字段 |
| R-A1-3 | 双写默认关（`BITBOT_EVENT_DUAL_WRITE`），关着时路由诚实 503、端上回退整轮 | 打开默认值的时机应等 W3 单写者/授权成形 |
| R-A1-4a | **本轮接线时的取舍**：`submitTurn` 里一度 `awaitStreamReady(3000)` 再 POST，结果发送被进度连接拖住 3 秒（连不上时更久；`ChatThreadPersistenceTest` CP01/CP02 因此真渲染红：`Failed to assert the following: (is enabled)`、composer `[Disabled]`）。已**删掉等待**——消息必须立刻走。代价：极快回合（小于一个 RTT）可能少 `turn_started` 与首帧 progress | 要闭就得让服务端接受「先下单、再补订」的显式游标协商（`/v1/turn` 已回 `session_id`，缺的是「本轮起点 seq」），那是新的可选返回字段，等 W3 一起改 |
| R-A1-4b | **A1-4 至今没有被设备级证据确认**：`prove_android_event_stream` 只读 Kotlin 源码结构（16 判据 + 13 把真注入 = 29/0），端上 JVM 单测 167/0 跑在 Robolectric 上（含渲染级 10 条：屏幕上有字才算绿）；本机无 KVM 起不了 emulator。真机人工验收清单：① 配对后发一条需要工具的消息，十几秒里至少看到 3 次进度更新且措辞与桌面一致；② 中途锁屏 30 s 再回来，进度接着出且不重复（ON_STOP/ON_START 那条边界）；③ 第一轮结束后 10 s 再发第二条，第二轮**不得**先出现第一轮的行（RP-09 的真机对应物）；④ 系统语言切繁体/英文，进度行与回退提示要跟着变（现在非中/英 locale 归一到 `en`，而 app 其余文案仍是硬编码简体，会混搭）；⑤ 关掉桌面事件双写，手机要显示回退提示而不是空屏 | 任何一条在真机上不过，A1-4 就从「已接线」退回「未交付」；iOS 侧同样是 stub，要单独一刀 |
| R-A1-4c | **SSE 回调在非主线程读-改-写 Compose 状态**（`progressLines`、`lastStreamSeq`、`fallbackMessage`）。本轮专门写了「一回合连发 12 帧不许丢」这条用例（ES-08），它现在是**绿的** —— 也就是说丢更新至今未被复现，我不把它写成已修。窗口仍在：`ON_STOP` 关线与上一轮没关严的订阅并发、`ON_START` 带游标续订与新一轮 `submitTurn` 并发时会出现两个 writer | 真机上若出现「进度行少一条/顺序乱/上一轮的行串到这一轮」，先查这条；闭法是给 `TurnCoordinator` 的写侧加单线程收敛（`Dispatchers.Main.immediate` 或 `Mutex`），但必须有真机证据才动，否则只是猜测性改动 |
| R-A1-4d | **回合会话名归一的代价**：本轮把 POST body 里写死的 `android-app` 归一到 `mobile-<machineKind>`（与订阅同源）。字段与 JSON 形状一字未动，旧事件行仍在盘上；但「按会话翻历史」在切换点分两段 —— 切换前挂 `android-app`，之后挂 `mobile-android` | 真机验收若确认用户要连着看切换前那段，交由 W3 处理（会话以 `/v1/turn` 回包真值为准 + 账号=设备），本轮不迁移、不删除、不假装没发生 |

### W3 让「账号 = 设备」真的成立（这一段就是用户问的「账号管理」）

顺序不能反：先让配对发的是设备凭证，再谈吊销；吊销必须能热生效。

| 片 | 内容 | 复现测试（先红） |
|---|---|---|
| A2-1 | `/v1/pair/redeem` 成功后**登记设备公钥**（端上生成密钥对，redeem 请求体带可选 `device_public_key`） | ✅ 已实现（服务端登记 + 端上上行公钥都接线了；真机未验）。门：配对完成 → `devices.json` 出现该设备；不带该可选字段的旧客户端仍按现合同工作（`prove_w3_device_trust` WD-01/02/05/06/07 + 端上 DT-04/04b，注入 `INJ-WD_01`/`INJ-WD_05`/`INJ-WD_06a/b/c`） |
| A2-2 | `deviceStore` 热生效（按需重载或 ≤30 s TTL） | ✅ 已实现（实测 TTL 2 s；「配对完立刻下单」零等待）。门：revoke 一台 → 不重启入站服务，≤30 s 内该设备请求被拒，其他设备不受影响（AC-T4-4）—— WD-03/04/07，注入 `INJ-WD_03_04`/`INJ-WD_07` |
| A2-3 | 端上真签名：把 `signTurn` 的等价实现下沉到 Kotlin/Swift | ✅ **Android 已实现、iOS 未做**；真机未验。集成门：真 HTTP 服务 + 真验签，覆盖 `missing_signature`/`bad_signature`/`stale_timestamp`/`nonce` 重放 —— 服务端侧 WD-09，端上侧跨语言金标 WD-10 + 源码接线 WD-11 + Robolectric 真 socket 的 DT-01..05（`DeviceIdentityTest` 9 条、`DeviceTrustWiringTest` 7 条），注入 `INJ-WD_10`/`INJ-WD_11` |
| A2-4 | 消掉 `:854` 那颗地雷（登记非空 ⇒ 只发 Bearer 的端立刻 401） | ✅ 已实现（只加字段：`device_error`/`error_description`/`next_step`，既有 `error` 取值一字未改；端上直接显示桌面给的 `next_step`）。迁移期门：登记表非空 + 客户端只会 Bearer 时，给**可读的 401 文案 + 桌面侧提示**，而不是让它静默连不上 —— WD-08/09，注入 `INJ-WD_08`/`INJ-WD_09`；桌面侧提示仍属 A2-5 |
| A2-5 | 设备花名册 UI：桌面「移动端远程控制」里列出已登记设备（名称/机器类/最近活跃/吊销按钮） | **已交付 · 接矩阵 G-78**，红绿见 `report.md` §8.65。UI 渲染断言（MC-13）**已于 2026-11-03 本机实跑绿**（`e2e_desktop_mobile_control` PASS=15 FAIL=0 SKIP=0，原先判「本机无显示 SKIP」是误判：macOS `hasDisplay` 恒 true）；数据层 + 吊销落盘 + last_seen 跟踪另由 `prove_cn_device_roster.js` 证绿（PASS=6 FAIL=0）。「最近活跃」由设备密钥鉴权成功落 `last_seen_at`，与入站服务写同一份 `data/host/devices.json` |
| A2-6 | （W2 收口时新增）把 `:854` 地雷的范围说清楚：`/v1/events` 现在与 `/v1/turn` 同构 ⇒ 登记表非空 + 端上只会 Bearer 时，**连"看不见自己下的单"都算上了**。A2-4 的可读 401 文案与桌面侧提示必须两路一起给 | 已有锚点：`prove_cn_events_sse` EV-7 钉「两路一起 401」；文案与提示仍是 W3 的活，`parity-gaps-next.md` GP-206 |

W3 不做：邮箱/密码/第三方登录、多用户组织架构、跨账号共享。二维码按 ADR 0014 仍排除在外。

**W3 判据现状（2026-11-02 收口 A2-1..A2-4 后）**：`prove_w3_device_trust` 主断言 **26/0**、含 11 把真注入 **37/0**；
端上全量 **183 tests / 0 failures / 0 skipped**（21 类），`prove_android_build` **18/0**（新增 AB-17）。
实现前那道门真跑 **`PASS=1 FAIL=9`**，逐字红原文与三次「门自己的错」见 `report.md` §8.64。
**全量矩阵复跑 `PASS=525 FAIL=0`、0 条 `· skip`**、G-71 基线与收尾同为 12 项、收尾零 `tick routines` 残留进程。
按唯一口径，本节状态是 **服务端 + Android 端上已实现、真机未验**（R-A2-1，本机无 KVM），不是「W3 完成」——
要盖章仍得有人在真手机上走完 §8.64.10 那份清单。A2-5 设备花名册 UI（含吊销按钮）已于 2026-11-03 交付（G-78），
其 UI 渲染断言（MC-13）**已于 2026-11-03 本机实跑绿**（`PASS=15 FAIL=0 SKIP=0`；此前「需 CI 有显示」是误判），
真机级 R-A2-1 仍需真手机（本机无 KVM）。

### W4 跨网可达（把成功率从 0 抬起来）

局域网直连做不到 §7 的「跨网 ≥90%」，必须有一个内容不可见的中转。ADR 0014 已允许「只做流量转发 + 自托管镜像」，但落地前的部署位置原本是必须人拍板的事（见 `docs/next-target-requirements.md:381`「中转部署位置：国内自建（备案）还是仅提供自托管镜像？」）。**用户已于 2026-11-02 拍板：保持轻，走「仅自托管镜像」**——只交付一个镜像，明确不做国内自建；
ICP 备案 / 增值电信许可 / 长期基础设施与 SLA 全部由用户侧承担，项目 footprint 维持最小、与 ADR 0014「云只见元数据与密文」一致。
中继据此做「哑」转发：只转发、不碰内容、不存密钥；A3-2 内容不可见实证仍是硬门禁（用户侧也要能量证），不放水。

| 片 | 内容 |
|---|---|
| A3-1 | 中转服务的最小可运行镜像：一个 Dockerfile + 一个入口进程（成员凭证签发、公钥登记、转发、健康检查） | **已交付 · 接矩阵 G-79**，红绿见 `report.md` §8.66。TCP/TLS 透传模型：控制面 `relay-secret` 鉴权（HMAC 成员凭证，box/client 两类角色）+ `REGISTER`/`CONNECT` 线协议 + 盲 TCP 转发（数据面不解析不落内容）+ HTTP `/healthz` 健康检查；`hosts/shared/relay/relay_server.js` + `relay_keys.js` + `Dockerfile.relay`。诚实残留见 §8.66.4（控制面 TLS 未实跑 / 端到端业务 TLS 不在本片 / registry 仅内存 / A3-2 独立实证待下一刀） |
| A3-2 | 内容不可见的实证：中转侧日志/抓包无明文正文与附件（AC-T4-3），做成门不是写成承诺 | **已交付 · 接矩阵 G-80**，红绿见 `report.md` §8.67。`hosts/shared/relay/relay_server.js` 加元数据审计日志（`logFile`/`verbose` + `log()` 助手，只记 event/role/memberId/boxId/endpoint/bytes，删防御 token/payload/secret）+ `getAuditLog()`；门禁 `prove_cn_relay_invisible.js` 跑完整透传 canary 证明「日志真实存在且查无明文」（反真空通过），`PASS=6 FAIL=0`。诚实残留见 §8.67.4（端到端业务 TLS 仍不在本片 / 日志落地需按 ADR 0014 约束 / registry 仍仅内存） |
| A3-3 | 客户端直连优先、失败自动回落中转（局域网直连成功率 ≥95% 时界面显示「直连」，AC-T4-5） | **已交付 · 接矩阵 G-81**，红绿见 `report.md` §8.68。`hosts/shared/connection_strategy.js`（`resolveConnection` 直连优先短路→直连全失败且配了中转则回落 relay→全不可达回 mode:none；`defaultProbe`=net.connect+setTimeout；`describeMode` 回「直连/中转 · Nms」三语）+ 门禁 `prove_cn_connection_strategy.js` `PASS=6 FAIL=0`。诚实残留见 §8.68.4：**移动端（Android/iOS）接线与界面渲染未做**（本机无 SDK/gradle、网络 502，iOS 需 Xcode 模拟器）、≥95% 成功率需真机统计、QUIC 打洞不在本片 |
| A3-4 | 安装包体积：`prove_pack_artifacts.mjs` 现在棘轮 85 MB、目标 70 MB，中转客户端进包前先确认这条不反弹 | **阻塞 · 前置基线已测（2026-11-03）**：本机 `dist/` 实测 `Bit Bot-0.1.0-arm64-mac.zip = 83.6 MB` / `.dmg = 80.2 MB`，均 ≤ 85 MB 棘轮，但 **zip 距棘轮仅 1.4 MB 余量**、距 70 MB 目标差 10.2–13.6 MB。中转客户端**尚未进包**（依赖 A3-3 移动端接线 R-A3-3a），「进包后不反弹」当前测不了，故本片不可作为红→绿代码片收口。PA-06/PA-07（无源码树启动/跑一轮）本机因 Electron sandbox「Operation not permitted」失败，属**环境限制**（非本片引入；注意这与 MC-13 不同——MC-13 已于 2026-11-03 本机跑绿，PA-06/07 是 sandbox 起不来的另一类）。闭法：移动端 relay 客户端接线 + 真实打包后重跑 PA-02，确认 ≤85 MB（1.4 MB 余量很紧，进包前须先量源码增量）。 |
| A3-5 | 手机侧中转客户端（跨网那一半）：线协议 + 隧道上 HTTP + 直连失败才回落 | **已交付 · 接矩阵 G-47/AB-18**，红绿见 `report.md` §8.70。`RelayTunnel.kt`（`AUTH`/`CONNECT`/`TUNNEL` 与 `relay_server.js:141-199` 逐字对齐，DENY/NOBOX/BADCMD 各自说人话）+ `TunnelHttp.kt`（HTTP/1.1 over socket：定长 / chunked / EOF 三种回包）+ `ConnectionStrategy.kt`（与 A3-3 同语义：直连优先短路→回落→离线，三语文案一致）+ `TurnBridge` 接线（头一次攒齐、直连先试、两条原因都留）。门禁 RT-01..RT-10（真 ServerSocket 假中继/假桌面）本机 `OK (10 tests)`、CI `193 用例 0 失败` / `prove_android_build: PASS=19 FAIL=0 SKIP=0`。**本机无 Android SDK**，故另做 `scripts/verify_relay_transport_android.sh` 走 maven 的 kotlinc 本机自证。残留见 §8.70.4：配对本身仍只走局域网、SSE 未走隧道、手机无填中转的界面（A3-6） |
| A3-6 | 跨网参数这条路接通：桌面配对回执下发中转四栏 → 手机解析落 prefs → 状态条显示「直连/中转 · Nms」 | **已交付 · 接矩阵 G-82 / G-47·AB-19**，红绿见 `report.md` §8.71。桌面：redeem 成功回执**可选**挂 `relay: {host, port, box_id, client_token}`（`currentRelayHandoff()`：`opts.relayHandoff` 优先、否则读 `BITBOT_RELAY_*`；半套一律回 null），没配时回包逐字节不变。手机：`RelayTunnel.parseRelayHandoff`（没键/不齐/坏 JSON 一律 null）+ `DesktopPairing` 成功即落 prefs（没给就清旧）+ `TransportStatus` 记**真实走过的那条路**（两条都断回 NONE）+ 状态条优先显示连接方式（`labelOrNull`，NONE 时回 null 不盖掉「已配对」）。门禁 `prove_pairing_relay_handoff.js` PH-01..PH-05 本机 `PASS=1 FAIL=4 → PASS=5 FAIL=0`（PH-04/PH-05 先加正控才变红，防真空通过）；RT-11..RT-13 + TS-01..TS-03 本机 `Tests run: 16, Failures: 1`（仅 RT-11）→ `OK (16 tests)`；AB-19 五组负向对照本机先验 `base: []` / `undetected: []`。残留见 §8.71.4：**SSE 仍不走隧道（R-A3-5b）**、无手动填中转入口、真机跨网未跑 |
| A3-7 | 桌面自己挂上中转：读配置 → 下发四栏 → 以 box 角色登记 + 心跳重登记 | **已交付 · 接矩阵 G-83**，红绿见 `report.md` §8.72。新增两个模块：`hosts/shared/relay/relay_config.js`（配置唯一事实源：`data/desktop/relay.json` 优先、`BITBOT_RELAY_*` 兜底、半套一律 null、`toHandoff` 只给手机四栏**不含 box_token**）与 `relay_box_client.js`（`AUTH`/`REGISTER` 与 `relay_server.js:158-199` 逐字对齐，一次 REGISTER 一条短连接，默认 30s 心跳，失败不抛但 `getState()` 区分 not-configured/denied/badreg/badcmd/transport）。`main.js` 的 `ensureCnInbound()` 传 `relayHandoff: () => currentRelayHandoff()`（**每次兑换现读**，改完配置即可下发；登记仍需重启 / 切局域网开关）、拿住 `await cnInbound.start()` 的真实端口再接 `syncRelayBoxRegistration(started)`、`before-quit` 停心跳。门禁 `prove_relay_box_registration.js` RB-01..RB-12 本机 `PASS=12 FAIL=0`（真 relay + 真 cn_inbound + 真 socket；十一组负向对照逐个验过）。残留见 §8.72.6：**relay 拨 box ⇒ NAT 后拨不进（R-A3-6g）**、无设置面且凭证明文落盘（R-A3-6h）、SSE 仍不走隧道（R-A3-5b）。**收口：CI `9c6c5dd` `PASS=544 FAIL=0`（G-83 12/0，`539+5`）** |

| A3-8 | 反向隧道：公网 relay 服务 NAT 后面的桌面（关 R-A3-6g） | **已交付 · 接矩阵 G-84**，红绿见 `report.md` §8.73。`relay_server.js` 新增 `BIND`/`BOUND`/`ACCEPT`/`ATTACH` 反向模式（relay **全程零主动拨**，ATTACH 到了才回 `TUNNEL`，2.5s 没人接明确回 `NOBOX`），**旧 `REGISTER` + 主动拨路径一字保留**；`relay_box_client.js` 新增 `mode: "reverse"`（BIND 长连接 + 每条 stream 一条**出站** ATTACH ⇄ 本机 cn_inbound，控制面 `OK` 行先剥掉再 pipe，否则 cn_inbound 会回 400）；`relay_config.js` 加可选 `mode` / `local_endpoint`（默认仍是 dial、`toHandoff` 仍只四栏）；`main.js` 按 mode 接线且幂等 key 含 mode/localEndpoint。门禁 `prove_relay_reverse_tunnel.js` RV-01..RV-13 本机 `PASS=15 FAIL=0`（真 relay + 真 cn_inbound + 真 socket；18 组负向对照逐个实跑、逐组复原校验）；既有 relay 三门复跑 `6/0`、`6/0`、`12/0`。**手机端协议零改动**（仍是一行 `TUNNEL <label>`），APK 不用重打。残留见 §8.73.6：**真公网 + 真 NAT 一次都没跑过（R-A3-8a）**、默认仍需手写 `"mode": "reverse"`（R-A3-6h）、reverse 断线重连未做断网注入、stream 并发/背压未压测。**收口：CI `899df88` `PASS=549 FAIL=0`（G-84 5/0，`544+5`，29m7s），红绿原文见 `report.md` §8.73.9** |
| A3-9 | 反向隧道的活体检测与自愈（部分关 R-A3-8a） | **已交付 · 接矩阵 G-85**，红绿见 `report.md` §8.74。① BIND 长连接加应用层 `PING`/`PONG`，连续 N 次不回就清 registry 断链（NAT 映射过期造成的半开，TCP 不报错、close 不触发，A3-8 的「断链即清表」完全兜不住）；② `acceptReverse()` 改 `clientSock.pause()`，等 ATTACH 期间 relay **用户态零持有**业务字节，`pipe()` 自行 resume；③ 把 A3-8 只写了逻辑的断线重连做 relay 重启注入实测。新增 `livenessEvictions` / `pendingBufferBytes` / `pendingSocketsPaused` 三诊断。门 `prove_relay_reverse_resilience.js` RR-01..RR-09 本机 `PASS=9 FAIL=0`（最终门 + 产品回退 A3-8 态的修复前红 `PASS=6 FAIL=3`），十组负向对照 `0 真空`，既有四门复跑 `15/0`、`12/0`、`6/0`、`6/0`。**第一版 4 组真空逐个逼门改硬**：误踢被自动重连掩盖 ⇒ 数 evictions 差值；`pendingBufferBytes=0` 分不清「内核持有」与「字节读走丢了」⇒ 补 paused 断言；手写 `a.resume()` 摘了不红 ⇒ 冗余代码直接删；`c.pending` 兜底分支不可达 ⇒ 移出已验证锚点、单列盲区。本片**不以 30 分钟 CI 为收口前置**（用户要求不等待），验收凭据见 §8.74.7；**事后补查权威 CI `e0e76a9` `PASS=559 FAIL=0`（run 41852793229，32m10s，G-85 9/0）**，A3-9 自己那跑 `41849770338` 被随后的 A3-10 推送取消、非产品红。残留见 §8.74.6：**真公网 + 真 NAT 仍零样本**、保活参数未调、日志量与并发/背压未压测 |
| A3-10 | 真机验收准备（清单修正 + 开跑前自检） | **已交付 · 接矩阵 G-86（只挂 --self-test）**，红绿见 `report.md` §8.75。用户已具备真机/手机条件，开工前查出旧 `real-device-checklist.md` **严重过时**（还写着「跨网不可用、Android relay 客户端没接」，那是 A3-4 之前的状态），照它跑会走错路；另核实 `redeemCode()` 仍只走局域网 ⇒ **必须先同 Wi-Fi 配对拿四栏、再关 Wi-Fi 切蜂窝**。重写清单：§0 区分三种场景（**只有场景 C 能关 R-A3-8a**）、§2 可复制部署命令、§5 跨网十条逐条打勾（含 ≥90% 目标与 SSE 必然回退的诚实边界）、§6 观测点与「审计里绝对不该出现什么」。新增 `scripts/verify_real_device_readiness.js` RD-01..RD-08 开跑前自检（含 `client_token` 真 AUTH、`box_token` 真 BIND 探针），`--self-test` 八组 `PASS=8 FAIL=0`、五组工具自身负向对照 `0 真空`；首跑 `spawnSync` 阻塞父进程事件循环导致 RD-06/07/08 全 timeout，改异步 spawn 修好。**G-86 验的是工具不是真机**：默认模式依赖真实 relay + 运行中的桌面 app，故意不挂 CI。**收口：CI `e0e76a9` `PASS=559 FAIL=0`（run 41852793229，32m10s，G-86 8/0，`549+10`），见 `report.md` §8.74.7**。`R-A3-8a` **未关闭** —— 真机样本回来才能销账 |
| A3-11 | 中转配置热生效（部分关 R-A3-6h） | **已交付 · 接矩阵 G-87**，红绿见 `report.md` §8.76。A3-10 真机清单里还得写「改完 `relay.json` 要重启桌面 app」，因为四栏现读但**登记只在入站启动 / 切开关时发生** ⇒ 运行中改配置会「有四栏却 NOBOX」。新增 `hosts/shared/relay/relay_config_watch.js`（2s 轮询、指纹用**归一后的配置对象**、加空格不重登记、`check()` 显式暴露给门），`main.js` 五处接线（require / 启动 / onChange 接 `syncRelayBoxRegistration` / 入站关闭停 / before-quit 停）。门 `prove_relay_config_hot_reload.js` RH-01..RH-11 本机 `PASS=11 FAIL=0`；**修复前红（最终门 + main.js 回退 A3-10 态）`PASS=10 FAIL=1`** —— 十条全绿、唯独 `RH-10 桌面接线缺了 5 处` 红，又一次实证「模块绿≠产品会用」；十组负向对照 `0 真空`，门内另有 RH-08 空 onChange 注入对照。既有门复跑 `12/0`、`15/0`、`9/0`、`8/0`（RB-09 / RV-12 静态锚点一字未动）。真机清单 §2.3 / §7 的重启 workaround 已删。**残留见 §8.76.6**：`R-A3-6h` 只是部分关闭（设置界面 / 凭证明文 / 钥匙串仍开）、2s 轮询延迟、真机真公网仍零样本、SSE 仍不走隧道 |
| A3-12 | 中转凭证落盘加固（再部分关 R-A3-6h） | **已交付 · 接矩阵 G-88**，红绿见 `report.md` §8.77。发现仓库早有 `hosts/desktop/secret_vault.js`（GP-99~102：AES-256-GCM、`vault.json`/`vault.key` 均 0600、`resolve()` 唯一解密读口），**直接复用不另造加密**。新增 `hosts/shared/relay/relay_secrets.js`：`writeRelayConfigSecure()` 把两把 token 移进 vault、`relay.json` 只留 `box_token_ref`/`client_token_ref` 且 mode 0600、写完自检「查无明文」（M04 实测这条自检真能拦下夹带明文）；`loadRelayConfigSecure()` 三来源（引用 / 旧明文 / 环境变量），返回形状与老 `loadRelayConfig` **完全一致**，`main.js` 只换三处调用点；`inspectRelayConfigFile()` 查权限与明文。`main.js` 创建 vault（打包漏带则降级为 null，旧格式照常可用）。门 `prove_relay_secure_config.js` RS-01..RS-11 本机 `PASS=11 FAIL=0`；修复前红（最终门 + main.js 回退 A3-11 态）`PASS=10 FAIL=1`，十条全绿、只有 `RS-09 桌面接线缺了 7 处` 红；十组负向对照 `0 真空`（第一版 2 组真空是 mutation 没摘干净：M05 漏了 chmod 兜底、M06 只编了一把 dummy，已补齐）。既有门复跑 `12/0`、`15/0`、`9/0`、`11/0`、`8/0`。清单 §2.3 补安全格式转换命令。**残留见 §8.77.6**：`R-A3-6h` 仍未整条关闭（设置界面、OS 钥匙串仍开）、示例旧格式不主动转换仍是明文、真机真公网零样本、SSE 仍不走隧道 |
| A3-13 | 反向隧道 stream 并发上限与背压（再部分关 R-A3-8a） | **已交付 · 接矩阵 G-89**，红绿见 `report.md` §8.78。A3-9 让 pending 窗口用户态零持有字节，但「同时能挂多少条 pending」一直没上界：没人接的 CONNECT 各挂一个 2.5s 定时器 + 一条暂停 socket，内存/fd 不封顶。relay 加 `maxPendingStreams`（默认 64、每实例可配），超限直接 `NOBOX` + `stream-reject` 审计，不进 pending、不 pause、不挂定时器；诊断暴露 `pendingRejected` / `maxPendingStreams`。门 `prove_relay_stream_backpressure.js` BP-01..BP-09 本机 `PASS=8 FAIL=0`（5 条并发 + 假盒子回 PONG 不 ATTACH，三处反真空：上限内进 pending / 上限调大全进 / 超时释放后还能进）；修复前红（最终门 + relay_server.js 回退 A3-12 态）`PASS=4 FAIL=4`，七组负向对照 `0 真空`。**第一版基线红 3/5 有水份**：BP-03 用 `!== 0` 把「字段不存在」当成「被拒」，改 `> 0` 后才干净。既有门全绿 `11/0`、`11/0`、`9/0`、`15/0`、`12/0`、`6/0`、`6/0`、`8/0`。残留见 §8.78.6：默认 64 未在真公网压过、只测 5 条不是压测、已建立 ATTACH 连接数仍无上限、真 NAT 零样本 |
| A3-14 | 桌面中转设置面（再部分关 R-A3-6h） | **已交付 · 接矩阵 G-90**，红绿见 `report.md` §8.79。新增 `hosts/shared/relay/relay_settings.js`（掩码视图、**绝不回明文**；保存校验 + 留空沿用旧 token + 走 `writeRelayConfigSecure`；关闭写 `enabled:false`）；`preload.js` 三通道、`main.js` 三 handler 且保存后**主动**重登记；`index.html` 加配对弹窗入口卡片 + 独立 `#relay-settings-modal`（6 字段、两个 password 框永不预填、三语各 17 词条）。门 `prove_relay_settings.js` RS2-01..RS2-13 本机 `PASS=13 FAIL=0`（修复前红 `PASS=9 FAIL=2`：运行时八条全绿、只有 UI 接线两条红），十一组负向对照 `0 真空`。**最值钱的是一次真红的产品 IA 冲突**：第一版把表单塞进配对弹窗，`e2e_desktop_mobile_control` 报 `MC-02 这一屏还摆着令牌控件`（该屏硬要求零令牌控件、6 位码才是主路），改成「弹窗只留入口、表单独立」后 MC `15/0`，并补 RS2-13 钉住边界；另 M03 真空暴露 `main.includes` 全文搜被 disable handler 同款调用撑绿（同 A3-7 RB-09），改成切 saveBlock。既有门全绿：MC 15/0、ui_tokens 9/0 及九道 relay 门。残留见 §8.79.6：**`R-A3-6h` 仍未整条关闭（OS 钥匙串没接）**、独立弹窗未接 sheet 栈、三语未真机切语言验收、只做中转这一段设置、真机真公网零样本 |

**W4 判据现状（2026-11-03，A3-3 收口）**：路线 A 最后一波的目标是把跨网成功率从 0 抬到 ≥90%，
用户已拍板「仅自托管镜像、不做国内自建」。A3-1（中转镜像）已交付并接矩阵 **G-79**（`prove_cn_relay_image`
`PASS=6 FAIL=0`，红绿原文与诚实残留见 `report.md` §8.66）：一个 `node:22-alpine` 镜像，控制面
`relay-secret` 鉴权 + `REGISTER`/`CONNECT` 线协议 + 盲 TCP 转发（数据面结构性不落内容）+ HTTP `/healthz`，
满足「哑转发、不碰内容、不存密钥」。A3-2（内容不可见独立实证）已交付并接矩阵 **G-80**
（`prove_cn_relay_invisible` `PASS=6 FAIL=0`，红绿原文与诚实残留见 `report.md` §8.67）：中转加真实
元数据审计日志（`getAuditLog`），门禁跑完整透传证明「日志真实存在且查无明文正文/附件」（反真空通过）。
A3-3（客户端直连优先+回落）已交付并接矩阵 **G-81**（`prove_cn_connection_strategy` `PASS=6 FAIL=0`，
见 `report.md` §8.68）：共享 `connection_strategy` 纯逻辑证「可达即直连、不可达即回落、全不可达即离线」，
但 **Android/iOS 端上接线与界面渲染未做**（本机不可验证）、≥95% 成功率需真机统计。
A3-4（安装包体积不反弹）**阻塞**：前置基线已测（zip 83.6 MB / dmg 80.2 MB ≤ 85 MB 棘轮，但 zip 距棘轮仅
1.4 MB 余量），中转客户端尚未进包（依赖 A3-3 移动端接线），「进包后不反弹」现在测不了；PA-06/07 本机
因 Electron sandbox 失败属环境限制。故 W4 呈「A3-1/2/3 已交付（含诚实残留）、A3-4 阻塞待移动端接线」，
**不宣布 W4 完成**——真实跨网 ≥90% 仍需真机/真网络统计（R-A3-3a/b）。

## 3. 为什么顺序是这个（依赖关系，不是编号顺序）

- **W2 先于 W3**：通道先能跑，凭证改造才有可观测的验证场；反过来先改凭证，仍然只能验整轮回包。
- **T1-06（真单写者）先于任何事件开关默认开**：现在 actor 是机器/进程级（`event_mirror.js:589`），不是会话级，无串行锁。默认开 = 并发覆盖的风险，而 §7 要的是「`fold(log)` 一致率 100%」。
- **W3 的 A2-1 必须先于 A2-3**：先有登记通路，端上签名才有验签对象；否则签了也没人认。
- **W4 必须最后**：没有稳定凭证与通道就上中转，等于把现在「配不上对」的病搬到公网去。
- **T2（effect 契约）在 W3 之后、`client-core/` 之前**：reducer 要 fold 的东西必须带 `effect_id`，否则第二端必然漂移（F3 + F6 同时踩）。

## 4. 交付标准（本计划算完成的判据）

一个波次算完成，必须同时满足：矩阵全绿（无新增红、无把红改绿之外的松口子）；该波每片有红→绿原文在 `report.md`；`docs/user/*` 三份文档同步；残留清单更新且不含「应该能做到」这类未验证说法。

路线 A 整体算交付的判据是 §7 的四行指标同时达成：跨网成功率 ≥90%、吊销生效 ≤30 s、`fold(log)` 一致率 100%、安装包 ≤70 MB。现在这四项分别是 0 / 不支持 / 只有默认关的对账 / 85 MB 棘轮。

## 5. 已知残留（开工时就挂着的）

- 上一轮第二次全量矩阵在 G-53 处**静默终止**（无 `PASS=` 汇总行），`d65a3ed` 的本地全量矩阵未通过验证；CI 无 token 读不到。W1 期间必须重跑一次全量。
- 配对能力不在 `docs/capability-matrix.md` 的 234 行合同里，`docs/qa/product-readiness.md` 因此无法归类；补它需要 `.mbt` 具名测试。
- 64 条「仅测试可达」尚未接生产路径；非 100% 缩放；§8.51/GP-194 窄屏 140 px 横带；GP-134/136/137/139/141；真机与真凭证人工验收。

## 6. 残留总表（2026-11-03 · W4 收口后回填）

把散落在 W2/W3 表格与 `report.md` §8.65–§8.68 的残留收敛到一处，便于逐条认领与验收。
「可本机验证」= 当前这台机器（无 Android SDK / 真机 / KVM、Electron sandbox 受限、需 Xcode 模拟器）能否真跑出证据；
标「是」的遗留要么已被门禁钉住语义、要么只需数据层即可证；标「否/部分」的一律不伪造绿。

### 6.1 W2（看得见这一轮）残留

| 编号 | 一句话 | 现状 | 可本机验证 | 关闭条件 |
|---|---|---|---|---|
| R-A1-1 | `?session_id=` 只挡「看得见谁」，不挡「有权看谁」；同一 bearer 可订任意会话 | 仍开（授权主体属 A2-3 验签面） | 部分（Node 可证跨会话可订；「应否」需产品定义） | per-device 会话授权 |
| R-A1-2 | `/v1/turn` 回执 `host_results` 不含 AgentLoop 内 dispatch 的工具效果（`effects:0`） | 仍开 | 否（需 T2 effect 契约） | T2 带 `effect_id` 同批改 |
| R-A1-3 | 双写默认关（`BITBOT_EVENT_DUAL_WRITE`），关时诚实 503、端上回退整轮 | 有意为之 | 是（门已证 503/回退） | 等 W3 单写者 |
| R-A1-4a | 删 `awaitStreamReady` 的取舍：极快回合可能少 `turn_started`/首帧 | 仍开 | 否（需端上） | W3 显式游标协商 |
| R-A1-4b | A1-4 无设备级证据（本机无 KVM） | 仍开 | 否 | 真机走 §8.63 清单 |
| R-A1-4c | SSE 回调非主线程 RMW Compose 状态；丢更新未复现 | 仍开 | 否（需真机证据才动） | 真机复现后加 Mutex/Main.immediate |
| R-A1-4d | 会话名归一 `android-app`→`mobile-<kind>`，按会话翻历史分段 | 仍开 | 否 | W3 会话以回包真值为准 |

### 6.2 W3（账号=设备）残留

| 编号 | 一句话 | 现状 | 可本机验证 | 关闭条件 |
|---|---|---|---|---|
| R-A2-1 | 真机未验（W3 端上已实现、无设备级证据） | 仍开 | 否（无 KVM） | 真机清单（§8.64.10） |
| R-A2-6 | MC-13 花名册 UI 渲染（此前误判本机 SKIP） | **已关闭（2026-11-03 本机实跑 PASS=15 FAIL=0 SKIP=0）** | 是（macOS `hasDisplay` 恒 true） | — |
| R-A2-7 | `last_seen_at` 仅 device-key 路径触发，legacy bearer 不触 | 有意收紧 | 是（数据层已证） | 无需关（设计） |
| R-A2-8 | 无「取消登记 / 取消吊销」反操作 | 仍开 | 是（数据层语义未实现） | 需要时补 |
| R-A2-9 | 花名册只读登记表，不读在线心跳 | 语义限制 | 是 | 需要在线态再补心跳 |

### 6.3 W4（跨网可达）残留

| 编号 | 一句话 | 现状 | 可本机验证 | 关闭条件 |
|---|---|---|---|---|
| R-A3-1a | 控制面 TLS 未在本门实跑 | 仍开 | 否（需 cert） | 生产 cert 启用 |
| R-A3-1b | 端到端业务 TLS 不在本片 | 仍开 | 否 | 后续端到端加密 |
| R-A3-1c | `relay-secret` 共享准入密钥 | 设计取舍 | 是 | 密钥轮换/分发 |
| R-A3-1d | registry 仅内存 | 仍开 | 是（重启清空可测） | 持久化 |
| R-A3-1e | A3-2 独立实证未做 | **已关闭（§8.67 / G-80）** | 是 | — |
| R-A3-1f | 真 Docker build + 起容器 + 宿主可达 | **已关闭（2026-11-03，`prove_relay_docker.sh` PASS；顺带修真 bug：bind 127.0.0.1→0.0.0.0）** | 是（OrbStack docker） | 真公网仍待（R-A3-1a/b） |
| R-A3-2a | 「看不见」靠真实日志存在 + 查无明文（反真空通过） | 已实现（G-80） | 是 | — |
| R-A3-2b | 端到端业务 TLS 不在本片（=1b） | 仍开 | 否 | 同 1b |
| R-A3-2c | 日志落地明文 JSON（仅元数据），按 ADR 0014 约束 | 设计约束 | 是 | 部署侧权限/留存 |
| R-A3-2d | registry 仅内存、审计缓冲 10000 循环 | 仍开 | 是 | 外部采集 |
| R-A3-2e | EV-4 只扫受控临时目录 | 已知边界 | 是 | 扩大扫描（低优先） |
| R-A3-2f | 继承 R-A3-1a/b/c/d/f | 同上 | — | 同上 |
| R-A3-3a | 移动端 Android/iOS 中转接线与界面渲染 | **半开（2026-11-03 A3-5 关传输层、A3-6 关参数来源）**：Android 已有 `RelayTunnel`/`TunnelHttp`/`ConnectionStrategy` 且接进 `TurnBridge`（RT-01..RT-13 真跑），配对回执下发四栏后手机**已有参数可连**、状态条显示真实路径（RT-11..RT-13 / TS-01..TS-03 / PH-01..PH-05）。仍缺 ① 事件流 SSE 走中转（R-A3-5b）、② 手动填中转入口（R-A3-6a）、③ iOS 侧（需 Xcode）。闭法：SSE 走隧道 + iOS | 是（传输层 + 参数）/ 否（iOS） | 端上接线 |
| R-A3-3b | AC-T4-5 ≥95% 成功率需真机统计 | 仍开 | 否 | 真机统计 |
| R-A3-3c | QUIC 打洞（T4b）不在本片 | 仍开 | 否 | T4b |
| R-A3-3d | 「能连」≠「配对成功」 | 语义边界 | 是 | 无需关 |
| R-A3-3e | 端上各实现一套时需金标对齐 | 仍开 | 部分 | 端上金标测试 |
| R-A3-5a | 手机上没有填中转四栏的界面（只有 prefs / 环境变量） | **已关闭（2026-11-03 A3-6）**：不需要用户填了 —— 桌面在配对回执里下发四栏（`relay` 可选字段），手机解析后落 prefs（`PH-01..PH-05` / `RT-11..RT-13` 真跑）。「手动填」这个入口仍未做，单列为 R-A3-6a | 是 | — |
| R-A3-5b | 事件流 SSE 未走隧道（跨网进度按既有语义回退整轮模式） | **仍开（A3-6 没做，别当已交付）**：跨网时**回合**走中转，进度仍是诚实回退。`TunnelHttp` 只做定长/chunked 一次性响应，SSE 是不结束的 chunked 流，要先设计「隧道上读流 + 断线续订 + Last-Event-ID」 | 是（假 box 可测 chunked 长连接） | 需单独一刀 |
| R-A3-5c | 一 CONNECT 一隧道、无连接复用（每条消息多一次握手往返） | 设计取舍（A3-6 未动） | 是 | 与 R-A3-5b 同一刀量 |
| R-A3-6a | 手机无「手动填中转」入口：参数只能从配对回执来 | 仍开（A3-6 取舍） | 是 | 「配不上对就等于没配中转」——已配对的老用户要重配一次才拿到四栏 |
| R-A3-6b | 跨网每条消息多一次握手往返（含一次中转鉴权） | 设计取舍 | 是 | 与 R-A3-5c 合并，等 SSE 也走隧道后再量 |
| R-A3-6c | 真机跨网一次都没跑过（本机无 Android SDK / KVM） | 仍开 | 否 | 真机 + 真中继，归 R-A2-1 / R-A3-3b |
| R-A3-6d | 桌面侧没把中转四栏读进来（无设置面/无配置文件，只有 `BITBOT_RELAY_*` 环境变量） | **已关闭（2026-11-04 A3-7）**：`relay_config.js` 读 `data/desktop/relay.json`（文件 > 环境变量），`main.js` 把它接进 `relayHandoff`（RB-01/RB-02/RB-10/RB-11）。**仍没有设置界面** —— 那半条单列为 R-A3-6h | 是 | — |
| R-A3-6e | 桌面没有以 box 角色连中转做 `REGISTER`（仓库只有服务端 + 进程内 `registerBox`） | **已关闭（2026-11-04 A3-7）**：`relay_box_client.js` 真发 `AUTH`/`REGISTER` + 30s 心跳重登记（RB-03/RB-04/RB-07 真 socket），`ensureCnInbound` 接线（RB-09） | 是 | — |
| R-A3-6f | CI 上 `e2e_grok_desktop_boot` 里的 `moon run` 卡住不回（本机 1–2s，CI 25 分钟被杀） | 仍开（已加 240s 上限 + 诊断，红不再连坐） | 否（CI 环境） | 看下一跑的 `moon` 路径/stderr 尾部再定位 |
| R-A3-6g | **relay 是「它自己拨」到 box 登记的 host:port** ⇒ 云端 relay 拨不进 NAT 后面的桌面 | **已关闭（2026-11-04 A3-8）**：新增 `BIND`/`ACCEPT`/`ATTACH` 反向模式，relay 零主动拨、盒子只发起出站连接；`RV-05b` 用**同一个不可达端点**证「dial 断、reverse 通、`dialAttempts` 全程不涨」。旧 dial 路径保留给同网部署（G-84 / RV-01..RV-11） | 是（不可达端点等价建模） | **真公网 + 真 NAT 未实跑 → R-A3-8a** |
| R-A3-6h | vault 密钥仍在本机磁盘（非 OS 钥匙串） | **三次部分关闭（2026-11-05）**：A3-11 关「配置不热生效」、A3-12 关「凭证明文 + 宽松权限」、A3-14 关「没有设置界面」（`relay_settings.js` 掩码视图 + preload 三通道 + main.js 三 handler + 配对弹窗入口卡片 + 独立中转设置弹窗 + 三语，RS2-01..RS2-13，MC 门 15/0）。**仍开**：OS 钥匙串 | 是 | 钥匙串接入；2s 轮询延迟可按需换更快的通知机制；独立弹窗未接 sheet 栈 |
| R-A3-8a | 真公网 relay + 真 NAT 后面的桌面一次都没跑过；本机可做的四条健壮性已补 | **两次部分关闭**：A3-9 交付 relay 重启注入实测（RR-03）、`PING`/`PONG` 半开检测（RR-02）、`clientSock.pause()` 用户态零驻留（RR-05）；A3-13 交付 `maxPendingStreams` 并发上限（BP-01..BP-09）。**仍开**：真公网 + 真 NAT + 蜂窝网零样本、保活参数真 NAT 调参、已建立 ATTACH 连接数上限、真正的并发压测 | 部分（本机可测四条，真 NAT 不可） | 一台公网 relay + 一台 NAT 后桌面 + 蜂窝网手机跑 `real-device-checklist.md` §5 十条；另补数据面连接数上限与压测 |

**回填结论**：W2 七条、W3 五条、W4 二十条共 32 条残留，加 A3-6 新增六条（R-A3-6a/b/c/d/e/f）、A3-7 新增两条（R-A3-6g/h）**再加 A3-8 新增一条（R-A3-8a）共 41 条**里，
**可本机验证的**（R-A1-3、R-A2-7/8/9、
R-A3-1c/d、R-A3-2a/c/d/e、R-A3-3d、R-A3-5c）已在各门禁或数据层里钉住语义。**2026-11-03 本机补证又关两条**：
R-A2-6（MC-13 本机实跑 `PASS=15 FAIL=0 SKIP=0`，此前判 SKIP 是误判——`hasDisplay` 在 macOS 恒 true）、
R-A3-1f（真 Docker build + 起容器 + 宿主可达，`prove_relay_docker.sh` PASS，顺带修 bind 127.0.0.1→0.0.0.0
的生产级 bug）。加上 R-A3-1e（随 A3-2 关闭）、**R-A3-5a（随 A3-6 关闭：参数不再由用户填，改由配对回执下发）**、
**R-A3-6d 与 R-A3-6e（随 A3-7 关闭：桌面自己读配置、自己上线心跳）**、**R-A3-6g（随 A3-8 关闭：反向隧道）**，**共关闭 8 条**。真正卡住的只剩**真机 / 真公网 / cert /
移动端 SDK / T2 契约**：要推进「路线 A 整体交付」，仍需 ① 一台 Android 真机 + 真网络样本
（R-A2-1/R-A3-3a/b），或 ② 真公网 + TLS 控制面（R-A3-1a/b）。

**A3-5 之后补一句**：跨网这件事端上已经不是「零」了 —— 手机侧会 `AUTH`/`CONNECT`/`TUNNEL`、能在隧道上跑
`/v1/turn`（CI `193 用例 0 失败`、本机 `OK (10 tests)`）。但**还差最后一段用户能摸到的路**：配对回执不下发中转
参数、手机没有填中转的界面、事件流也没走隧道 —— 这就是下一刀 A3-6 的三件套（R-A3-5a/R-A3-5b + 配对走中转）。

**A3-6 之后补一句（2026-11-03）**：那条「用户能摸到的路」在**端上**通了 —— 配对成功时桌面把
`{host, port, box_id, client_token}` 四栏随回执下发（没配就不出现，回包逐字节不变），手机当场落 prefs，
回合结束后状态条显示的是**真实走过的那条路**（「已配对 · 中转 · 320ms」）。**但跨网本身仍不成立**，
而且缺口不在手机上：① **R-A3-6d** 桌面侧根本没把四栏读进来（只有 `BITBOT_RELAY_*` 环境变量，没设置面、
没落地配置）⇒ 普通用户跑起来回执里不会有 `relay`；② **R-A3-6e** 桌面没有以 box 角色连中转做 `REGISTER`
（仓库只有服务端 + 测试用的进程内 `registerBox`）⇒ 就算四栏配好，真跨网 `CONNECT` 也是 `NOBOX`；
③ **R-A3-5b** 进度事件流（SSE）仍走诚实回退。所以下一刀不该再去动手机，而是补桌面的
「配置 → 下发 → 登记」这一整段（R-A3-6d/e），再做 SSE 走隧道，最后才谈 ≥95% 成功率统计。
把「G-82 绿了」读成「跨网可以了」是这一刀最容易犯的错，所以这三条写进总表而不是脚注。

**A3-7 之后补一句（2026-11-04）**：上一条点名的那一段补上了 —— 桌面现在自己读
`data/desktop/relay.json`（文件优先、环境变量兜底）、自己以 box 角色 `AUTH`/`REGISTER`、30s 心跳重登记，
`ensureCnInbound()` 每次兑换现读配置（改完 JSON 不必重启即可**下发**；登记仍需重启 / 切开关，见 R-A3-6h），退出时停心跳。RB-01..RB-12 本机
`PASS=12 FAIL=0`，十一组负向对照逐个验过，见 `report.md` §8.72 —— R-A3-6d/e 关闭。

**但跨网仍然不成立，而且这次暴露的是一个更硬的结构问题（R-A3-6g）**：relay 的转发是**它自己拨**
到 box 登记的 `host:port`（`relay_server.js:89` 的 `net.connect`）。于是「relay 在公网、桌面在 NAT 后面」
这种最常见的部署**拨不进来** —— 不是配置错，是拓扑不对，闭法是反向隧道（box 持长连接、relay 把
CONNECT 的数据面喂给那条连接）。缺省 endpoint 只在「relay 与桌面同网络命名空间的宿主进程」下成立 —— 容器桥接网络里 `127.0.0.1` 是容器自己，`prove_relay_docker.sh` 只证了「宿主打得到容器」，没证「容器拨得到宿主」。
所以下一刀**不该再补配置面**（R-A3-6h 的设置界面、R-A3-6a 的手动填中转都排在它后面）：
先把 relay 拨不进 NAT 这件事解决，否则再多配置也只是把 `NOBOX` 换一种说法。

**A3-8 之后补一句（2026-11-04）**：上面点名的拓扑问题补上了 —— relay 现在有两条转发路径，
`dial` 原样保留、`reverse` 下盒子持 BIND 长连接、按需用出站 ATTACH 接回来，relay 全程零主动拨。
`RV-05b` 是最硬的一条：拿**同一个不可达端点** `192.0.2.1:1` 先证旧模式确实断、再证 reverse 确实通，
且 `dialAttempts` 全程 `2 → 2` 不涨；`RV-01/RV-10` 同时钉住旧模式没被改坏。手机端仍只收一行 `TUNNEL <label>`，
**这一刀没动任何 Android 代码，A3-6 的 APK 仍是当前端上版本**。R-A3-6g 关闭，见 `report.md` §8.73。

**但「拓扑成立」≠「跨网可用」**，而且这次的边界比上一刀更容易被误读：
① **默认仍是 `dial`** —— 不显式在 `relay.json` 写 `"mode": "reverse"`，NAT 后面的桌面照样拨不进去；
这半截属于设置面缺失（R-A3-6h），不是本片没做完转发。② 本机同宿主造不出真 NAT，用不可达端点
等价建模；**真公网 relay + 真 NAT 桌面 + 蜂窝网手机零样本**（R-A3-8a / R-A3-6c），
≥90% 成功率这句判据仍然一次都没量过。③ SSE 事件流仍不走隧道（R-A3-5b），
手机仍无手动填中转入口（R-A3-6a），`box_token` 仍明文落盘、运行中改配置仍不热登记（R-A3-6h）。
④ reverse 的断线重连只写了逻辑没做断网注入，每条 stream 两条出站连接的并发上限与背压未压测。

所以下一刀的优先级换了：不再是「补代码让某条路通」，而是**去真环境把这条路走一遍**
（R-A3-8a：一台公网 relay + 一台 NAT 后桌面 + 一台蜂窝网手机，按 `real-device-checklist.md` §4 逐条打勾）。
在那之前，SSE 走隧道（R-A3-5b）与设置面/热生效（R-A3-6h）都还在后面排队 ——
把「G-84 绿了」读成「跨网可以了」是这一刀最容易犯的错，所以这四条写进总表而不是脚注。

**A3-9 之后补一句（2026-11-04）**：上面那句「去真环境把路走一遍」仍是下一刀，
但排在这条路前面的**本机工作量已经清完了** —— A3-8 写完 reverse 时留在 `R-A3-8a` 里的
「断线重连只写了逻辑没实测」、以及 §8.73.6 ④ 的 pending 缓冲风险，都由 A3-9 补上：
半开有 `PING`/`PONG`（约 10s 发现）、relay 重启后盒子自己回来并把数据面重新打通（RR-03）、
等 ATTACH 的窗口里 relay 用户态不再持有业务字节（RR-05）。
`R-A3-8a` 因此**部分关闭**，剩下的只有「真公网 + 真 NAT 零样本」与「并发/背压压测」。

这一片最值钱的不是那 9 条绿，而是**第一版 4 组真空**：误踢被 120ms 的自动重连掩盖、
`pendingBufferBytes=0` 分不清「内核持有」与「字节读走丢了」、
手写 `a.resume()` 摘了门照样绿（冗余代码已删）、`c.pending` 兜底分支不可达（已移出已验证锚点、
单列盲区）。**门自己的失败方式也是证据**，这条从 A3-7 RB-12 一路到 A3-8 M02 再到这一片，
算是彻底定成规矩了。

所以下一刀依然不是补代码：① 真环境验收（真公网 relay + NAT 后桌面 + 蜂窝网手机，
按 `real-device-checklist.md` §4 逐条打勾，并顺手把 5s/2 次这组保活参数在真 NAT 上调一遍）；
② 之后才是 SSE 走隧道（R-A3-5b）与设置面 / 配置热生效 / 凭证钥匙串（R-A3-6h）。
**「G-85 绿了」仍然不等于跨网可用** —— 默认还是 dial，真机真公网依旧零样本。
