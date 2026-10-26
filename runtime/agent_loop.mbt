///|
/// Model-driven tool loop. Host executes; this state machine only calls
/// llm_chat / exec_tool / request_approval / deliver.
///
/// L3 shape (the session context lives in runtime/agent_context.mbt):
/// - the step cap is 64 — a caller may lower `self.max_steps`, never raise it;
/// - the session token budget is the second stop condition;
/// - the context carries the history, so a loop no longer starts from zero
///   on every turn;
/// - tool failures are classified, recorded structurally, retried under a cap
///   with a step-based backoff, and repeated failures stop the loop instead of
///   grinding to 64 steps.

///|
pub const AGENT_LOOP_MAX_STEPS : Int32 = 64

///|
/// Host convention: a tool result may start with `tool_error: <message>` to
/// report a tool failure, and with `tool_duration_ms: <n>` to report how long
/// the call took. Both prefixes are stripped before the model sees the output.
pub const LOOP_TOOL_ERROR_MARKER : String = "tool_error:"

///|
pub const LOOP_TOOL_DURATION_MARKER : String = "tool_duration_ms:"

///|
/// Host convention: a model reply whose content starts with
/// `provider_error: <reason>` is a provider failure, not an assistant answer.
pub const LOOP_PROVIDER_ERROR_MARKER : String = "provider_error:"

///|
pub(all) struct LoopMessage {
  role : String
  content : String
} derive(Eq, Debug)

///|
pub extend LoopMessage with Eq::{equal, not_equal}

///|
pub extend LoopMessage with Debug::{to_repr}

///|
pub(all) struct ToolCallReq {
  id : String
  name : String
  arguments_json : String
} derive(Eq, Debug)

///|
pub extend ToolCallReq with Eq::{equal, not_equal}

///|
pub extend ToolCallReq with Debug::{to_repr}

///|
pub(all) struct LlmChatReply {
  content : String
  tool_calls : Array[ToolCallReq]
  cancelled : Bool
} derive(Eq, Debug)

///|
pub extend LlmChatReply with Eq::{equal, not_equal}

///|
pub extend LlmChatReply with Debug::{to_repr}

///|
pub(all) enum ApprovalVerdict {
  ApprovalAllow
  ApprovalDeny
  ApprovalCancel
} derive(Eq, Debug)

///|
pub extend ApprovalVerdict with Eq::{equal, not_equal}

///|
pub extend ApprovalVerdict with Debug::{to_repr}

///|
/// Why a run stopped. `TokenBudget` is the second stop condition (the
/// session budget ran out), `Failed` is the stop-loss after repeated tool
/// failures, `ProviderFailed` is a model provider failure.
pub(all) enum LoopStop {
  Final
  MaxSteps
  Cancelled
  TokenBudget
  Failed
  ProviderFailed
} derive(Eq, Debug)

///|
pub extend LoopStop with Eq::{equal, not_equal}

///|
pub extend LoopStop with Debug::{to_repr}

///|
/// Why one tool call failed. `UnknownTool` / `InvalidArguments` are model
/// mistakes, `ToolExecutionFailed` is the tool, `ApprovalDenied` is the user,
/// `ProviderFailed` is the model provider.
pub(all) enum LoopFailureKind {
  UnknownTool
  InvalidArguments
  ToolExecutionFailed
  ApprovalDenied
  ProviderFailed
} derive(Eq, Debug)

///|
pub extend LoopFailureKind with Eq::{equal, not_equal}

///|
pub extend LoopFailureKind with Debug::{to_repr}

///|
/// One structured failure record. The observation the model sees is a
/// rendering of this record, not the record itself.
pub(all) struct LoopFailure {
  kind : LoopFailureKind
  tool_name : String
  call_id : String
  message : String
  step : Int32
  attempt : Int32
  blocked : Bool
} derive(Eq, Debug)

///|
pub extend LoopFailure with Eq::{equal, not_equal}

///|
pub extend LoopFailure with Debug::{to_repr}

///|
/// L3 failure recovery policy: how often one tool may fail before the kernel
/// refuses it, how many failures in a row stop the loop, and how many steps a
/// failed tool has to cool down before it may run again.
pub(all) struct LoopRetryPolicy {
  max_attempts_per_tool : Int32
  max_consecutive_failures : Int32
  backoff_steps : Int32
} derive(Eq, Debug)

///|
pub extend LoopRetryPolicy with Eq::{equal, not_equal}

///|
pub extend LoopRetryPolicy with Debug::{to_repr}

///|
/// Default recovery policy: a tool may fail three times, four failures in a
/// row stop the loop, and a failed tool waits one step before it may run
/// again.
pub fn default_retry_policy() -> LoopRetryPolicy {
  { max_attempts_per_tool: 3, max_consecutive_failures: 4, backoff_steps: 1, }
}

///|
pub(all) struct AgentRun {
  turn_id : String
  stop : LoopStop
  steps : Int32
  max_steps : Int32
  exec_count : Int32
  llm_count : Int32
  approval_count : Int32
  delivered : String
  observations : Array[String]
  failures : Array[LoopFailure]
  traces : Array[AgentToolTrace]
  todos : Array[TodoItem]
  context : AgentContext
} derive(Eq, Debug)

///|
pub extend AgentRun with Eq::{equal, not_equal}

///|
pub extend AgentRun with Debug::{to_repr}

///|
/// Live counters of one run. `mut` fields are shared, so a helper can
/// update them without returning them.
pub(all) struct RunState {
  mut steps : Int32
  mut exec_count : Int32
  mut llm_count : Int32
  mut approval_count : Int32
  mut consecutive_failures : Int32
  mut observations : Array[String]
  mut failures : Array[LoopFailure]
  mut attempts : Map[String, Int32]
  mut last_failed_step : Map[String, Int32]
  mut last_kind : Map[String, LoopFailureKind]
  mut tool_attempts : Map[String, Int32]
} derive(Eq, Debug)

///|
pub extend RunState with Eq::{equal, not_equal}

///|
pub extend RunState with Debug::{to_repr}

///|
pub fn RunState::new() -> RunState {
  {
    steps: 0,
    exec_count: 0,
    llm_count: 0,
    approval_count: 0,
    consecutive_failures: 0,
    observations: [],
    failures: [],
    attempts: Map([]),
    last_failed_step: Map([]),
    last_kind: Map([]),
    tool_attempts: Map([]),
  }
}

///|
/// Count one failure of a call: attempts, cooldown and the failure streak.
/// The retry counters are keyed by the call signature (tool plus arguments),
/// so a failed call never blocks a different call of the same tool.
pub fn RunState::count_failure(
  self : RunState,
  signature : String,
  tool : String,
  kind : LoopFailureKind,
  step : Int32,
) -> Unit {
  let used = match self.attempts.get(signature) {
    Some(n) => n
    None => 0
  }
  self.attempts.set(signature, used + 1)
  self.last_failed_step.set(signature, step)
  self.last_kind.set(signature, kind)
  let tool_used = match self.tool_attempts.get(tool) {
    Some(n) => n
    None => 0
  }
  self.tool_attempts.set(tool, tool_used + 1)
  self.consecutive_failures = self.consecutive_failures + 1
}

///|
/// How often this exact call already failed.
pub fn RunState::attempt_count(self : RunState, signature : String) -> Int32 {
  match self.attempts.get(signature) {
    Some(n) => n
    None => 0
  }
}

///|
/// How often the tool failed, whatever the arguments were.
pub fn RunState::tool_attempt_count(self : RunState, tool : String) -> Int32 {
  match self.tool_attempts.get(tool) {
    Some(n) => n
    None => 0
  }
}

///|
/// The failure kind this call last failed with.
pub fn RunState::last_failure_kind(self : RunState, signature : String) -> LoopFailureKind {
  match self.last_kind.get(signature) {
    Some(k) => k
    None => LoopFailureKind::UnknownTool
  }
}

///|
/// Message of the most recent failure, for the stop-loss conclusion.
pub fn RunState::last_failure_message(self : RunState) -> String {
  if self.failures.length() == 0 {
    return "none"
  }
  self.failures[self.failures.length() - 1].message
}

///|
/// Four Host operations. No fifth "run the model again" method.
pub(open) trait AgentLoopHost {
  fn llm_chat(Self, Array[LoopMessage]) -> LlmChatReply
  fn exec_tool(Self, String, String) -> String
  fn request_approval(Self, String, String) -> ApprovalVerdict
  fn deliver(Self, String) -> Unit
}

///|
/// Scripted host for A1–A6. `approved` inside arguments is not a field here.
pub(all) struct MockAgentHost {
  replies : Array[LlmChatReply]
  mut reply_i : Int32
  repeat_last : Bool
  exec_results : Array[String]
  mut exec_i : Int32
  exec_repeat : Bool
  execs : Array[String]
  approvals : Array[String]
  deliveries : Array[String]
  llm_seen : Array[String]
  deny_all : Bool
  cancel_on_approval : Bool
}

///|
pub fn MockAgentHost::scripts(replies : Array[LlmChatReply]) -> MockAgentHost {
  {
    replies,
    reply_i: 0,
    repeat_last: false,
    exec_results: [],
    exec_i: 0,
    exec_repeat: false,
    execs: [],
    approvals: [],
    deliveries: [],
    llm_seen: [],
    deny_all: false,
    cancel_on_approval: false,
  }
}

///|
pub impl AgentLoopHost for MockAgentHost with fn llm_chat(self, messages) {
  let mut blob = ""
  for m in messages {
    blob = blob + m.role + ":" + m.content + "\n"
  }
  self.llm_seen.push(blob)
  let i = self.reply_i
  self.reply_i = i + 1
  if self.replies.length() == 0 {
    { content: "", tool_calls: [], cancelled: false, }
  } else if i < self.replies.length() {
    self.replies[i]
  } else if self.repeat_last {
    self.replies[self.replies.length() - 1]
  } else {
    { content: "", tool_calls: [], cancelled: false, }
  }
}

///|
pub impl AgentLoopHost for MockAgentHost with fn exec_tool(self, name, args) {
  self.execs.push(name + " " + args)
  let i = self.exec_i
  self.exec_i = i + 1
  if i < self.exec_results.length() {
    self.exec_results[i]
  } else if self.exec_repeat && self.exec_results.length() > 0 {
    self.exec_results[self.exec_results.length() - 1]
  } else {
    "ok"
  }
}

///|
pub impl AgentLoopHost for MockAgentHost with fn request_approval(
  self,
  name,
  _args,
) {
  self.approvals.push(name)
  if self.cancel_on_approval {
    ApprovalCancel
  } else if self.deny_all {
    ApprovalDeny
  } else {
    ApprovalAllow
  }
}

///|
pub impl AgentLoopHost for MockAgentHost with fn deliver(self, text) {
  self.deliveries.push(text)
}

///|
pub extend MockAgentHost with AgentLoopHost::{
  llm_chat,
  exec_tool,
  request_approval,
  deliver,
}

///|
fn fence_untrusted(name : String, body : String) -> String {
  "<cursor_untrusted_data source=\"" +
  name +
  "\">" +
  body +
  "</cursor_untrusted_data>"
}

///|
fn resolve_spec(reg : ToolRegistry, name : String) -> @tools.ToolSpec? {
  let mut canon = name
  if name == "fs_read" || name == "read" || name == "Read" {
    canon = "Read"
  } else if name == "shell" || name == "Shell" {
    canon = "Shell"
  } else if name == "todo_write" || name == "TodoWrite" {
    canon = "TodoWrite"
  } else if name == "describeSchedule" || name == "DescribeSchedule" {
    // C-1: models reach for camelCase as often as snake_case. A tool the
    // model cannot name is a tool the model will never use.
    canon = "describe_schedule"
  } else if name == "createTeammate" || name == "CreateTeammate" {
    canon = "create_teammate"
  } else if name == "createRoutine" || name == "CreateRoutine" {
    canon = "create_routine"
  } else if name == "webSearch" || name == "WebSearch" || name == "search_web" {
    // C-2: B-class product tools (the Host runs them).
    canon = "web_search"
  } else if name == "webFetch" || name == "WebFetch" || name == "open_url" {
    canon = "web_fetch"
  } else if name == "sendMail" || name == "SendMail" || name == "mail_send" {
    canon = "send_mail"
  }
  for s in reg.specs {
    if s.id == canon || s.id == name {
      return Some(s)
    }
  }
  None
}

///|
fn spec_needs_approval(spec : @tools.ToolSpec) -> Bool {
  spec.requires_approval || spec.id == "Shell" || spec.id == "shell"
}

///|
/// The kernel handles the planning tool itself — the Host never executes it.
fn is_todo_tool(id : String) -> Bool {
  id == "TodoWrite" || id == "todo_write"
}

///|
/// The step cap: a caller may lower `self.max_steps`, never raise it above
/// the hard 64-step limit.
pub fn AgentLoop::effective_max_steps(self : AgentLoop) -> Int32 {
  let asked = self.max_steps
  if asked < 1 {
    return 1
  }
  if asked > AGENT_LOOP_MAX_STEPS {
    return AGENT_LOOP_MAX_STEPS
  }
  asked
}

///|
/// Split a Host tool result into output, duration, exit code and error. The
/// Host may prefix the result with `tool_duration_ms: <n>` and
/// `tool_error: <message>`; both prefixes are stripped from the output the
/// model sees.
fn split_tool_result(raw : String) -> (String, Int32, Bool, String) {
  let mut rest = raw
  let mut duration_ms : Int32 = -1
  let mut error = false
  let mut error_message = ""
  let mut scanning = true
  while scanning {
    scanning = false
    if rest.has_prefix(LOOP_TOOL_DURATION_MARKER) {
      let tail = rest[LOOP_TOOL_DURATION_MARKER.length():].to_owned()
      duration_ms = parse_int_or(first_line(tail).trim().to_owned(), -1)
      rest = after_first_line(tail)
      scanning = true
    } else if rest.has_prefix(LOOP_TOOL_ERROR_MARKER) {
      let tail = rest[LOOP_TOOL_ERROR_MARKER.length():].to_owned()
      error = true
      error_message = first_line(tail).trim().to_owned()
      rest = after_first_line(tail)
      scanning = true
    }
  }
  (rest, duration_ms, error, error_message)
}

///|
/// Text up to the first newline.
fn first_line(text : String) -> String {
  match text.find("\n") {
    None => text
    Some(at) => text[0:at].to_owned()
  }
}

///|
/// Text after the first newline.
fn after_first_line(text : String) -> String {
  match text.find("\n") {
    None => ""
    Some(at) => text[at + 1:].to_owned()
  }
}

///|
/// The retry cap and the step-based backoff. A tool that already failed too
/// often is never executed again, and a tool that just failed has to cool
/// down for `backoff_steps` steps. The kernel has no wall clock, so the
/// backoff is counted in loop steps.
fn retry_gate(
  policy : LoopRetryPolicy,
  state : RunState,
  call : ToolCallReq,
) -> String? {
  let signature = call_signature(call)
  let used = state.attempt_count(signature)
  if used >= policy.max_attempts_per_tool {
    return Some(
      "tool tripped after " +
      used.to_string() +
      " failed attempts: " +
      call.name +
      " (do not retry)",
    )
  }
  match state.last_failed_step.get(signature) {
    Some(last) => {
      if state.steps - last <= policy.backoff_steps {
        return Some(
          "backoff: " +
          call.name +
          " failed at step " +
          last.to_string() +
          " (retry later)",
        )
      }
    }
    None => ()
  }
  None
}

///|
/// Identity of one tool call: the tool plus its arguments. The retry cap and
/// the backoff are counted per call, not per tool.
pub fn call_signature(call : ToolCallReq) -> String {
  call.name + " " + call.arguments_json
}

///|
/// Apply a plan action to the turn with the existing todo primitives.
fn apply_todo_action(
  turn_ctx : TurnContext,
  action : TodoAction,
) -> Result[TurnContext, String] {
  match action {
    TodoAction::Replace(items) => turn_ctx.todo_write(items)
    TodoAction::MarkDone(id) => turn_ctx.mark_todo_done(id=id)
    TodoAction::SetStatus(id, status) =>
      match turn_ctx.mark_todo_done(id=id) {
        Err(e) => Err(e)
        Ok(next) => {
          if status == "done" || status == "completed" {
            Ok(next)
          } else {
            let items : Array[TodoItem] = []
            for t in next.todos {
              if t.id == id {
                items.push({ id: t.id, content: t.content, status: status, })
              } else {
                items.push(t)
              }
            }
            next.todo_write(items)
          }
        }
      }
  }
}

///|
/// Record a structured invalid-arguments failure plus the observation the
/// model sees.
fn record_invalid_args(
  call : ToolCallReq,
  message : String,
  state : RunState,
  agent_ctx : AgentContext,
) -> Unit {
  state.observations.push(message)
  state.failures.push({
    kind: LoopFailureKind::InvalidArguments,
    tool_name: call.name,
    call_id: call.id,
    message,
    step: state.steps,
    attempt: 1,
    blocked: false,
  })
  state.count_failure(
    call_signature(call),
    call.name,
    LoopFailureKind::InvalidArguments,
    state.steps,
  )
  agent_ctx.append_observation(
    call.name,
    fence_untrusted(call.name, message),
    step=state.steps,
  )
}

///|
/// Kernel-handled planning tool: the model writes the plan, the kernel keeps
/// it in the session context so the next model call sees it.
fn handle_todo_call(
  call : ToolCallReq,
  state : RunState,
  agent_ctx : AgentContext,
  turn_ctx : TurnContext,
) -> TurnContext {
  match parse_todo_action(call.arguments_json) {
    Err(e) => {
      record_invalid_args(call, e, state, agent_ctx)
      turn_ctx
    }
    Ok(action) =>
      match apply_todo_action(turn_ctx, action) {
        Err(e) => {
          record_invalid_args(call, e, state, agent_ctx)
          turn_ctx
        }
        Ok(next_ctx) => {
          agent_ctx.set_todos(next_ctx.visible_todos())
          let obs =
            "plan updated: " +
            next_ctx.visible_todos().length().to_string() +
            " items, " +
            next_ctx.done_todo_count().to_string() +
            " done"
          state.observations.push(obs)
          agent_ctx.append_tool(
            call.name,
            fence_untrusted(call.name, obs),
            step=state.steps,
          )
          agent_ctx.record_trace({
            tool_name: call.name,
            args_json: call.arguments_json,
            result_snippet: obs,
            duration_ms: -1,
            exit_code: -1,
            error: false,
            timestamp: agent_ctx.session() + "#" + state.steps.to_string(),
          })
          state.consecutive_failures = 0
          next_ctx
        }
      }
  }
}

///|
/// Run one approved host tool and record the observation plus the trace.
fn[H : AgentLoopHost] run_approved_tool(
  host : H,
  call : ToolCallReq,
  step : Int32,
  turn_id : String,
  state : RunState,
  agent_ctx : AgentContext,
) -> Bool {
  let raw = host.exec_tool(call.name, call.arguments_json)
  let (output, duration_ms, error, error_message) = split_tool_result(raw)
  state.exec_count = state.exec_count + 1
  let observation = if error { error_message } else { output }
  state.observations.push(observation)
  agent_ctx.append_tool(
    call.name,
    fence_untrusted(call.name, output),
    step=step,
  )
  agent_ctx.record_trace({
    tool_name: call.name,
    args_json: call.arguments_json,
    result_snippet: clip_text(observation, 200),
    duration_ms,
    exit_code: extract_exit_code(observation),
    error,
    timestamp: turn_id + "#" + step.to_string(),
  })
  if error {
    state.failures.push({
      kind: LoopFailureKind::ToolExecutionFailed,
      tool_name: call.name,
      call_id: call.id,
      message: observation,
      step,
      attempt: state.attempt_count(call_signature(call)) + 1,
      blocked: false,
    })
    state.count_failure(
      call_signature(call),
      call.name,
      LoopFailureKind::ToolExecutionFailed,
      step,
    )
    true
  } else {
    state.consecutive_failures = 0
    false
  }
}

///|
/// Validate, ask for approval and run one host tool. Returns true when the
/// user cancelled the turn.
fn[H : AgentLoopHost] handle_host_call(
  host : H,
  spec : @tools.ToolSpec,
  call : ToolCallReq,
  state : RunState,
  agent_ctx : AgentContext,
  turn_id : String,
) -> Bool {
  match
    @tools.validate_args_against_schema(
      spec.input_schema_json,
      call.arguments_json,
    ) {
    Err(e) => {
      record_invalid_args(call, e, state, agent_ctx)
      false
    }
    Ok(_) => {
      if spec_needs_approval(spec) {
        state.approval_count = state.approval_count + 1
        let verdict = host.request_approval(call.name, call.arguments_json)
        match verdict {
          ApprovalCancel => true
          ApprovalDeny => {
            let obs = "approval denied: " + call.name
            state.observations.push(obs)
            state.failures.push({
              kind: LoopFailureKind::ApprovalDenied,
              tool_name: call.name,
              call_id: call.id,
              message: obs,
              step: state.steps,
              attempt: 1,
              blocked: false,
            })
            state.count_failure(
              call_signature(call),
              call.name,
              LoopFailureKind::ApprovalDenied,
              state.steps,
            )
            agent_ctx.append_observation(
              call.name,
              fence_untrusted(call.name, obs),
              step=state.steps,
            )
            false
          }
          ApprovalAllow => {
            let _ = run_approved_tool(
              host,
              call,
              state.steps,
              turn_id,
              state,
              agent_ctx,
            )
            false
          }
        }
      } else {
        let _ = run_approved_tool(
          host,
          call,
          state.steps,
          turn_id,
          state,
          agent_ctx,
        )
        false
      }
    }
  }
}

///|
fn finish_run(
  ctx : TurnContext,
  stop : LoopStop,
  state : RunState,
  delivered : String,
  agent_ctx : AgentContext,
  max_steps : Int32,
) -> AgentRun {
  {
    turn_id: ctx.turn_id.value,
    stop,
    steps: state.steps,
    max_steps,
    exec_count: state.exec_count,
    llm_count: state.llm_count,
    approval_count: state.approval_count,
    delivered,
    observations: state.observations,
    failures: state.failures,
    traces: agent_ctx.traces,
    todos: agent_ctx.todos,
    context: agent_ctx,
  }
}

///|
/// Entry after `open_turn`. The session starts empty here; use
/// `AgentLoop::run_with` to continue a session that already has history.
pub fn[H : AgentLoopHost] AgentLoop::run(
  self : AgentLoop,
  ctx : TurnContext,
  host : H,
) -> AgentRun {
  self.run_with(ctx, host, AgentContext::new(session_id=ctx.session_id.value))
}

///|
/// Continue a session. The caller owns the context, so the history survives
/// across turns; a context rebuilt with `AgentContext::decode` also survives
/// a process restart.
pub fn[H : AgentLoopHost] AgentLoop::run_with(
  self : AgentLoop,
  ctx : TurnContext,
  host : H,
  agent_ctx : AgentContext,
  policy~ : LoopRetryPolicy = default_retry_policy(),
) -> AgentRun {
  self.run_with_summarizer(
    ctx,
    host,
    agent_ctx,
    HeuristicSummarizer::new(),
    policy=policy,
  )
}

///|
/// Same as `run_with`, with a Host-supplied summarizer for the compaction
/// of older turns.
pub fn[H : AgentLoopHost, S : AgentSummarizer] AgentLoop::run_with_summarizer(
  self : AgentLoop,
  ctx : TurnContext,
  host : H,
  agent_ctx : AgentContext,
  summarizer : S,
  policy~ : LoopRetryPolicy = default_retry_policy(),
) -> AgentRun {
  let max_steps = self.effective_max_steps()
  let state = RunState::new()
  let mut turn_ctx = ctx
  agent_ctx.append_user(ctx.inbound_text)
  while state.steps < max_steps {
    // Second stop condition: the session token budget. Compact first, and
    // stop when even the compacted context does not fit.
    if agent_ctx.over_budget() {
      let _ = agent_ctx.compact(summarizer)
      if agent_ctx.over_budget() {
        let msg = "agent loop stopped: token budget exhausted"
        host.deliver(msg)
        return finish_run(ctx, LoopStop::TokenBudget, state, msg, agent_ctx, max_steps)
      }
    }
    state.steps = state.steps + 1
    let reply = host.llm_chat(agent_ctx.wire_messages())
    if reply.cancelled {
      return finish_run(ctx, LoopStop::Cancelled, state, "", agent_ctx, max_steps)
    }
    state.llm_count = state.llm_count + 1
    if reply.content.has_prefix(LOOP_PROVIDER_ERROR_MARKER) {
      let reason = reply.content[LOOP_PROVIDER_ERROR_MARKER.length():].to_owned()
      state.failures.push({
        kind: LoopFailureKind::ProviderFailed,
        tool_name: "",
        call_id: "",
        message: reason,
        step: state.steps,
        attempt: 0,
        blocked: false,
      })
      let msg = "agent loop stopped: provider failed: " + reason
      host.deliver(msg)
      return finish_run(
        ctx,
        LoopStop::ProviderFailed,
        state,
        msg,
        agent_ctx,
        max_steps,
      )
    }
    if reply.tool_calls.length() == 0 {
      agent_ctx.append_assistant(reply.content, step=state.steps)
      host.deliver(reply.content)
      return finish_run(ctx, LoopStop::Final, state, reply.content, agent_ctx, max_steps)
    }
    for call in reply.tool_calls {
      agent_ctx.append_assistant(
        call.name + " " + call.arguments_json,
        step=state.steps,
      )
      // 1) retry gate — a tripped or cooling-down tool is never executed.
      match retry_gate(policy, state, call) {
        Some(refusal) => {
          state.observations.push(refusal)
          state.failures.push({
            kind: state.last_failure_kind(call_signature(call)),
            tool_name: call.name,
            call_id: call.id,
            message: refusal,
            step: state.steps,
            attempt: state.attempt_count(call_signature(call)),
            blocked: true,
          })
          agent_ctx.append_observation(
            call.name,
            fence_untrusted(call.name, refusal),
            step=state.steps,
          )
          state.consecutive_failures = state.consecutive_failures + 1
        }
        None =>
          // 2) the tool has to exist.
          match resolve_spec(self.registry, call.name) {
            None => {
              let obs = "unknown tool: " + call.name
              state.observations.push(obs)
              state.failures.push({
                kind: LoopFailureKind::UnknownTool,
                tool_name: call.name,
                call_id: call.id,
                message: obs,
                step: state.steps,
                attempt: 1,
                blocked: false,
              })
              state.count_failure(
                call_signature(call),
                call.name,
                LoopFailureKind::UnknownTool,
                state.steps,
              )
              agent_ctx.append_observation(
                call.name,
                fence_untrusted(call.name, obs),
                step=state.steps,
              )
            }
            Some(spec) =>
              // 3) the kernel owns the planning tool; the Host never runs it.
              if is_todo_tool(spec.id) {
                turn_ctx = handle_todo_call(
                  call,
                  state,
                  agent_ctx,
                  turn_ctx,
                )
              } else {
                // 4) validate, approve, run.
                let cancelled = handle_host_call(
                  host,
                  spec,
                  call,
                  state,
                  agent_ctx,
                  ctx.turn_id.value,
                )
                if cancelled {
                  return finish_run(
                    ctx,
                    LoopStop::Cancelled,
                    state,
                    "",
                    agent_ctx,
                    max_steps,
                  )
                }
              }
          }
      }
    }
    // Stop-loss: repeated failures end the loop instead of grinding on.
    if state.consecutive_failures >= policy.max_consecutive_failures {
      let msg =
        "agent loop stopped after " +
        state.consecutive_failures.to_string() +
        " consecutive tool failures (last: " +
        state.last_failure_message() +
        ")"
      host.deliver(msg)
      return finish_run(ctx, LoopStop::Failed, state, msg, agent_ctx, max_steps)
    }
  }
  finish_run(ctx, LoopStop::MaxSteps, state, "", agent_ctx, max_steps)
}
