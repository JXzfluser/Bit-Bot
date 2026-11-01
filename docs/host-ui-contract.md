# Host UI 契约草图（CM-19xx）

> 供 MoonBit核做 **kernel-contract** 验收；真实像素/点击属 Host 集成（I），不得用 mock 冒充真屏。  
> 对照源：`/home/box/reference/app-ui.md`、`capability-matrix.md` CM-19xx。  
> **不砍能力**：本节覆盖矩阵 CM-1901–1907；首批验收焦点为 **CM-1901 / CM-1902 / CM-1907**。

## 0. 分层与验收口径

| 层 | 测什么 | 不算通过 |
|----|--------|----------|
| **Kernel-contract（WASM / ui_protocol + HostAbi 面）** | 深链 URI 合法、锚点枚举完整、删除助手意图类型与确认态、禁止伪造路径 | 仅字符串存在但无枚举/校验 |
| **Host-integration（I）** | **Bit Bot 自有 Live Host UI** 真打开 Settings / 侧栏右键 Delete（裁定 C′；非 Grok 闭源客户端、非剧本假窗） | mock / 占位 PNG / 剧本假窗 |

与 [ADR 0002](adr/0002-wasm-host-boundary.md)、`architecture.md` §2.1 一致：  
**CM-0605** 内核契约可 PASS；**host-integration 仍为 GAP**，升 I 前不得删 GAP，实现方勿再追 mock 当真屏。

> **I 证据面最终口径（Bitbot · 覆盖）**：**I=C′ Bit Bot 自有 Host 进程**；**B 拒**；**A 非升 I 前置**（可选对照）。详见 [`host-integration-interface-gaps.md`](host-integration-interface-gaps.md) §3.0。


---

## 1. CM-1901 — Settings 入口

### 1.1 真实入口（仅此三类）

| 入口 | 行为 |
|------|------|
| 侧栏左下角 **账户按钮**（头像 + 账户名） | 打开全局 Settings |
| 快捷键 **Cmd+,**（macOS；其他平台跟 Host 映射） | 打开全局 Settings |
| 命令面板 **"Open settings"** | 打开全局 Settings |

### 1.2 禁止

- 指引或深链声称存在 **齿轮图标**、**macOS Preferences 菜单项**、或任意未列路径。
- 把 **per-agent 信息面板齿轮**（见 §4）说成全局 Settings 入口。

### 1.3 Kernel 契约类型（草图）

```moonbit
enum SettingsEntry {
  SidebarAccountButton
  KeyboardShortcut    // Cmd+,
  CommandPalette      // "Open settings"
}

struct OpenSettingsIntent {
  entry : SettingsEntry
  anchor : SettingsAnchor?   // 可选深链；见 CM-1902
}

/// Kernel/HostAbi：只表达「请打开」；渲染与焦点在 Host
trait HostSettingsUi {
  open_settings(self : Self, intent : OpenSettingsIntent) -> Result[Unit, HostUiError]
}
```

### 1.4 验收（kernel-contract）

- Given 任意 `SettingsEntry` When 构造 `OpenSettingsIntent` Then 校验通过。  
- Given 文档/助手出站文案 When 含 Settings 指引 Then 仅允许上述入口描述（静态/策略测）。  
- **Host-integration GAP 可另挂**：真机点侧栏是否打开 —— 不阻塞本契约枚举 PASS。

---

## 2. CM-1902 — Settings tabs 与锚点

### 2.1 Tabs（有序）

| Tab | 可见条件 |
|-----|----------|
| General | 始终 |
| Computer | 始终 |
| Vault | 仅账户启用时 |
| Usage & Billing | 仅账户启用时 |
| Updates | 始终 |

助手指引：某行/某 Tab 在当前账户不可见时，**说明可能未启用**，禁止编造替代路径。

### 2.2 深链 URI

唯一合法形态：

```
grokbot://app/v1/settings?id=<anchor>
```

`<anchor>` 必须属于下列闭集（与 app-ui.md 一致）。

#### General

`account`, `theme`, `accent`, `language`, `spell-check`, `microphone`, `hardware-acceleration`, `hardware-acceleration-restart`, `network-debugger`, `notification-sound-enabled`, `notification-sound`, `timezone`, `auto-review`, `auto-review-rules`, `security-keys`

#### Computer

`local-execution`, `computers`, `update-computer`, `reset-computer`

#### Phone

`pairing`

#### Usage & Billing

`usage`, `plan`, `cancel-trial`, `on-demand`, `billing`

#### Updates

`update-status`, `update-channel`, `automatic-updates`

### 2.3 语义要点（契约必写清）

| 锚点 | 语义约束 |
|------|----------|
| `theme` | Follow System / Light / Dark |
| `language` | 与 CM-2002 语言跟随配合；出站链接用此锚点 |
| `timezone` | 用户 IANA 时区 |
| `auto-review` / `auto-review-rules` | 与 ApprovalGate / Auto-review 面相关 |
| `update-computer` | **换 box 实例**，保留文件与登录；按钮文案 "Update"；**两步确认**（"Click Again to Confirm"） |
| `reset-computer` | 快照恢复；可能丢未同步工作；**助手不主动首选**（优先 `update-computer`） |
| `update-channel` | 应用自身 Stable/Nightly（**≠** `update-computer`） |
| `local-execution` | 本机执行总开关；关则 machineId 调用被拒（CM-1905） |
| `pairing` | 手机配对（GP-189）：6 位配对码 + 「允许手机连接」开关在 **Phone** 页；`base_url` 只在同网段可达时才是可用地址，跨网段/公网要如实提示（ADR 0008） |

### 2.4 Kernel 契约类型（草图）

```moonbit
enum SettingsTab {
  General
  Computer
  Vault
  Phone
  UsageBilling
  Updates
}

enum SettingsAnchor {
  // General
  Account; Theme; Accent; Language; SpellCheck; Microphone
  HardwareAcceleration; HardwareAccelerationRestart; NetworkDebugger
  NotificationSoundEnabled; NotificationSound; Timezone
  AutoReview; AutoReviewRules; SecurityKeys
  // Computer
  LocalExecution; Computers; UpdateComputer; ResetComputer
  // Phone
  Pairing
  // Usage & Billing
  Usage; Plan; CancelTrial; OnDemand; Billing
  // Updates
  UpdateStatus; UpdateChannel; AutomaticUpdates
}

fn settings_deep_link(anchor : SettingsAnchor) -> String
  // => "grokbot://app/v1/settings?id=..." 仅映射上表

fn parse_settings_anchor(id : String) -> Result[SettingsAnchor, HostUiError]
  // 未知 id → Error；禁止静默吞掉
```

### 2.5 验收（kernel-contract）

- 闭集往返：每个 `SettingsAnchor` ↔ `id=` 字符串双射。  
- 未知锚点 → 错误，不生成非法 URI。  
- 出站 Markdown 链到 Settings 时必须用 `grokbot://app/v1/settings?id=...` 形态。  
- `update-computer` 与 `update-channel` 在类型/文档上分离（CM-1906）。

---

## 3. CM-1907 — 删除助手

### 3.1 真实路径

| 步骤 | 行为 |
|------|------|
| 1 | 侧栏 **助手行** 上 **右键** |
| 2 | 选 **Delete** |
| 3 | **确认** 后永久删除：助手 + transcript |

### 3.2 禁止

- 放在 **全局 Settings** 内。  
- 用 **archive / hide** 冒充删除（侧栏隐藏 ≠ 删除；隐藏另见 CM-0204）。  
- 无确认的一键硬删（契约要求确认态）。

### 3.3 Kernel 契约类型（草图）

```moonbit
struct AgentId { value : String }

enum DeleteAgentPhase {
  Requested          // 用户已选 Delete
  AwaitingConfirm
  Confirmed
  Cancelled
  Completed          // 助手与 transcript 已移除
}

struct DeleteAgentIntent {
  agent_id : AgentId
  phase : DeleteAgentPhase
}

trait HostAgentLifecycleUi {
  /// Host 弹出确认；Kernel 只跟踪 phase
  request_delete_agent(self : Self, agent_id : AgentId) -> DeleteAgentIntent
  confirm_delete_agent(self : Self, intent : DeleteAgentIntent) -> Result[DeleteAgentIntent, HostUiError]
}
```

### 3.4 验收（kernel-contract）

- 状态机含 `AwaitingConfirm`；未确认不得 `Completed`。  
- 完成语义：agent + transcript 移除（Host 回调）；Kernel 侧清除会话句柄。  
- 指引文案不得指向 Settings 内删除。

---

## 4. 相关能力（同域，不砍；后续 kernel-contract）

| ID | 摘要 | 与本契约关系 |
|----|------|----------------|
| CM-1903 | Update Bot's Computer | 锚点 `update-computer`；两步确认 |
| CM-1904 | Reset Bot's Computer | 锚点 `reset-computer`；非首选 |
| CM-1905 | local-execution | 锚点 + machines 闸门 |
| CM-1906 | 应用 Updates vs box Update | `update-channel` ≠ `update-computer` |
| CM-0205 | Per-agent 信息面板 | 点名称 / Cmd+Shift+I；**不是**全局 Settings |
| CM-0203 | 侧栏可见性 | 删除后须从侧栏消失 |

Per-agent 面板齿轮：打开 **该助手** 的 avatar/name/title/description/通知 —— 与全局 Settings **分轨**。

---

## 5. HostAbi 扩展面（建议挂 `box_host` / Host 组装，非 tools）

```moonbit
trait HostUiShell {
  open_settings(self : Self, intent : OpenSettingsIntent) -> Result[Unit, HostUiError]
  request_delete_agent(self : Self, agent_id : AgentId) -> DeleteAgentIntent
  confirm_delete_agent(self : Self, intent : DeleteAgentIntent) -> Result[DeleteAgentIntent, HostUiError]
}
```

Kernel 出站若需引导用户：经 `ui_protocol` 发 Markdown，链接仅用 §2.2 URI；**不**由 Kernel 直接操控 DOM。

---

## 6. 与 CM-0605（Screenshot）边界备忘

| 验收层 | CM-0605 | CM-1901/1902/1907 |
|--------|---------|-------------------|
| Kernel-contract | `ScreenshotResult.has_frame` / read_only / 未 click 等类型与证据字段 | 入口枚举、锚点闭集、删除确认态 |
| Host-integration | 真实 display `:1` 画面（**仍为 GAP**） | 真 UI 打开/右键 Delete |

实现方：**mock 帧 ≠ 真屏**；Settings/Delete 同理，枚举 PASS ≠ Host 像素 PASS。

---

## 7. 文档索引

- 矩阵：`capability-matrix.md` CM-1901 / 1902 / 1907  
- 真实 UI：`/home/box/reference/app-ui.md`  
- 架构边界：`architecture.md` §2.1、`adr/0002-wasm-host-boundary.md`  
- 缺口跟踪：`qa/gaps.md`（CM-0605 host-integration GAP）
