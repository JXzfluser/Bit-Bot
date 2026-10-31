# 下一阶段需求与任务拆解：本地优先 + 多端可达

> 状态：草案 v3（2026-10-29，含架构评审、任务拆解与借鉴点对照）
> 基线：`cursor/next-target-v1` @ `e6091f6`
> 对标：[AFK-surf/still.fail](https://github.com/AFK-surf/still.fail)
> 一句话：**借鉴它的「传输 + 客户端核心 + actor」，保留我们的「kernel 自有 loop + 宿主薄壳」。**
>
> **版本变化**：工作流统一为 `T0–T5`（原 `W0/W3/W2/W1` 与 `S0–S5` 合并，映射见 §4.1）；新增 §5 任务清单、§10 评审记录；**v3 补齐「每会话能力令牌」与「作业/服务」两条借鉴点**，并新增 §11 借鉴点对照表。

---

## 1. 定位与非目标

**定位**：Agent 跑在用户自己的机器上（本地优先），但可以从手机、网页、IM 到达；云端只负责身份与转发，不存会话内容。

**五条不做**（每条都有反面实证，见 §8）：

| 不做 | 理由 |
|---|---|
| 把宿主重写成 Rust / Tauri | still.fail 完整做过 Rust station，2026-10-04 整个删掉退回 TypeScript |
| 自研 UI 框架 | still.fail 的 mbui 约 42 万行 MoonBit、5 个 GPU 后端，仍标注 experimental |
| 全量 TypeScript 化 | 类型契约在 kernel；Host 全量 TS 会造出第二份类型真相 |
| 把 agent loop 外包给第三方 CLI | 这是与 still.fail 的核心差异，不能丢 |
| 引入 SaaS 账号体系 | 沿用既有拍板：**账号 = 设备密钥对** |

---

## 2. 现状基线（需求从这里长出来）

| 能力 | 现状 | 文件 |
|---|---|---|
| 设备身份 | ed25519 每设备一对密钥，Box 只存公钥，签名覆盖 device_id/时间戳/nonce/请求体；登记表为空时回落共享 turn token | `hosts/shared/device_keys.js` |
| 机器种类 | `desktop / ios / android / box / cloud` 已定义 | `hosts/shared/machine_identity.js` |
| 无头宿主（station 等价物） | 常开 Node 进程：内核二进制 + Host FFI + 入站 HTTP + 定时调度 | `hosts/shared/box_main.js` |
| 入站 | HTTP `/v1/turn`、`/v1/approvals`，Bearer 鉴权，默认 `127.0.0.1:18765` | `hosts/shared/cn_inbound_server.js` |
| 回合执行 | **每轮 spawn 一个进程** | `hosts/shared/run_moon_turn.js:87` |
| 状态存储 | `data/desktop/*.json`，tmp+rename 原子写；跨进程文件锁；**14 个文件直接写 `data/`** | `hosts/desktop/product_surface.js` 等 |
| 调度 | `setInterval` 扫描，进程内计时 | `hosts/shared/routine_scheduler.js` |
| effect 分发 | 30+ 个 `kind` 内联在约 1.87 万行里 | `hosts/shared/host_ffi.js` |
| 客户端边界 | 约 100 个 IPC 方法 | `hosts/desktop/preload.js` |
| 协议层（可复用种子） | 纯协议模块，main 与 renderer `require` 同一份 | `hosts/desktop/progress_protocol.js` |
| 语义 UI | `ui_protocol` 消息类型（kernel 侧） | `ui_protocol/` |

---

## 3. 目标态架构

**原则：最优点不是概念最多，而是让后续每个需求（重连、多端、云端、崩溃恢复）都成为不变量的推论。**

### 3.1 六个概念

| # | 概念 | 职责 |
|---|---|---|
| 1 | **Kernel** | 纯规划：输入状态与消息，输出 `events` + `effects`，不做任何 I/O |
| 2 | **Session Log** | 每会话一条追加日志（SQLite WAL；Node 26 内置 `node:sqlite`，零依赖），状态 = 折叠日志 |
| 3 | **Effect Bus** | 声明式 effect + 执行器注册（能力表）；同进程函数表，跨机才走传输 |
| 4 | **Transport** | 统一契约 `send(command)` / `subscribe(from_seq)`；实现有 IPC / HTTP+SSE / QUIC |
| 5 | **Client Core** | schema + reducer + 缓存 + 乐观命令；UI 壳只渲染 |
| 6 | **Cloud** | 身份、成员、中转、推送；内容不可见 |

### 3.2 数据形态

```sql
events (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
        turn_id TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL,
        actor TEXT, ts INTEGER NOT NULL)

effects (id TEXT PRIMARY KEY,          -- turn_id + "/" + index，计划时生成
         kind TEXT, target TEXT,       -- machine_id 或 "local"
         approval TEXT,                -- auto | ask | never
         idem_key TEXT UNIQUE, deadline_ms INTEGER,
         status TEXT, result TEXT)
```

`effect_id` 由 kernel 在计划时确定性生成（`turn_id/idx`），重放与重试天然幂等——比在 Host 侧事后去重可靠。

### 3.3 七条不变量（必须机制化）

- **I1** Kernel 不做 I/O；所有副作用都是声明式 effect。
- **I2** 每会话单写者（actor）；所有状态变更都是带单调 `seq` 的日志追加。
- **I3** 任何客户端可从任意 `seq` 续订；事件不可变、可重放。
- **I4** effect 至少一次投递 + 幂等键；破坏性 effect（`mail_send`/`purchase`/`source_control`）必须带审批事件，按 `idem_key` 去重。
- **I5** 身份是密钥（ed25519），不是 payload；`machine_id` 由密钥派生。
- **I6** 内容留在 station；云端只见元数据与密文。
- **I7** 协议有版本与能力协商；新客户端可连旧服务，旧客户端可降级而非崩溃。

### 3.4 命令 / 事件词表（要小）

- **command（约 12 个）**：`user_message` `approve` `deny` `cancel_turn` `create_bot` `update_bot` `create_room` `send_room_message` `set_setting` `start_job` `stop_job` `ack`
- **event（约 14 个）**：`session_created` `turn_started` `delta` `progress` `message_committed` `approval_requested` `approval_decided` `effect_started` `effect_finished` `turn_ended` `job_started` `job_output` `job_ended` `presence_changed`

规则：**客户端只能发 command、只能读 event；任何 UI 状态都能由 fold(event) 得到。** `delta` 不落库（只留 in-flight 缓冲与最终消息）。

### 3.5 迁移总览

```
T0 交付基线 ────────────────────────────────────────┐ 可并行
T1 状态底座 (S0 日志 → S1 actor) ── T2 effect 契约 ──┼── T3 客户端核心 (S3) ── T4 远端可达 (S4→S5)
                                                     └── T5 作业与服务（依赖 T1/T2，与 T4 并行）
```

每步出口条件：`prove_*` + `smoke_grok_desktop_parity` 全绿，**且旧客户端仍能连**（滚动升级）。

---

## 4. 需求规格

> 编号规则：`T<工作流>-FR<n>` 为需求，`T<工作流>-<nn>` 为任务（见 §5），`AC-*` 为验收。

### 4.1 工作流与历史编号映射

| 工作流 | 覆盖 | 原编号 |
|---|---|---|
| **T0 交付基线** | 打包瘦身、内核入包 | `W0` |
| **T1 状态底座** | 事件日志、单写者、恢复 | `W3` + `S0/S1` |
| **T2 effect 契约** | target / 幂等 / 审批等级 | `S2`（原 W3 一部分） |
| **T3 客户端核心** | client-core、命令/事件词表 | `W2` + `S3` |
| **T4 远端可达** | HTTP/SSE → QUIC → 云身份与中转 | `W1a/W1b` + `S4/S5` |
| **T5 作业与服务** | 常驻作业、日志、端口、恢复 | 新增（借鉴点 5） |

### 4.2 T0 · 交付基线

| ID | 需求 |
|---|---|
| T0-FR1 | `electronLanguages: ["zh-CN","en-US"]`，排除 `LICENSES.chromium.html`、`*.map`，`compression: "maximum"` |
| T0-FR2 | 打包脚本产出 `resources/kernel/bin/desktop_turn[.exe]` 并在打包后校验；缺工具链时给出明确失败信息 |
| T0-FR3 | 打包产物在无源码树的机器上可启动并完成一轮对话 |

**AC**
- AC-T0-1：安装包 ≤ 70 MB，冷启动无差异。
- AC-T0-2：删除源码树后仍能跑一轮（内核在包内）。
- AC-T0-3：缺 MSVC 时打包**失败并提示原因**，不产出半成品。

### 4.3 T1 · 状态底座

| ID | 需求 |
|---|---|
| T1-FR1 | 每会话一条追加日志，单调 `seq`；状态由日志折叠得到 |
| T1-FR2 | 每会话单写者（actor）；同会话所有状态变更串行 |
| T1-FR3 | 入站先落盘再 ack；按 `idem_key` 幂等去重 |
| T1-FR4 | 调度器持久化 `next_run_at` + 租约 claim，重启不重复不丢失 |
| T1-FR5 | 常驻内核进程替代每轮 `spawn` |
| T1-FR6 | 客户端可从任意 `seq` 续订 |
| T1-FR7 | 每会话持有独立能力令牌（capability token）：工具端点按令牌识别会话，令牌作用域限定该会话 |

**AC**
- AC-T1-1：群聊一回合 @3 个 Bot，进程创建次数 = 0。
- AC-T1-2：`kill -9` 后重启，在途回合状态正确，重复投递 = 0，定时任务不重复。
- AC-T1-3：`fold(events)` 与迁移前 JSON 快照逐字段相等（sessions / rooms / approvals 三类）。
- AC-T1-4：并发写压测（10 并发 × 100 次）无丢失、无覆盖。
- AC-T1-5：首 token 延迟下降 ≥100 ms。
- AC-T1-6：持有 A 会话令牌的工具调用无法读写 B 会话（返回拒绝且留审计行）。

### 4.4 T2 · effect 契约

| ID | 需求 |
|---|---|
| T2-FR1 | effect 携带 `id / kind / target / approval / idem_key / deadline` |
| T2-FR2 | `effect_id` 由 kernel 计划时确定性生成（`turn_id/idx`） |
| T2-FR3 | Host 侧执行器注册表；30+ 个 `kind` 全部走注册表 |
| T2-FR4 | `approval_class` 从 `main.js` 的 AUTO 名单迁入 effect 契约 |
| T2-FR5 | effect 结果以 `effect_finished` 事件回写，同 `idem_key` 只产生一次外部副作用 |
| T2-FR6 | effect 的会话/机器人身份取自**回合上下文**而非 payload；跨会话操作必须显式声明 capability 并写审计 |

**AC**
- AC-T2-1：同一回合重放两次，生成的 `effect_id` 完全相同。
- AC-T2-2：`mail_send` 用 mock 计数，重复投递 3 次只发出 1 封。
- AC-T2-3：`purchase` / `source_control` 未获审批时执行次数 = 0。
- AC-T2-4：`prove_*` 与 smoke 全绿（行为不变）。
- AC-T2-5：payload 里伪造别的 `session_id` / `bot_id` 时，effect 按当前回合身份执行或被拒绝，绝不越权。

### 4.5 T3 · 客户端核心

| ID | 需求 |
|---|---|
| T3-FR1 | `client-core/` 无 DOM、无 Electron 依赖，可在 Node 与浏览器运行 |
| T3-FR2 | 单一 schema：会话/Bot/群聊/消息/进度只定义一次，与 `ui_protocol` 对齐 |
| T3-FR3 | 传输适配器接口 `send(op)` / `subscribe(from_seq)`；首批实现 IPC |
| T3-FR4 | renderer 改为消费 core，UI 层只渲染与本地交互态 |
| T3-FR5 | 协议层（`progress_protocol` / `secret_protocol` / `link_discipline`）归入 core 并开 `checkJs` |
| T3-FR6 | core 内置断线重连与事件去重（按 `seq`） |

**AC**
- AC-T3-1：同一份 core 在 Node 测试与 Electron 中通过同一组协议测试（≥30 条）。
- AC-T3-2：renderer 中不再有直接 `fetch` / 文件系统访问。
- AC-T3-3：`tsc --noEmit`（`checkJs`，仅 core + 协议文件）零错误。
- AC-T3-4：功能回归：会话、群聊、审批三按钮、进度行、附件、设置全部一致。

### 4.6 T4 · 远端可达

**T4a 云端只做身份与转发**

| ID | 需求 |
|---|---|
| T4a-FR1 | 云服务只做：成员凭证签发、设备公钥登记、流量转发；**不落内容** |
| T4a-FR2 | 复用 ed25519 设备密钥，不新建账号体系 |
| T4a-FR3 | 客户端经中转与 station 建立长连接，服务端只转发密文 |
| T4a-FR4 | 客户端显示连接方式（直连/中转）与延迟 |
| T4a-FR5 | 吊销设备后 ≤30 s 断开 |

**T4b 点对点直连**

| ID | 需求 |
|---|---|
| T4b-FR1 | QUIC 打洞（iroh 或等价），直连优先，打不通回落中转 |
| T4b-FR2 | 配对：桌面生成邀请（二维码/短码）→ 手机扫码登记公钥 |
| T4b-FR3 | 流式事件走同一通道 |
| T4b-FR4 | HTTP `/v1/turn` 作为兜底保留 |
| T4b-FR5 | 中转可自托管，日志无明文 |

**AC**
- AC-T4-1：手机在移动网络下连接家庭宽带机器，完成一轮对话并收到流式输出。
- AC-T4-2：拔网重连 ≤5 s，会话不丢不重。
- AC-T4-3：中转抓包/日志无明文正文与附件。
- AC-T4-4：吊销单设备不影响其他设备。
- AC-T4-5：局域网直连成功率 ≥95%，界面显示「直连」。

---

### 4.7 T5 · 作业与服务

> 现状：`routine_scheduler.js` 只做「到点跑一次」，缺「常驻服务」形态。

| ID | 需求 |
|---|---|
| T5-FR1 | 作业可跨 turn 存活：`start / list / log / stop`，关闭所有客户端不影响 |
| T5-FR2 | 作业有端口、日志、退出码；结束以 `job_ended` 事件回写 |
| T5-FR3 | 重启恢复策略显式声明（不自动重启 / 自动重启）；孤儿进程必须清理 |
| T5-FR4 | 日志有界（环形缓冲 + 截断），不得撑爆磁盘 |

**AC**
- AC-T5-1：起一个 5 分钟作业，关掉所有客户端仍跑完并回报。
- AC-T5-2：日志超过上限后只保留尾部，磁盘不再增长。
- AC-T5-3：station 重启后无孤儿进程；按声明恢复。
- AC-T5-4：作业端口可查询，且不默认对外监听。

---

## 5. 任务清单（可直接建 issue）

> 粒度：0.5–2 人日/条；每条都能独立合并、独立回滚。
> 状态列：`未开始` / `进行中` / `阻塞` / `完成`。
> 通用 DoD：改动不破坏 `prove_*` 与 `smoke_grok_desktop_parity`；新增逻辑必须有对应断言。

### 5.1 T0 交付基线（约 1 天）

| ID | 任务 | 依赖 | 规模 | 完成定义 |
|---|---|---|---|---|
| T0-01 | electron-builder 瘦身：语言包、LICENSES、map、最大压缩 | — | 0.5d | `npm run dist` 产物 ≤70 MB；启动冒烟通过 |
| T0-02 | 内核入包校验：`pack-desktop.sh` 产物检查 + 启动自检 | — | 0.5d | 删除源码树后可跑一轮；缺 MSVC 时构建失败且信息可读 |
| T0-03 | 打包 CI 门禁：产物体积 + 内核存在 + 退出码 | T0-01,02 | 0.5d | CI 在体积超限或缺内核时红灯 |

### 5.2 T1 状态底座（约 6–8 天）

| ID | 任务 | 依赖 | 规模 | 完成定义 |
|---|---|---|---|---|
| T1-01 | 定义事件模型：`kind` 全集、payload schema、seq 语义 | — | 0.5d | 产出 `docs/events.md`；每个 kind 有示例 |
| T1-02 | SQLite 适配器骨架：`node:sqlite` + WAL + migrations | T1-01 | 1d | 可建库/开库/迁移；零原生依赖；Node 26 下跑通 |
| T1-03 | 双写旁路：现有写入点同时写 events（不改行为） | T1-02 | 1d | `fold(events)` 与 JSON 快照逐字段相等（sessions/rooms/approvals） |
| T1-04 | 读切换：`product_surface` 从 events 派生 | T1-03 | 1d | 关闭双写后 smoke 全绿 |
| T1-05 | 停写 JSON + 旧数据导入脚本 | T1-04 | 0.5d | 旧 `data/` 可一键迁移；迁移幂等 |
| T1-06 | actor 化：每会话单写者，14 个写入点收敛到 1 | T1-05 | 1–2d | 并发压测无覆盖；`kill -9` 恢复正确 |
| T1-07 | 内核常驻进程（行协议复用），替代每轮 spawn | — | 1d | 群聊 3 Bot 进程创建 = 0；崩溃自动重启并标记在途回合 |
| T1-08 | 调度持久化：`next_run_at` + 租约 claim | T1-06 | 0.5d | 重启后不重复不丢；手工改表可验证 |
| T1-09 | 游标读取 API：`subscribe(from_seq)` 服务端实现 | T1-06 | 0.5d | 任意 seq 续订事件完整、有序 |
| T1-10 | 每会话能力令牌：签发、轮换、按令牌识别会话 | T1-06 | 0.5d | A 令牌不能读写 B 会话；轮换后旧令牌失效 |

> T1-07 与 T1-02..06 无交集，可先做（性能收益立竿见影）。

### 5.3 T2 effect 契约（约 3 天）

| ID | 任务 | 依赖 | 规模 | 完成定义 |
|---|---|---|---|---|
| T2-01 | effect 结构体双侧改造（kernel + host） | T1-01 | 0.5d | 旧调用点全部编译通过；字段可观测 |
| T2-02 | kernel 生成确定性 `effect_id`（`turn_id/idx`） | T2-01 | 0.5d | 同回合重放两次 id 相同（断言） |
| T2-03 | Host 执行器注册表，包装现有 30+ kind 分发 | T2-01 | 1d | 全 kind 走注册表；行为不变 |
| T2-04 | `approval_class` 迁入契约，删除 `main.js` AUTO 名单 | T2-03 | 0.5d | 三档策略只在一处定义；负向用例通过 |
| T2-05 | 结果回写 `effect_finished` + 幂等测试 | T2-03, T1-03 | 0.5d | `mail_send` mock 计数：3 次投递 = 1 封邮件 |
| T2-06 | effect 身份绑定：会话/机器人取自回合上下文，跨会话走 capability + 审计 | T2-03, T1-10 | 0.5d | payload 伪造 session/bot 不越权；审计行可查 |

### 5.4 T3 客户端核心（约 6 天）

| ID | 任务 | 依赖 | 规模 | 完成定义 |
|---|---|---|---|---|
| T3-01 | `client-core/` 骨架：无 DOM/Electron，Node 可跑 | T1-01 | 0.5d | Node 下可 import 并跑通空 reducer |
| T3-02 | schema 单点定义（对齐 `ui_protocol`） | T3-01 | 1d | 与 kernel 消息类型有一一对应表 |
| T3-03 | reducer：fold(events) → UI state | T3-02 | 1d | 录制一份真实会话日志，fold 结果与现网 UI 一致 |
| T3-04 | transport 接口 + IPC adapter | T3-03 | 1d | 桌面功能不回归 |
| T3-05 | renderer 接入：先对拍后切换 | T3-04 | 1–2d | 对拍期零差异；切换后 smoke 全绿 |
| T3-06 | 断线重连与去重（`from_seq`） | T3-04 | 0.5d | 拔网 10 s 重连无重复无缺失 |
| T3-07 | `checkJs` 门禁（core + 协议层） | T3-01 | 0.5d | `tsc --noEmit` 零错误；CI 接入 |

### 5.5 T4 远端可达（约 7–9 天）

| ID | 任务 | 依赖 | 规模 | 完成定义 |
|---|---|---|---|---|
| T4-01 | HTTP+SSE transport（服务端 `from_seq` 续订） | T3-06 | 1d | 断线重连增量正确 |
| T4-02 | 轻量 web 客户端（复用 core，只做聊天+审批） | T4-01 | 1–2d | 浏览器里完成一轮对话与一次审批 |
| T4-03 | 配对流程：二维码/短码 + 公钥登记 + 吊销 | T4-01 | 1d | 扫码加入；吊销后 ≤30 s 拒绝 |
| T4-04 | QUIC 绑定选型 spike（napi 插件 vs sidecar） | — | 1d | 一页对比结论（性能、崩溃隔离、打包体积） |
| T4-05 | QUIC adapter + 中转回落 | T4-04, T4-01 | 2d | 跨网直连成功；打洞失败自动回落 |
| T4-06 | 云身份 + 中转（内容不可见） | T4-05, 合规结论 | 2d | 中转日志无明文；密钥轮换可用 |

### 5.6 T5 作业与服务（约 3 天）

| ID | 任务 | 依赖 | 规模 | 完成定义 |
|---|---|---|---|---|
| T5-01 | 作业表 + 生命周期（`start/list/log/stop`） | T1-06 | 0.5d | 作业记录跨 turn 存活；状态可查 |
| T5-02 | 进程组管理 + 日志环形缓冲（截断 + 尾部 N KB） | T5-01 | 1d | 关客户端后作业继续；日志不超上限 |
| T5-03 | `job_*` 工具与事件（`job_started/output/ended`） | T5-02, T2-01 | 0.5d | 结束以事件回写；端口可查询 |
| T5-04 | 重启恢复与孤儿进程清理 | T5-02 | 1d | 重启后按声明恢复；无残留进程 |

### 5.7 建议的第一批 issue（本周可就动手）

1. **T0-01** 打包瘦身（0.5d，零风险，立刻可见）
2. **T1-07** 常驻内核进程（1d，性能最痛点）
3. **T1-01** 事件模型定义（0.5d，解锁 T1/T2/T3 全部）
4. **T1-02** SQLite 适配器（1d）
5. **T4-04** QUIC 选型 spike（1d，与上面并行，先出结论不写代码）

### 5.8 任务模板（新增任务请照此写）

```markdown
### T?-NN 标题
- 依赖：T?-NN / —
- 规模：0.5d / 1d / 2d
- 触点：hosts/...、cmd/...、docs/...
- 完成定义：<可执行的验收命令或断言>
- 风险：<已知风险 + 回滚方式>
```

---

## 6. 里程碑

| 里程碑 | 内容 | 出口条件 | 预估 |
|---|---|---|---|
| **M0** | T0 全部 | 安装包 ≤70 MB，内核在包内 | 1d |
| **M1** | T1 全部 | 单写者 + 日志 + 常驻内核；恢复测试通过 | 6–8d |
| **M2** | T2 全部 | effect 可幂等重放；审批策略单点 | 3d |
| **M3** | T3 全部 | core 在 Node/Electron 同测通过 | 6d |
| **M4** | T4a | 手机跨网可用（中转） | 3–4d |
| **M5** | T4b | 直连成功率 ≥95% | 3–5d |
| **M6** | T5 全部（可与 M4/M5 并行） | 作业跨客户端存活；无孤儿进程 | 3d |

**为什么不是先做 T4**：没有 client-core 就先接手机，等于把 renderer 的协议与状态机复制一份，两套都要维护。

---

## 7. 度量

| 指标 | 基线 | 目标 |
|---|---|---|
| 单回合进程创建次数 | 1（群聊 N 个 Bot 为 N） | 0 |
| 首 token 延迟 | 待测 | 下降 ≥100 ms |
| 安装包体积 | 约 90 MB | ≤70 MB |
| 崩溃后重复投递 | 未知 | 0 |
| 手机连接成功率（跨网） | 0（仅局域网） | ≥90%（含中转） |
| 设备吊销生效时间 | 不支持 | ≤30 s |
| `fold(log)` 与快照一致率 | — | 100%（三类数据） |
| 跨会话越权尝试成功数 | 未知 | 0（有审计行） |
| 作业跨客户端存活率 | 0（无此形态） | 100% |

---

## 8. 反面清单（为什么不做）

1. **重写宿主为 Rust/Tauri**：still.fail 的 station 从 Node/TS 完整迁到 Rust、删掉 Node，随后在 2026-10-04 **把 Rust station 整个删除**，退回 TypeScript on Node，只保留 launcher / runner / mesh 三个预编译件（见其 `docs/station-rust.md` 与 `docs/design.md`）。
2. **自研 UI 框架**：still.fail 的 mbui 是 1234 个 `.mbt`、约 42 万行，自己实现 flexbox、UAX#14/#29/#9 文本与 5 个 GPU 后端，官方标注 experimental。我们用 HTML/CSS 取得同等多端一致性，成本低两个数量级。
3. **全量 TS**：只允许 `client-core/` 与协议层用 `checkJs`；`main.js` 其余部分保持 JS，类型契约继续留在 kernel。
4. **外包 agent loop**：still.fail 依赖用户预装并登录 Claude Code / Codex，且「runtime 创建后不能换」。我们的 kernel 自己拥有 loop，这是不可交换的差异。
5. **过度抽象**：不做 CRDT（一个会话只有一个写权）；不做消息中间件（effect bus 是同进程函数表）；不持久化 token 增量；不按域拆库；不把审批策略留在 `main.js`。

---

## 9. 开放问题

> **定调结论见 [ADR 0014](adr/0014-cross-end-direction.md)（2026-10-31）**：下列问题已收敛为决策或明确「不做/延后」，其中 Q2（中转合规）、Q3（手机端形态）两处仍待产品/合规签字。

1. **QUIC 绑定形态**：Node 原生插件（同 still.fail 的 `native/mesh`）还是独立 Rust sidecar？前者集成简单，后者崩溃隔离好。→ 由 T4-04 spike 回答。
2. **中转部署位置**：国内自建（备案）还是仅提供自托管镜像？关系到「开箱即用」与合规成本。→ T4-06 前置。
3. **手机端形态**：先做 PWA（复用 client-core）还是原生壳？PWA 拿不到后台常驻与推送。→ T4-02 顺带验证。
4. **多机协作**：`machine_identity` 已有 kind，但还没有「机器间任务转交」协议。→ 暂不纳入本轮。
5. **桌面内置 station**：桌面端是否像 still.fail 那样以 `--with-parent` 内嵌一个 station 子进程，已有实例在跑时复用。→ 与 T1-06 一并决定。
6. **无 MSVC 环境**：CI 是否引入 wasm 内核分支以绕开 Windows 原生工具链。→ T0-02 中决策。

---

## 10. 评审记录（2026-10-29）

### 10.1 八个结构性缺口

| # | 缺口 | 代码证据 | 后果 |
|---|---|---|---|
| F1 | **无事件日志与单调序号** | 状态只存在 JSON 快照；`turn_json.mbt` 有 `turn_id`，全链路没有 `seq` | 重连、多端同步、去重、崩溃恢复失去真相来源 |
| F2 | **状态写入者不唯一** | 14 个文件直接写 `data/`；`product_surface.js` 管 9+ 个 JSON | 跨文件撕裂；Electron/box/CLI 互相覆盖 |
| F3 | **effect 没有契约字段** | `host_ffi.js` 约 1.87 万行、30+ kind 内联 | 多机无法路由；重试重复发信/购买；审批策略散落 |
| F4 | **审批与 UI 耦合** | 10 分钟过期、需在线客户端、靠 `--approved` 重跑 | 手机不在线即卡住；跨端不可用 |
| F5 | **流式绕过状态模型** | `broadcast("bitbot:llm-stream")` 无 seq | 重连丢增量 |
| F6 | **客户端无核心** | `preload.js` 约 100 个 IPC 方法 | 第二个客户端必然漂移 |
| F7 | **协议无版本协商** | 只有 `v:1`，无 hello/caps | 独立升级无降级路径 |
| F8 | **附件/密钥边界** | `data:` URI 内联；vault 密钥 Host 本地生成 | 同步与云化都会爆 |

### 10.2 对本轮结论的影响

- v1 的 `W2-FR6` 曾要求「按 turn_id + seq 去重」，而 seq 当时并不存在——**这是 v1 的硬伤**，v2 已把 Session Log 提到 T1，作为前置。
- 「每个会话一个 actor」升级为「actor + 追加日志」，否则 actor 只是换了个锁。
- 中转要能按事件转发，必须先有 command/event 词表（T3），否则云端只能转发整包 HTTP，续传无从谈起。

### 10.3 变更记录

| 日期 | 版本 | 变化 |
|---|---|---|
| 2026-10-29 | v1 | 初稿：四条工作流（W0/W1/W2/W3）+ 里程碑 |
| 2026-10-29 | v2 | 合并为 T0–T4；新增目标态架构、任务清单、任务模板、评审记录；修正 seq 依赖 |
| 2026-10-29 | v3 | 补 T1-FR7/T1-10（每会话能力令牌）、T2-FR6/T2-06（effect 身份绑定）、T5 作业与服务（4 需求 + 4 任务）；新增 §11 借鉴点对照表 |

---

## 11. 借鉴点对照表（still.fail → 本文档）

| # | 借鉴点 | still.fail 做法 | 本文档落点 | 状态 |
|---|---|---|---|---|
| 1 | **P2P 传输替代「局域网 + token」** | iroh：身份即公钥、NAT 打洞、失败回落 relay | `T4b-FR1/FR2`、`T4-03/04/05`；不变量 I5 | ✅ 完整（T4b） |
| 2 | **云只管人、不碰内容** | Cloudflare Workers 只签发成员凭证 + 转发；会话在 station 的 SQLite | `T4a-FR1/FR3`、`T4-06`；不变量 I6；云端只处理元数据与密文 | ✅ 完整（T4a） |
| 3 | **一个客户端核心、多端复用** | web 直接跑 `core-ts`；Android/macOS 编成 `core.hbc` 塞进 Hermes | `T3-FR1..FR6`、`T3-01..T3-07` | ✅ 完整（T3） |
| 4 | **每会话 actor + token 隔离** | 每会话一个串行 actor；MCP 按 token 识别会话，"agent 无法冒充其他会话" | actor：`T1-FR2`、`T1-06`；**token 隔离：`T1-FR7`、`T1-10`、`T2-FR6`、`T2-06`** | ⚠️ v2 只有 actor，**v3 已补齐令牌与身份绑定** |
| 5 | **turn 结束后仍在跑 job/service** | `job_start / job_list / job_log / job_stop`，有端口、日志、结束回报 | `T5-FR1..FR4`、`T5-01..T5-04`；事件词表 `job_*`（§3.4） | 🆕 v2 只有词表，**v3 已补需求与任务** |

**核对结论**：五条借鉴点现已全部落到「需求 ID + 任务 ID + 验收」，其中第 4、5 条是 v3 新增；第 4 条的 token 隔离与既有不变量 I5「身份来自凭证而非 payload」是同一原则的两处体现（设备级 / 会话级）。
