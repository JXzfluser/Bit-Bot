# ADR 0014 — 跨端定调：一个客户端核心，内核自持 loop，云只转发

- 状态：**Proposed**（2 处需产品/合规签，见 §6）
- 日期：2026-10-31
- 关联：`docs/next-target-requirements.md`（T0–T5 需求与任务）、ADR 0008（远端回合鉴权）、`docs/design/desktop-target/pairing-v1.md`、`docs/agent-core/README.md`（L6 目标）
- 实现（规划中）：`client-core/`、`hosts/shared/{session_log,transport}.js`、`hosts/shared/device_keys.js`（已有）、`hosts/shared/cn_inbound_server.js`
- 门禁（规划中）：`prove_*` + `smoke_grok_desktop_parity`；新增 T3/T4 断言

## 背景：定调对象是「缺口」，不是「再加一个端」

`docs/next-target-requirements.md` 已完成需求拆解（T0–T5、任务、验收、里程碑），但 §9 的六个开放问题没锁，导致 T3/T4 开工没有单一方向。本 ADR 只做一件事：**把方向钉死、把开放问题收敛成决策、把本轮范围划清**，不重复需求清单。

真实现状（已经能用的底子，不要重做）：

| 能力 | 现状 | 证据 |
|---|---|---|
| 设备身份 | 每设备一对 ed25519；Box 只存公钥；签名覆盖 device_id/ts/nonce/body；按设备吊销；登记表空时回落 turn token | `hosts/shared/device_keys.js` |
| 机器身份 | 来自凭证（device_id），不信 payload；`BITBOT_MACHINE_ID` 可覆盖 | `hosts/shared/machine_identity.js` |
| 配对 v1 | 局域网 discover（`GET /v1/pair/discover`）+ 6 位短码换 token（`POST /v1/pair/redeem`）；一次性/TTL/防爆破/常量时间 | `docs/design/desktop-target/pairing-v1.md` |
| 入站 | `/v1/turn`、`/v1/approvals`，Bearer 鉴权，默认 `127.0.0.1:18765`，LAN 需显式放开 | `hosts/shared/cn_inbound_server.js` |

结构性缺口（F1–F8，见 `next-target-requirements.md` §10.1）决定方向：

- **F1 无事件日志/单调 seq** ⇒ 重连、多客户端同步、去重、崩溃恢复没有真相来源。
- **F2 写者不唯一** ⇒ 14 个文件直写 `data/`，跨端会互相覆盖。
- **F3 effect 无契约字段** ⇒ 多机无法路由、重试会重复发信/购买。
- **F6 客户端无核心** ⇒ `preload.js` 约 100 个 IPC，第二个端必然漂移。
- **F7 协议无版本协商** ⇒ 独立升级无降级路径。

L6 目标（`agent-core/README.md`）：**跨 Agent/跨端（Desktop·iOS·Android）共享状态、无人值守可交付**。

## 决策（定调）

### 0. 一句话方向

> **Agent 跑在用户自己的机器上（本地优先），从手机/网页/IM 可达；云端只做身份与转发、不存会话内容；内核自持 loop，Host 是薄壳；UI 只从事件日志折叠出来。**

五条不做（沿用 `next-target-requirements.md` §1 的反面实证，不再讨论）：不重写宿主为 Rust/Tauri、不自研 UI 框架、不全量 TS 化、不把 agent loop 外包给第三方 CLI、不引入 SaaS 账号体系（账号 = 设备密钥对）。

### 1. 真相源：会话日志先于一切

**决策**：以「每会话一条追加日志 + 单调 `seq`」为唯一真相源，状态 = `fold(events)`。T1 是第一优先级，T3/T4 都以它为前提。

**理由**：F1 是其余缺口的地基。没有 seq，重连丢增量、多端同步无锚点、去重与崩溃恢复都是空话。先做 T1 再谈端，是「让后续每个需求成为不变量的推论」而不是逐个打补丁。

**可逆成本**：低。日志适配器先并存双写，`fold(events)` 与现网 JSON 快照逐字段对齐后再切读，旧数据可一键迁移。

### 2. 客户端：一个核心，多端只做壳

**决策**：T3 落地 `client-core/`（无 DOM、无 Electron，Node 与浏览器同跑），schema 单点定义并对齐 `ui_protocol`；renderer 改为消费 core，UI 只渲染 + 本地交互态。传输用适配器接口 `send(op)` / `subscribe(from_seq)`，首批实现 IPC。

**理由**：F6 的根因是「第二个端会复制一份状态机」。一个核心、多端复用，是唯一能长期不漂移的形态（对标 still.fail 的 web/Android/macOS 同跑 core）。

**可逆成本**：低。先对拍（core 折叠结果 vs 现网 UI 零差异）再切换。

### 3. 云端：只做身份与转发，不落内容

**决策**：T4a 云服务职责限定为「成员凭证签发 + 设备公钥登记 + 流量转发」；复用 ed25519 设备密钥，不新建账号体系；服务端只见元数据与密文（不变量 I6）。**T4b（QUIC 直连 + 中转回落）不在本轮**。

**理由**：先有 core 与事件词表，再接远端；否则云端只能转发整包 HTTP，续传/流式无从谈起（`next-target-requirements.md` §6 已论证「为什么不先做 T4」）。

### 4. 收敛 §9 的六个开放问题

| # | 开放问题 | 本轮结论 | 状态 |
|---|---|---|---|
| Q1 | QUIC 绑定形态（Node 原生插件 vs Rust sidecar） | **本轮不做 QUIC**。T4b 立项时先跑 T4-04 spike；倾向 **Rust sidecar**（native addon 崩溃会拖垮主进程，隔离性优先于集成简单） | 延后（倾向已记） |
| Q2 | 中转部署位置（国内自建/备案 vs 自托管镜像） | **只提供自托管镜像 + 企业自建，不给开箱即用公网中转**，规避备案与合规成本；「开箱即用」列为后续可选项 | **待合规签（§6 fork A）** |
| Q3 | 手机端形态（PWA vs 原生壳） | **先 PWA 复用 client-core 做可行性验证**（最便宜的第二端），原生壳后置；PWA 拿不到的（后台常驻/推送）诚实标注为限制 | **待产品签（§6 fork B）**，附明确推荐 |
| Q4 | 多机协作（机器间任务转交） | **本轮不做**，保持 `next-target-requirements.md` §9.4 结论 | 不做 |
| Q5 | 桌面内置 station（`--with-parent` 内嵌） | **本轮不做内嵌 station**：桌面既是 station 也是客户端；多客户端连同一 station 走 T4a。与 T1-06 一并定，倾向「单一 station 进程，内嵌只是启动方式」 | 随 T1-06 定 |
| Q6 | 无 MSVC 环境（wasm 内核分支） | **T0-02 保持原生构建**；wasm 仅作 CI 兜底 spike，不阻塞主链路 | T0-02 决策点 |

## 范围边界（本轮）

**做**：T1 状态底座（日志/单写者/恢复）→ T2 effect 契约（幂等/审批单点/身份绑定）→ T3 客户端核心 → T4a 云身份与转发。
**不做**：T4b QUIC 直连与中转回落、多机任务转交、二维码配对、App Store/Play 商店签名提交（见 `docs/desktop-signing.md` 与 `next-target-requirements.md` M6 残留）。

顺序理由：`T0 → T1 → T2 → T3 → T4a`，T5 与 T4 并行（见 `next-target-requirements.md` §3.5/§6）。**不先做 T4**：没有 client-core 就先接手机，等于复制一份协议与状态机，两套都要维护。

## 拒绝的替代

- **重写宿主为 Rust/Tauri**：still.fail 完整做过 Rust station 又整个删回 TypeScript，前车之鉴。
- **自研 UI 框架**：HTML/CSS 取得同等多端一致性，成本低两个数量级。
- **全量 TS 化**：类型契约留在 kernel；只允许 `client-core/` 与协议层开 `checkJs`。
- **外包 agent loop 给第三方 CLI**：kernel 自持 loop 是与对标产品的不可交换差异。
- **过度抽象**（CRDT / 消息中间件 / 持久化 token 增量 / 按域拆库）：一个会话只有一个写权，不需要 CRDT；effect bus 是同进程函数表，不需要中间件。

## 待签事项（需你/产品/合规拍板）

- **fork A（合规）**：公网中转是否给「开箱即用」托管？本 ADR 主张**只出自托管镜像**，规避备案；若你要开箱即用，需先答合规与备案成本。
- **fork B（产品）**：手机端先 PWA 还是直接原生壳？本 ADR 主张**PWA 先行验证**，原生壳（已有 `hosts/{ios,android}` 骨架）长期仍需拿后台常驻与推送。

两处签了，本 ADR 转 Accepted，T0–T4a 即可按 `next-target-requirements.md` 的任务清单开工。

## 后果

- **正面**：方向单一，后续每个需求（重连、多端、云端、崩溃恢复）都是不变量的推论，而非新增特例。
- **正面**：桌面/手机/网页共用一份 schema 与 reducer，第二端不会漂移。
- **代价**：T1 事件日志是前置，短期看不到「多端惊喜」；这是正确的顺序代价。
- **代价**：PWA 先行意味着后台常驻/推送在早期是缺口，必须诚实标注而非假装可用。
- **风险**：迁移期双写（JSON + events）要保证 `fold(events)` 与快照逐字段相等（AC-T1-3），否则切读会引入静默不一致。

## 验收 / 度量

以 `next-target-requirements.md` §7 指标为准（单回合进程创建次数→0、首 token 延迟↓≥100 ms、安装包≤70 MB、崩溃后重复投递→0、跨网连接成功率≥90%、设备吊销≤30 s、`fold(log)` 一致率 100%、跨会话越权→0、作业跨客户端存活率 100%）。本 ADR 自身验收：六个开放问题全部有结论或明确「不做/延后」，两处 fork 有归属人。
