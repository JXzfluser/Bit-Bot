# Bit Bot 总体架构

> 权威入口。细节见编号系列：`00`–`07`、`adr/`。  
> 对齐：`CHARTER.md`（硬性约束）、`ROADMAP.md`（M0–M7）、`capability-matrix.md`（能力对标合同，由能力对标角色维护）。

## 1. 目标

用 MoonBit（`preferred_target = wasm`）**完整复刻** Grok Bot 全部原生能力。  
一条能力都不能少；禁止用聊天 Demo / stub 冒充完成。见 [ADR 0001](adr/0001-full-parity-over-demo.md)。

## 2. 进程与运行时边界

```
┌─────────────────────────────────────────────────────────────┐
│  Host 进程（Node / 浏览器 / 系统服务）                         │
│  · FFI/IPC 适配：Shell、FS、Desktop、Network、MCP、邮件、渠道   │
│  · 审批卡 UI、SendToUser 投递、凭证保险库、Auto-review 钩子     │
│  · 持久卷：box FS、stores、profile、routines 调度器时钟          │
└──────────────────────────┬──────────────────────────────────┘
                           │ Host ABI（同步/异步调用 + 事件入站）
┌──────────────────────────▼──────────────────────────────────┐
│  Bit Bot WASM Kernel（MoonBit）                               │
│  · Turn loop / Scheduler / Tool registry                      │
│  · 能力策略、Untrusted fence、ApprovalGate                     │
│  · Memory / Skills / Routines 逻辑与类型                       │
│  · Subagent 编排协议（不含子进程本身）                          │
└─────────────────────────────────────────────────────────────┘
```

| 层 | 跑什么 | 不跑什么 |
|----|--------|----------|
| **WASM Kernel** | 回合状态机、工具编排、策略判定、类型安全契约、记忆/例程逻辑 | 真实 OS 调用、GUI、网络 socket、MCP 传输、邮件 SMTP |
| **Host** | Shell/Read/Screenshot、browser、MCP transport、渠道 IO、审批卡渲染、文件字节搬运 | 业务策略决策（由 Kernel 发指令） |

边界原则见 [ADR 0002](adr/0002-wasm-host-boundary.md)：能纯逻辑的进 WASM；有副作用的经 Host 适配器，契约在 `interfaces.md`。

## 2.1 Host FFI 验收边界（CM-0605 等）

Bit验证拍板：**内核契约**与 **Host 集成**分列，禁止用 mock 冒充真屏/真 UI。

| 能力 | Kernel-contract（可 WASM 单测） | Host-integration（I） |
|------|----------------------------------|------------------------|
| **CM-0605 Screenshot** | `ScreenshotResult`：`has_frame` / `read_only` / 未 click 等字段与路径约定 — 可 **PASS** | 真实 display `:1` 画面 — **GAP**（升 I 前不得删） |
| **CM-1901/1902/1907 Host UI** | 入口枚举、锚点闭集、删除确认态 — 见 [`host-ui-contract.md`](host-ui-contract.md) | 真侧栏/真 Settings/真右键 Delete |

原则：`box_host` 可提供可测契约与占位证据；**占位 PNG / mock Host ≠ host-integration PASS**。细节见 `qa/gaps.md`。

下一阶段（内核 **PASS=234/234** 收口后）：见 [`host-integration-roadmap.md`](host-integration-roadmap.md) 与 [`host-integration-interface-gaps.md`](host-integration-interface-gaps.md)。**勿改已 PASS 的 kernel-contract 口径。**


## 3. 逻辑分层（Kernel 内）

| 层 | 包域 | 职责 |
|----|------|------|
| **Core** | `core/` | 类型、错误、ID、时间、结果代数 |
| **Security** | `security/` | UntrustedFence、Auto-review 策略、不可逆动作闸门 |
| **Runtime** | `runtime/` | Turn 生命周期、调度、后台完成唤醒、Todo 队列 |
| **UI Protocol** | `io/user/` 或 `ui_protocol/` | OutboundMessage、widget、attachment、voice、end_turn |
| **Tools** | `tools/` | Kernel 侧 ToolCall/Effect/DTO 描述（不含真实 Shell/FS） |
| **Host 适配** | `box_host/` | Shell/FS/Desktop 的 HostAbi 实现出口（**保留顶层包**） |
| **Agents** | `agents/`（含 `agents/cloud`） | Task 子代理、CloudAgent、SendToAgent；**无顶层 `cloud/`** |
| **Persistence** | `memory/` `routines/` `skills/` `stores/` | 记忆、例程、技能目录、持久 store |
| **Connectors** | `connectors/` `channels/` | MCP/插件、Slack 等渠道、邮件入站出站规则 |
| **Apps** | `cmd/main` | Host 启动入口、boot 接线（与 `box_host` 组装 HostAbi） |

依赖只允许**向下/向内**（见 `modules.md` mermaid）。`security` 横切但通过显式 `ApprovalGate` 接口注入，不反向依赖业务包。

## 4. 与 Grok Bot 能力域映射

完整原子项见 [`01-capability-inventory.md`](01-capability-inventory.md)（与 `capability-matrix.md` 对齐）。下表是 **P0 能力域索引**——每个域在矩阵中必须有可勾选原子项，缺域即架构缺陷。

| 域 ID | 域 | 主责模块 | Grok Bot 对应面 |
|-------|-----|----------|-----------------|
| D-TURN | 对话与回合协议 | `runtime` + `ui_protocol` | SendToUser、首条确认、里程碑、end_turn、voice memo |
| D-COMM | 沟通风格与决策卡 | `ui_protocol` | Markdown/链接策略、widget 决策卡 |
| D-FILE | 文件与视觉 | `tools` + `ui_protocol` | 附件、截图、图表、GenerateImage/Video |
| D-BOX | Box 计算机 | `tools`（DTO）+ `box_host`（副作用） | Shell、Read、FS、持久环境 |
| D-DESK | Box 桌面与浏览器 | `box_host` + `agents`（computer_use） | computerUse、Screenshot、登录/2FA |
| D-MACH | 用户本机 | `tools/machines` | ListMachines、machineId、本地工具审批 |
| D-AGENT | 子代理与多任务 | `agents` + `runtime` | Task/executor/knowledgeWork/videoReview；停止/恢复；Todo |
| D-MCP | 动态工具与 MCP | `connectors/mcp` + `tools/dynamic` | GetDynamicTools、CallDynamicTool、Authenticate、InstallPlugin |
| D-CLOUD | 云编码代理 | `agents/cloud` | CloudAgent / Origin / GitHub |
| D-MEM | 记忆 | `memory` | profile/journal/shared；Recall/Update |
| D-RTN | 例程/自动化 | `routines` | cron + 事件触发；静默规则 |
| D-SKILL | Skills | `skills` | managed + user workflows |
| D-CHAN | 渠道与入站 | `channels` | Slack 等；inbound 规则 |
| D-MAIL | 邮件 | `connectors/mail` | 自有 inbox + Gmail/Outlook；DraftExternalMessage |
| D-SEC | 安全 | `security` | Auto-review、untrusted fence、不可逆闸门 |
| D-BUY | 购买与表单 | `connectors/commerce` + `ui_protocol` | purchases、RequestUserForm、凭证 |
| D-TEAM | 队友/群组 | `agents/teammates` | SendToAgent、CreateAgent、sections |
| D-PROF | 档案与设置 | `memory/profile` + `ui_protocol` | UpdateProfile、UpdateAvatar、sidebar |
| D-STORE | 商店/持久 store | `stores` | agent stores 挂载与读写 |
| D-TIME | 时间与时区 | `core/time` | 用户时区、报告标签 |
| D-PERM | 权限与外发 | `security` + `ui_protocol` | 不擅自外发；草稿待批 |

## 4.1 包命名拍板（2026-10-17 · Bitbot）

1. **保留顶层 `box_host`**：Host 适配（Shell/FS/Desktop FFI）。Kernel 只在 `tools` 描述 ToolCall/Effect；副作用出口经 `box_host` → HostAbi。允许 `tools` 内请求 DTO，**不要**把 Host 实现并进 `tools/box`。
2. **取消顶层 `cloud/`**，并入 **`agents/cloud`**（路径 `/workspace/bitbot/agents/cloud`，模块名 `bitbot/bitbot/agents/cloud`）。CloudAgent 生命周期归 agents 域。
3. **HostAbi 实现仓**：暂定本仓 `box_host` + `cmd/main` 组装；外仓拆分稍后定。

## 4.2 CAP-* / CM-* ↔ 架构域短号

合同以 [`capability-matrix.md`](capability-matrix.md) 为准（主键 **`CM-****`**）。对照表见 [`capability-id-crosswalk.md`](capability-id-crosswalk.md)。**扁平 `CAP-001`… 已废弃**，实现侧勿再跟旧号。

| 矩阵前缀 | 架构域短号 | 主责包 |
|----------|------------|--------|
| CM-01xx | D-TURN · D-COMM | `runtime` + `ui_protocol` |
| CM-02xx | D-PROF | `memory` + `ui_protocol` |
| CM-03xx | D-MEM | `memory` |
| CM-04xx | D-RTN | `routines` |
| CM-05xx | D-SKILL | `skills` |
| CM-06xx | D-BOX | `tools` + `box_host` |
| CM-07xx | D-MACH | `tools` + HostAbi（machines） |
| CM-08xx | D-DESK | `box_host` + `agents` |
| CM-09xx | D-MCP | `connectors` + `tools` |
| CM-10xx | D-MAIL | `connectors`（mail） |
| CM-11xx | D-CHAN | `channels` |
| CM-12xx | D-AGENT | `agents` + `runtime` |
| CM-13xx | D-CLOUD | `agents/cloud`（**非**顶层 cloud） |
| CM-14xx | D-TEAM | `agents`（teammates） |
| CM-15xx | D-SEC · D-PERM | `security` + `ui_protocol` |
| CM-16xx | D-FILE | `tools` + `ui_protocol` |
| CM-17xx | D-MCP（检索面） | `tools`（web）+ Host |
| CM-18xx | D-SKILL（垂直） | `skills` |
| CM-19xx | D-PROF（设置 UI） | Host UI + `ui_protocol` |
| CM-20xx | D-TIME · D-TURN（首启） | `core` + `runtime` |
| CM-21xx+ | 审定/差集补遗（多域） | 矩阵行 + crosswalk |

细项交叉：[`capability-id-crosswalk.md`](capability-id-crosswalk.md)；Bit验证 gaps **只引用 `CM-*`**。

## 4.3 落地包名

物理路径以扁平根包为准（见 `scaffold-status.md` / `modules.md`）：  
`core`, `security`, `ui_protocol`, `runtime`, `tools`, `box_host`, `agents`（含 `agents/cloud`）, `memory`, `routines`, `skills`, `connectors`, `channels`, `stores`, `cmd/main`。  
**禁止**再维护平行的顶层空 `cloud/`。

## 5. 一轮对话（摘要）

```
InboundUserMessage
  → runtime 打开 Turn
  → 首条 SendToUser（确认/澄清）
  → 工具循环（Host 执行 + Kernel 策略 + 可选 ApprovalGate）
  → 里程碑更新（长任务）
  → 终态：面向用户的答复 + end_turn
后台完成 / routine 触发 → 可 WakeParent / 静默写结果（见 05-runtime-turn-lifecycle.md）
```

## 6. 文档地图

| 文件 | 用途 |
|------|------|
| [CHARTER.md](CHARTER.md) | 愿景、团队、non-negotiables |
| [ROADMAP.md](ROADMAP.md) | M0–M7 |
| [modules.md](modules.md) | 包目录与依赖 |
| [interfaces.md](interfaces.md) | 核心接口契约 |
| [01-capability-inventory.md](01-capability-inventory.md) | 全量能力原子清单 |
| [capability-matrix.md](capability-matrix.md) | 对标合同（能力对标维护） |
| [02](02-module-map.md)–[07](07-directory-conventions.md) | 模块图、映射、契约深挖、生命周期、演进、目录约定 |
| [adr/](adr/) | 架构决策 |

## 7. 验收挂钩

- 每个域在 `capability-matrix.md` 有状态列；Bit验证在 `qa/` 打缺口。
- `moon check && moon test && moon run cmd/main` 为最低绿线（CHARTER）。
- 禁止「先做聊天 Demo」捷径（ADR 0001）。
