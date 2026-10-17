# 04 — 接口契约（深挖）

> Reference。入口见 [`interfaces.md`](interfaces.md)。本文补全关键类型，仍非实现。

## Turn / Event / Effect

```moonbit
enum TurnEvent {
  UserMessage(InboundMessage)
  ToolFinished(ToolResult)
  ApprovalResolved(ApprovalToken, Bool)   // accepted?
  BackgroundComplete(SubagentId, SubagentOutcome)
  RoutineFire(RoutineId)
  Cancel
}

enum Effect {
  Deliver(OutboundMessage)
  InvokeTool(ToolCall)
  Spawn(SubagentSpec)
  StopAgent(SubagentId)
  MemoryPatch(MemoryPatch)
  PersistRoutine(RoutineSpec)
  RequestApproval(ApprovalRequest)
}
```

## OutboundMessage 完备字段

```moonbit
struct OutboundMessage {
  kind : OutboundKind
  body_markdown : String?
  widget : WidgetSpec?
  attachments : Array[AttachmentRef]
  reply_to : ThreadRef?
  ephemeral : Bool
  voice : VoiceMemoSpec?
  reaction : ReactionSpec?
  end_turn : Bool                         // true 时 Host 关闭输入等待下轮
}

struct AttachmentRef {
  path : String                           // box 或 store 路径
  mime : String?
  display_name : String?
  inline_image : Bool
}

struct DecisionCard {
  title : String
  options : Array[DecisionOption]
  allow_free_text : Bool
}

struct FormSpec {
  title : String
  fields : Array[FormField]
  sensitive : Bool                        // 凭证表单
}
```

## Tool 错误与副作用分级

```moonbit
enum SideEffectClass {
  PureRead
  LocalWrite
  NetworkRead
  NetworkWrite
  IrreversibleExternal
  CredentialAccess
}

enum ToolError {
  InvalidArgs(String)
  HostFailure(String)
  Denied(String)
  Timeout
  Unauthenticated(String)                 // MCP NeedsAuth
}
```

## Untrusted 内容段

```moonbit
fn render_for_model(segments : Array[ContentSegment]) -> String
/// 保证 Untrusted 段带 fence 标记；模型输出若回声 fence 内容不得直接 Effect
```

## Memory

```moonbit
enum MemoryScope { Profile; Journal; Shared(String) }

struct MemoryQuery {
  scope : MemoryScope?
  text : String?
  keys : Array[String]?
  limit : Int
}

struct MemoryPatch {
  upserts : Array[MemoryFact]
  deletes : Array[String]                 // keys
}
```

## Routine

```moonbit
enum Trigger {
  Cron(expr : String)                     // 标准 cron 子集
  Event(name : String)
}

struct RoutineSpec {
  id : RoutineId
  name : String
  trigger : Trigger
  prompt : String
  silent_ok : Bool
  enabled : Bool
  skill_refs : Array[SkillId]
}
```

## Skill

```moonbit
enum SkillSource { Managed; User; Plugin(String) }

struct SkillRef {
  id : SkillId
  source : SkillSource
  path : String
  description : String
}

trait SkillRunner {
  resolve(self : Self, ids : Array[SkillId]) -> Array[SkillBody]
}
```

## ConnectorNamespace

```moonbit
enum NamespaceStatus {
  Ready
  NeedsAuth
  NeedsGrant
  Error(String)
  Loading
}

struct AuthFlow {
  kind : AuthFlowKind                     // OAuthRedirect | DeviceCode | …
  start : AuthStartPayload                // Host 执行
}
```

## ApprovalGate 与 Auto-review

```moonbit
struct AutoReviewInput {
  effect : Effect
  cmdline_or_summary : String
  target : String?                        // machine/box/url
}

enum AutoReviewVerdict {
  Pass
  Block(reason : String)
}

/// Host 侧可先跑 Auto-review；Block 时 Kernel 转 NeedUserApproval，
/// smart_mode_block_reason 必须原样保留。
```

## SubagentOutcome

```moonbit
struct SubagentOutcome {
  summary : String                        // 给父代理
  artifacts : Array[AttachmentRef]
  failed : Bool
}
```

## HostAbi 扩展点

```moonbit
trait HostAbi {
  // 见 interfaces.md §9
  list_machines(self : Self) -> Array[MachineInfo]
  copy_to_box(self : Self, machine : MachineId, src : String, dst : String) -> Result[Unit, Error]
  copy_from_box(self : Self, machine : MachineId, src : String, dst : String) -> Result[Unit, Error]
  open_desktop_session(self : Self, agent : SubagentId) -> Result[DesktopSessionId, Error]
}
```

## 版本与兼容

- 公开表面变更必须反映在生成 `.mbti`；`moon info` diff 即 API 审查。  
- 枚举增构件用显式新变体；禁止默默复用 String 魔法值（过渡期除外并记 TODO）。
