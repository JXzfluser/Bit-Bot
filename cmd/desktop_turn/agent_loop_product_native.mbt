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
    @runtime.TokenBudget => "TokenBudget"
    @runtime.Failed => "Failed"
    @runtime.ProviderFailed => "ProviderFailed"
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
  // The schema below is the SINGLE source of truth: it is what the model
  // sees (serialized into the llm_chat FFI request) AND what the kernel
  // validates arguments against. The Host used to keep a second, hard-coded
  // copy — adding a tool meant editing two places, and forgetting one made
  // the model unable to call a tool the kernel could happily run.
  reg.register({
    id: "Read",
    description: "Read a file",
    builtin: Some(@tools.Read),
    input_schema_json: "{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"}},\"required\":[\"path\"]}",
    requires_approval: false,
  })
  reg.register({
    id: "Shell",
    description: "Run a shell command",
    builtin: Some(@tools.Shell),
    input_schema_json: "{\"type\":\"object\",\"properties\":{\"command\":{\"type\":\"string\"}},\"required\":[\"command\"]}",
    requires_approval: false,
  })
  // CM-0112: the model drives its own plan. The kernel keeps the checklist
  // and shows it back on the next model call; the Host persists it.
  reg.register({
    id: "TodoWrite",
    description: "Write the task checklist",
    builtin: None,
    input_schema_json: "{\"type\":\"object\",\"properties\":{\"todos\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"},\"content\":{\"type\":\"string\"},\"status\":{\"type\":\"string\"}}}}},\"required\":[\"todos\"]}",
    requires_approval: false,
  })
  reg
}

///|
/// The tool catalog as the model sees it, serialized from the SAME registry
/// the loop dispatches against. Sent to the Host with every llm_chat request
/// so the provider payload cannot drift from what the kernel can execute.
fn product_tool_schema_json() -> String {
  let reg = product_tool_registry()
  let buf = StringBuilder()
  buf.write_string("[")
  let mut i = 0
  for sp in reg.specs {
    if i > 0 {
      buf.write_string(",")
    }
    buf.write_string("{\"type\":\"function\",\"function\":{\"name\":\"")
    buf.write_string(escape_json_string(sp.id))
    buf.write_string("\",\"description\":\"")
    buf.write_string(escape_json_string(sp.description))
    buf.write_string("\",\"parameters\":")
    // input_schema_json is already a JSON document; embed it as-is.
    buf.write_string(sp.input_schema_json)
    buf.write_string("}}")
    i = i + 1
  }
  buf.write_string("]")
  buf.to_string()
}

///|
/// Serialize the plan for the Host todo_write effect (CM-0112).
fn todo_effect_command(todos : Array[@runtime.TodoItem]) -> String {
  let buf = StringBuilder()
  buf.write_string("[")
  let mut i = 0
  for t in todos {
    if i > 0 {
      buf.write_string(",")
    }
    buf.write_string("{\"id\":\"")
    buf.write_string(escape_json_string(t.id))
    buf.write_string("\",\"title\":\"")
    buf.write_string(escape_json_string(t.content))
    buf.write_string("\",\"status\":\"")
    buf.write_string(escape_json_string(t.status))
    buf.write_string("\"}")
    i = i + 1
  }
  buf.write_string("]")
  buf.to_string()
}

///|
pub impl @runtime.AgentLoopHost for ProductFfiHost with fn llm_chat(
  self,
  messages,
) {
  self.touch()
  bitbot_ffi_trace("op=llm_chat")
  parse_product_llm_reply(
    bitbot_ffi_exchange(encode_product_messages(messages, product_tool_schema_json())),
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
  // CM-1106 / GP-101（§8.3）：粘贴密钥不是一次回合。旧 chat 分支的这道内核
  // 兜底必须同样挡在 AgentLoop 入口前，否则 CLI/API 调用方能把明文塞进历史。
  match @ui_protocol.paste_token_into_chat(text) {
    Err(reason) =>
      return fail_turn(
        @ui_protocol.redact_secrets(text),
        turn_id,
        Chat,
        reason,
        ctx,
        assistant="拒绝在对话中粘贴密钥（CM-1106）。请使用 Host 的安全密钥输入框；对话与模型只会看到 " +
          @ui_protocol.redact_secrets(text) +
          "。",
      )
    Ok(_) => ()
  }
  let opened = @runtime.open_turn(turn_id~, text~)
  bitbot_ffi_trace("entry=AgentLoop::run")
  let host = ProductFfiHost::new()
  let run = @runtime.AgentLoop::new(product_tool_registry()).run(opened, host)
  let ok = run.stop is @runtime.Final || run.stop is @runtime.MaxSteps
  let err = if run.stop is @runtime.Cancelled {
    Some("cancelled")
  } else if run.stop is @runtime.TokenBudget {
    Some("token budget exhausted")
  } else if run.stop is @runtime.Failed {
    Some("tool loop failed")
  } else if run.stop is @runtime.ProviderFailed {
    Some("provider failed")
  } else {
    None
  }
  // CM-0112: a plan the model wrote becomes one durable Host todo_write
  // effect. The kernel never claims an item is done on its own.
  let effects : Array[DesktopEffect] = if run.todos.length() > 0 {
    [
      {
        kind: "todo_write",
        command: todo_effect_command(run.todos),
        needs_host_ffi: true,
      },
    ]
  } else {
    []
  }
  // GP-93：产品可见的链接统一走同一套 linkify，AgentLoop 的交付也不例外。
  let delivered = @ui_protocol.linkify_bare_http_urls(run.delivered)
  {
    v: DESKTOP_TURN_JSON_V,
    ok,
    turn_id: run.turn_id,
    intent: "chat",
    messages: [
      { role: "user", text, },
      { role: "assistant", text: delivered, },
    ],
    modules: @bitbot.registered_modules(),
    machines: [],
    memory: [],
    effects,
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
