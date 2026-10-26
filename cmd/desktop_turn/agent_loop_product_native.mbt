///|
#borrow(line)
extern "C" fn bitbot_ffi_trace(line : String) -> Unit = "bitbot_ffi_trace"

///|
#borrow(request)
extern "C" fn bitbot_ffi_exchange(request : String) -> String = "bitbot_ffi_exchange"

///|
struct ProductFfiHost {
  marker : Int32
  /// Product tools the kernel executed during this run. The kernel does the
  /// MoonBit-side work; the Host mirrors these effects after the turn.
  /// `Array` is a shared mutable reference, so pushes made inside `exec_tool`
  /// are visible to the caller that owns the host.
  effects : Array[DesktopEffect]
}

///|
fn ProductFfiHost::new(sink : Array[DesktopEffect]) -> ProductFfiHost {
  { marker: 1, effects: sink, }
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
  // Product tools are executed BY THE KERNEL, not by the Host. The Host FFI
  // only knows Read/Shell and would answer "exec refused: <name>" for anything
  // else — so intercept before the FFI round-trip. The kernel does the
  // MoonBit-side work, the effect is mirrored by the Host after the turn.
  //
  // B-class tools (web_search / web_fetch / send_mail) are NOT intercepted:
  // they need Host capabilities, and the Host must run them SYNCHRONOUSLY so
  // the model observes the real result instead of a promise.
  if is_kernel_tool(name) {
    let result = match parse_product_tool_action(name, args) {
      Ok(action) => exec_product_tool_action(action)
      Err(e) => ProductToolResult::{ observation: "invalid_arguments: " + e, effects: [], }
    }
    for e in result.effects {
      self.effects.push(e)
    }
    return encode_product_tool_output(result.observation)
  }
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
  // The effect sink is owned here, not by the host: the host is handed to
  // `run` by value, the sink stays reachable so the caller can read what the
  // kernel produced. `Array` is a shared mutable reference, so both see the
  // same buffer.
  let tool_effects : Array[DesktopEffect] = []
  let host = ProductFfiHost::new(tool_effects)
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
  //
  // C-1: product tools the kernel executed during the run become effects too
  // (teammate_create / routine_schedule). todo_write stays FIRST, so the
  // effect order for every run that used no product tool is unchanged — the
  // Host's ordering contract does not move.
  let effects : Array[DesktopEffect] = []
  if run.todos.length() > 0 {
    effects.push({
      kind: "todo_write",
      command: todo_effect_command(run.todos),
      needs_host_ffi: true,
    })
  }
  for e in tool_effects {
    effects.push(e)
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
