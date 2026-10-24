///|
/// Model-driven tool loop. Host executes; this state machine only calls
/// llm_chat / exec_tool / request_approval / deliver. Cap is 64, not the
/// struct field (a caller-supplied max_steps must not shrink or raise it).

///|
pub const AGENT_LOOP_MAX_STEPS : Int32 = 64

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
pub(all) enum LoopStop {
  Final
  MaxSteps
  Cancelled
} derive(Eq, Debug)

///|
pub extend LoopStop with Eq::{equal, not_equal}

///|
pub extend LoopStop with Debug::{to_repr}

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
} derive(Eq, Debug)

///|
pub extend AgentRun with Eq::{equal, not_equal}

///|
pub extend AgentRun with Debug::{to_repr}

///|
/// Four Host operations. No fifth "run the model again" method.
pub trait AgentLoopHost {
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
    { content: "", tool_calls: [], }
  } else if i < self.replies.length() {
    self.replies[i]
  } else if self.repeat_last {
    self.replies[self.replies.length() - 1]
  } else {
    { content: "", tool_calls: [], }
  }
}

///|
pub impl AgentLoopHost for MockAgentHost with fn exec_tool(self, name, args) {
  self.execs.push(name + " " + args)
  let i = self.exec_i
  self.exec_i = i + 1
  if i < self.exec_results.length() {
    self.exec_results[i]
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
fn finish_run(
  ctx : TurnContext,
  stop : LoopStop,
  steps : Int32,
  exec_count : Int32,
  llm_count : Int32,
  approval_count : Int32,
  delivered : String,
  observations : Array[String],
) -> AgentRun {
  {
    turn_id: ctx.turn_id.value,
    stop,
    steps,
    max_steps: AGENT_LOOP_MAX_STEPS,
    exec_count,
    llm_count,
    approval_count,
    delivered,
    observations,
  }
}

///|
/// Entry after `open_turn`. `self.max_steps` is ignored; the cap is 64.
pub fn[H : AgentLoopHost] AgentLoop::run(
  self : AgentLoop,
  ctx : TurnContext,
  host : H,
) -> AgentRun {
  let messages : Array[LoopMessage] = [
    { role: "user", content: ctx.inbound_text, },
  ]
  let observations : Array[String] = []
  let mut steps : Int32 = 0
  let mut exec_count : Int32 = 0
  let mut llm_count : Int32 = 0
  let mut approval_count : Int32 = 0
  while steps < AGENT_LOOP_MAX_STEPS {
    steps = steps + 1
    let reply = host.llm_chat(messages)
    llm_count = llm_count + 1
    if reply.tool_calls.length() == 0 {
      host.deliver(reply.content)
      return finish_run(
        ctx,
        Final,
        steps,
        exec_count,
        llm_count,
        approval_count,
        reply.content,
        observations,
      )
    }
    for call in reply.tool_calls {
      messages.push({
        role: "assistant",
        content: call.name + " " + call.arguments_json,
      })
      match resolve_spec(self.registry, call.name) {
        None => {
          let obs = "unknown tool: " + call.name
          observations.push(obs)
          messages.push({
            role: "tool",
            content: fence_untrusted(call.name, obs),
          })
        }
        Some(spec) =>
          match
            @tools.validate_args_against_schema(
              spec.input_schema_json,
              call.arguments_json,
            ) {
            Err(e) => {
              observations.push(e)
              messages.push({
                role: "tool",
                content: fence_untrusted(call.name, e),
              })
            }
            Ok(_) =>
              if spec_needs_approval(spec) {
                approval_count = approval_count + 1
                let verdict = host.request_approval(
                  call.name,
                  call.arguments_json,
                )
                match verdict {
                  ApprovalCancel =>
                    return finish_run(
                      ctx,
                      Cancelled,
                      steps,
                      exec_count,
                      llm_count,
                      approval_count,
                      "",
                      observations,
                    )
                  ApprovalDeny => {
                    let obs = "approval denied: " + call.name
                    observations.push(obs)
                    messages.push({
                      role: "tool",
                      content: fence_untrusted(call.name, obs),
                    })
                  }
                  ApprovalAllow => {
                    let out = host.exec_tool(call.name, call.arguments_json)
                    exec_count = exec_count + 1
                    observations.push(out)
                    messages.push({
                      role: "tool",
                      content: fence_untrusted(call.name, out),
                    })
                  }
                }
              } else {
                let out = host.exec_tool(call.name, call.arguments_json)
                exec_count = exec_count + 1
                observations.push(out)
                messages.push({
                  role: "tool",
                  content: fence_untrusted(call.name, out),
                })
              }
          }
      }
    }
  }
  finish_run(
    ctx,
    MaxSteps,
    steps,
    exec_count,
    llm_count,
    approval_count,
    "",
    observations,
  )
}
