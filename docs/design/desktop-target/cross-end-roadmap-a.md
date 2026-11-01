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
| A1-1 | 服务端 `GET /v1/events?from_seq=<n>`（SSE，只读） | 复用 `event_log.readAfter`；**只加路由，不改任何既有响应体**；鉴权沿用当轮所选凭证体系，未鉴权一律 401 |
| A1-2 | 事件面：`turn_started`/`turn_progress`/`turn_finished` 三类最小集，带 `seq` | 不新造 kind —— 以 `docs/events.md` 已定义的为准；缺就先补契约再补码 |
| A1-3 | 断线重连：客户端带 `Last-Event-ID` 续订 | 验收原话「任意 seq 续订事件完整、有序」（AC-T1-9） |
| A1-4 | 端上消费：Android/iOS 各加一个只读 SSE 订阅，界面显示进度 | 拿不到就退回现有整轮模式，**不许静默丢事件**；每条都写进残留清单 |

W2 完成判据（对应 §7 指标）：手机发一轮，能在界面上看到 ≥3 次进度更新；拔网 10 s 重连后无重复无缺失。

### W3 让「账号 = 设备」真的成立（这一段就是用户问的「账号管理」）

顺序不能反：先让配对发的是设备凭证，再谈吊销；吊销必须能热生效。

| 片 | 内容 | 复现测试（先红） |
|---|---|---|
| A2-1 | `/v1/pair/redeem` 成功后**登记设备公钥**（端上生成密钥对，redeem 请求体带可选 `device_public_key`） | 门：配对完成 → `devices.json` 出现该设备；不带该可选字段的旧客户端仍按现合同工作 |
| A2-2 | `deviceStore` 热生效（按需重载或 ≤30 s TTL） | 门：revoke 一台 → 不重启入站服务，≤30 s 内该设备请求被拒，其他设备不受影响（AC-T4-4） |
| A2-3 | 端上真签名：把 `signTurn` 的等价实现下沉到 Kotlin/Swift | 集成门：真 HTTP 服务 + 真验签，覆盖 `missing_signature`/`bad_signature`/`stale_timestamp`/`nonce` 重放 |
| A2-4 | 消掉 `:854` 那颗地雷（登记非空 ⇒ 只发 Bearer 的端立刻 401） | 迁移期门：登记表非空 + 客户端只会 Bearer 时，给**可读的 401 文案 + 桌面侧提示**，而不是让它静默连不上 |
| A2-5 | 设备花名册 UI：桌面「移动端远程控制」里列出已登记设备（名称/机器类/最近活跃/吊销按钮） | 复用 `bitbot:pairing:*` IPC 面，只加可选字段与新 IPC 名 |

W3 不做：邮箱/密码/第三方登录、多用户组织架构、跨账号共享。二维码按 ADR 0014 仍排除在外。

### W4 跨网可达（把成功率从 0 抬起来）

局域网直连做不到 §7 的「跨网 ≥90%」，必须有一个内容不可见的中转。ADR 0014 已允许「只做流量转发 + 自托管镜像」，但落地前有一件必须人拍板的事：
`docs/next-target-requirements.md:381`「中转部署位置：国内自建（备案）还是仅提供自托管镜像？」**至今是未决策项**，
它决定合规路径与成本，不由代码单方面决定。本计划按「仅自托管镜像」推进（0014 §3 的原文口径），不替用户决策。

| 片 | 内容 |
|---|---|
| A3-1 | 中转服务的最小可运行镜像：一个 Dockerfile + 一个入口进程（成员凭证签发、公钥登记、转发、健康检查） |
| A3-2 | 内容不可见的实证：中转侧日志/抓包无明文正文与附件（AC-T4-3），做成门不是写成承诺 |
| A3-3 | 客户端直连优先、失败自动回落中转（局域网直连成功率 ≥95% 时界面显示「直连」，AC-T4-5） |
| A3-4 | 安装包体积：`prove_pack_artifacts.mjs` 现在棘轮 85 MB、目标 70 MB，中转客户端进包前先确认这条不反弹 |

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
