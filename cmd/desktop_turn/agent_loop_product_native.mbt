///|
#borrow(line)
extern "C" fn bitbot_ffi_trace(line : String) -> Unit = "bitbot_ffi_trace"

///|
#borrow(request)
extern "C" fn bitbot_ffi_exchange(request : String) -> String = "bitbot_ffi_exchange"

///|
struct ProductFfiHost {
  marker : Int32
}

///|
fn ProductFfiHost::new() -> ProductFfiHost {
  { marker: 1, }
}

///|
fn ProductFfiHost::touch(self : ProductFfiHost) -> Unit {
  if self.marker < 0 {
    bitbot_ffi_trace("marker")
  }
}

///|
fn agent_stop_name(stop : @runtime.LoopStop) -> String {
  match stop {
    @runtime.Final => "Final"
    @runtime.MaxSteps => "MaxSteps"
    @runtime.Cancelled => "Cancelled"
  }
}

///|
fn legacy_chat_effect(args : Array[String]) -> Bool {
  for a in args {
    if a == "--legacy-chat-effect" {
      return true
    }
  }
  match @env.get_env_var("BITBOT_LEGACY_CHAT_EFFECT") {
    Some("1") => true
    _ => false
  }
}

///|
fn want_product_agent_loop(args : Array[String], text : String) -> Bool {
  if legacy_chat_effect(args) {
    return false
  }
  let trimmed = text.trim().to_owned()
  if trimmed == "" {
    return false
  }
  classify_intent(trimmed) is Chat
}

///|
fn product_tool_registry() -> @runtime.ToolRegistry {
  let reg = @runtime.ToolRegistry::empty()
  reg.register({
    id: "Read",
    description: "Read a file",
    builtin: Some(@tools.Read),
    input_schema_json: "{\"required\":[\"path\"]}",
    requires_approval: false,
  })
  reg.register({
    id: "Shell",
    description: "Run a shell command",
    builtin: Some(@tools.Shell),
    input_schema_json: "{\"required\":[\"command\"]}",
    requires_approval: false,
  })
  reg
}

///|
pub impl @runtime.AgentLoopHost for ProductFfiHost with fn llm_chat(
  self,
  messages,
) {
  self.touch()
  bitbot_ffi_trace("op=llm_chat")
  parse_product_llm_reply(
    bitbot_ffi_exchange(encode_product_messages(messages)),
  )
}

///|
pub impl @runtime.AgentLoopHost for ProductFfiHost with fn exec_tool(
  self,
  name,
  args,
) {
  self.touch()
  bitbot_ffi_trace("op=exec_tool")
  parse_product_output(
    bitbot_ffi_exchange(encode_product_tool("exec_tool", name, args)),
  )
}

///|
pub impl @runtime.AgentLoopHost for ProductFfiHost with fn request_approval(
  self,
  name,
  args,
) {
  self.touch()
  bitbot_ffi_trace("op=request_approval")
  parse_product_verdict(
    bitbot_ffi_exchange(encode_product_tool("request_approval", name, args)),
  )
}

///|
pub impl @runtime.AgentLoopHost for ProductFfiHost with fn deliver(self, text) {
  self.touch()
  bitbot_ffi_trace("op=deliver")
  let _ = bitbot_ffi_exchange(encode_product_deliver(text))
}

///|
pub extend ProductFfiHost with @runtime.AgentLoopHost::{
  llm_chat,
  exec_tool,
  request_approval,
  deliver,
}

///|
fn run_agent_loop_chat(
  text : String,
  turn_id : String,
  ctx : DesktopTurnContext,
) -> DesktopTurnResult {
  let opened = @runtime.open_turn(turn_id~, text~)
  bitbot_ffi_trace("entry=AgentLoop::run")
  let host = ProductFfiHost::new()
  let run = @runtime.AgentLoop::new(product_tool_registry()).run(opened, host)
  let ok = run.stop is @runtime.Final || run.stop is @runtime.MaxSteps
  let err = if run.stop is @runtime.Cancelled {
    Some("cancelled")
  } else {
    None
  }
  {
    v: DESKTOP_TURN_JSON_V,
    ok,
    turn_id: run.turn_id,
    intent: "chat",
    messages: [
      { role: "user", text, },
      { role: "assistant", text: run.delivered, },
    ],
    modules: @bitbot.registered_modules(),
    machines: [],
    memory: [],
    effects: [],
    needs_host_ffi: false,
    host_continued: false,
    channel_delivery: "",
    session_id: ctx.session_id,
    machine_id: ctx.machine_id,
    machine_kind: ctx.machine_kind,
    channel: ctx.channel,
    reply_to: ctx.reply_to,
    plan: "open_turn AgentLoop::run",
    error: err,
    agent_loop: true,
    agent_entry: "open_turn",
    agent_stop: agent_stop_name(run.stop),
    agent_steps: run.steps,
    agent_llm: run.llm_count,
    agent_exec: run.exec_count,
    agent_approval: run.approval_count,
  }
}

///|
fn dispatch_desktop_main(args : Array[String]) -> DesktopTurnResult {
  let ctx = parse_turn_context(args)
  if args_want_host_continue(args) {
    let (turn_id, prior, results) = parse_host_continue_args(args)
    return continue_after_host_ffi(
      turn_id~,
      prior_user_text=prior,
      results,
      ctx~,
    )
  }
  let seeds = parse_memory_seeds(args)
  let text = user_text_from_args_skipping_flags(args)
  let turn_id = parse_turn_id_flag(args, default="desktop-1")
  if want_product_agent_loop(args, text) {
    run_agent_loop_chat(text, turn_id, ctx)
  } else {
    run_desktop_turn(text, turn_id~, memory_seeds=seeds, ctx~)
  }
}
