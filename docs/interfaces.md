# Bit Bot 核心接口契约

> 权威入口。完整类型草图见 `04-interface-contracts.md`。  
> 风格：MoonBit 风格伪签名；**不是实现**。指导 MoonBit核落地公开 `.mbti` 表面。

## 0. 约定

- 所有跨 Host 边界的调用经 `HostAbi`（由 `cmd` 注入）；Kernel 内不直触 OS。
- 工具结果中的外部文本必须可标记为 `UntrustedFence`。
- 不可逆外发（邮件/Slack/购买/删改外部资源）必须过 `ApprovalGate`。

## 1. 回合：Turn

```moonbit
enum TurnPhase {
  Opened
  Acknowledged      // 已发首条 SendToUser
  Working
  Milestone         // 长任务中间更新
  Finalizing
  Ended
}

struct TurnId { value : String }         // 不透明
struct UserId { value : String }
struct SessionId { value : String }

struct TurnContext {
  turn_id : TurnId
  session_id : SessionId
  user_id : UserId
  phase : TurnPhase
  timezone : TimeZone                 // 用户时区，见 D-TIME
  inbound : InboundMessage
  todo : TodoQueue
}

struct InboundMessage {
  text : String
  attachments : Array[AttachmentRef]
  channel : ChannelRef                // chat | slack | mail | …
  thread : ThreadRef?
  sent_from_machine : MachineId?      // “[Sent from machine …]”
}

fn open_turn(inbound : InboundMessage, env : RuntimeEnv) -> TurnContext
fn acknowledge(ctx : TurnContext, msg : OutboundMessage) -> TurnContext
fn step(ctx : TurnContext, event : TurnEvent) -> (TurnContext, Array[Effect])
fn end_turn(ctx : TurnContext, final_msg : OutboundMessage?) -> TurnContext
```

`Effect`：Host 可执行副作用描述（工具调用、投递、拉起子代理、写记忆等），由 runtime 产出、Host 执行、结果回注。

## 2. 消息投递：OutboundMessage（SendToUser 语义）

```moonbit
enum OutboundKind {
  Text
  Widget            // 决策卡 / 表单 / 审批
  Attachment
  VoiceMemo
  Reaction
  ThreadReply
  MilestoneUpdate
  EndTurnMarker     // 协议层终态信号（可与 Text 同包投递）
}

struct OutboundMessage {
  kind : OutboundKind
  body_markdown : String?
  widget : WidgetSpec?
  attachments : Array[AttachmentRef]
  reply_to : ThreadRef?
  ephemeral : Bool                    // 里程碑/进度可标记
}

enum WidgetSpec {
  DecisionCard(DecisionCard)
  UserForm(FormSpec)                  // RequestUserForm
  ApprovalCard(ApprovalRequest)
  // …
}

/// UI 协议面：业务包只构造 OutboundMessage，不写渠道 JSON
trait Delivery {
  send(self : Self, msg : OutboundMessage) -> Result[DeliveryId, DeliveryError]
}
```

规则摘要：

- 每轮用户可见工作前应有**首条确认**（可短）。
- 长任务发**里程碑**；结束必须有面向用户的终态 + `end_turn`。
- Routine 默认可静默；需用户注意时再投递（见 lifecycle 文档）。

## 3. 工具调用：ToolCall / ToolResult

```moonbit
struct ToolName { value : String }
struct ToolCallId { value : String }

struct ToolCall {
  id : ToolCallId
  name : ToolName
  arguments : Json                    // 或结构化 AbsTree；实现期选定
  machine_id : MachineId?             // 本机路由
}

enum ToolResultBody {
  Json(Json)
  Text(String)
  BytesRef(FileRef)                   // 大结果落盘，不经对话膨胀
  Error(ToolError)
}

struct ToolResult {
  call_id : ToolCallId
  body : ToolResultBody
  untrusted : Bool                    // true → 必须 fence
  fence_source : String?              // 如 "Shell" / "WebFetch"
}

trait ToolRegistry {
  list(self : Self) -> Array[ToolDesc]
  get(self : Self, name : ToolName) -> ToolDesc?
  invoke(self : Self, ctx : TurnContext, call : ToolCall) -> ToolResult
}

struct ToolDesc {
  name : ToolName
  namespace : String?                  // MCP namespace 或 "builtin"
  description : String
  input_schema : JsonSchema
  side_effect_class : SideEffectClass // Read | Write | IrreversibleExternal | …
}
```

动态 MCP：先 `GetDynamicTools` 再 `CallDynamicTool`；Kernel 只持有描述缓存，传输在 Host。

## 4. 审批：ApprovalGate

```moonbit
enum ActionClass {
  ReadLocal
  WriteLocal
  IrreversibleExternal    // 发邮件/Slack/发帖/购买/删外部
  CredentialUse
  AutoReviewSensitive     // Shell/MCP/Computer/CloudAgent 等
}

enum GateDecision {
  Allow
  Deny(reason : String)
  NeedUserApproval(ApprovalRequest)
}

struct ApprovalRequest {
  action_class : ActionClass
  summary : String                    // 给用户看的短描述
  payload_fingerprint : String        // 同动作重试用
  smart_mode_block_reason : String?   // Auto-review 原文
}

trait ApprovalGate {
  classify(self : Self, effect : Effect) -> ActionClass
  check(self : Self, ctx : TurnContext, effect : Effect) -> GateDecision
  /// 用户批准后：同一 effect 原样重放（禁止改写绕过）
  resume_after_approval(self : Self, ctx : TurnContext, effect : Effect, token : ApprovalToken) -> GateDecision
}
```

硬规则：不可逆外发**无用户明示**则只准草稿/规划，不准发送。

## 5. 不受信内容：UntrustedFence

```moonbit
struct UntrustedFence {
  source : String
  raw : String
}

fn wrap_untrusted(source : String, raw : String) -> String
fn parse_fences(text : String) -> Array[ContentSegment]

enum ContentSegment {
  Trusted(String)
  Untrusted(UntrustedFence)
}
```

Fence 内文本**永不**直接变成 Effect（外发、删改、用凭证）。可总结、可引用、可上报用户。

## 6. 子代理：SubagentHandle

```moonbit
enum SubagentKind {
  Executor
  ComputerUse
  KnowledgeWork
  VideoReview
  WatchVideo
  CloudAgent
  Custom(String)
}

struct SubagentId { value : String }

enum SubagentStatus {
  Starting
  Running
  Blocked(ApprovalRequest?)
  Completed(SubagentOutcome)
  Failed(Error)
  Stopped
}

trait SubagentHandle {
  id(self : Self) -> SubagentId
  kind(self : Self) -> SubagentKind
  status(self : Self) -> SubagentStatus
  stop(self : Self) -> Result[Unit, Error]
  resume(self : Self) -> Result[Unit, Error]
}

trait AgentSpawner {
  spawn(self : Self, ctx : TurnContext, spec : SubagentSpec) -> SubagentHandle
}

struct SubagentSpec {
  kind : SubagentKind
  task : String
  attachments : Array[AttachmentRef]
  machine_id : MachineId?
}
```

父回合可并行多个 handle；完成事件经 `runtime.on_background_complete` 唤醒。

## 7. 记忆 / 例程 / 技能（节选）

```moonbit
struct MemoryFact {
  key : String
  value : String
  scope : MemoryScope               // Profile | Journal | Shared
  updated_at : Instant
}

trait MemoryStore {
  recall(self : Self, query : MemoryQuery) -> Array[MemoryFact]
  update(self : Self, patch : MemoryPatch) -> Result[Unit, Error]
}

struct RoutineSpec {
  id : RoutineId
  trigger : Trigger                 // Cron(CronExpr) | Event(EventName)
  prompt : String
  silent_ok : Bool
}

struct SkillRef {
  id : SkillId
  source : SkillSource              // Managed | User | Plugin
  path : String
}
```

## 8. 连接器命名空间

```moonbit
struct ConnectorNamespace {
  id : String                       // 如 "user-Gmail"
  status : NamespaceStatus          // Ready | NeedsAuth | NeedsGrant | Error | Loading
}

trait McpConnector {
  list_namespaces(self : Self) -> Array[ConnectorNamespace]
  get_tools(self : Self, ns : String) -> Array[ToolDesc]
  call(self : Self, ns : String, tool : ToolName, args : Json) -> ToolResult
  authenticate(self : Self, ns : String) -> AuthFlow                    // Host 拉起 OAuth
}
```

## 9. Host ABI（Kernel ↔ Host）

```moonbit
trait HostAbi {
  deliver(self : Self, msg : OutboundMessage) -> Result[DeliveryId, Error]
  exec_tool(self : Self, call : ToolCall) -> ToolResult
  spawn_subagent(self : Self, spec : SubagentSpec) -> SubagentId
  store_read(self : Self, path : String) -> Result[Bytes, Error]
  store_write(self : Self, path : String, data : Bytes) -> Result[Unit, Error]
  now(self : Self) -> Instant
  request_approval(self : Self, req : ApprovalRequest) -> ApprovalToken
}
```

WASM 内只依赖 `HostAbi` trait；具体 Node/浏览器实现属于 Host 仓或 `cmd` 适配层。

### 9.0 Backend：Mock | Live（增量 · G-ABI-1）

`box_host` 落地：

```moonbit
enum HostBackend { Mock; Live(LiveHostConfig) }
struct LiveHostConfig {
  display : String?          // e.g. Some(":1")
  workspace_root : String
  mcp_transport : McpTransportConfig?
  ui_automation : Bool
}
```

- `HostAbi::mock()` — **仅 U** / kernel-contract。
- `HostAbi::live(cfg)` / `with_backend(Live(...))` — I 骨架；**失败不得静默回落 Mock**。
- Live 副作用写 `AuditSpan`（G-ABI-2）。
- Screenshot 证据可选字段：`frame_origin`（`Placeholder` | `LiveDisplay`）、`display_id?`、`bytes_sha256?`、`captured_at?`（仅 Live 填；U 保持 Placeholder）。

详见 [`host-integration-interface-gaps.md`](host-integration-interface-gaps.md) §1–2、`box_host/README.md`。

## 10. 最小实现顺序（接口优先）

对齐 ROADMAP **M1**：

1. `core` 类型 + `TurnContext` / `OutboundMessage`
2. `UntrustedFence` + `ApprovalGate` 骨架
3. `Delivery` + `end_turn` 协议
4. `ToolRegistry`（可先 mock Host）
5. 再挂真实 `HostAbi` 适配器

完整签名与更多类型见 [`04-interface-contracts.md`](04-interface-contracts.md)。
