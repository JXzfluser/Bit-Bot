///|
fn touch_product_codecs() -> Unit {
  let _ = encode_product_messages([], "[]")
  let _ = encode_product_tool("exec_tool", "Read", "{}")
  let _ = encode_product_deliver("")
}

///|
/// Wasm/tests keep the legacy planner. The native target owns the live loop.
fn dispatch_desktop_main(args : Array[String]) -> DesktopTurnResult {
  if args.length() < 0 {
    touch_product_codecs()
  }
  let ctx = parse_turn_context(args)
  if args_want_host_continue(args) {
    let (turn_id, prior, results) = parse_host_continue_args(args)
    continue_after_host_ffi(turn_id~, prior_user_text=prior, results, ctx~)
  } else {
    let seeds = parse_memory_seeds(args)
    let text = user_text_from_args_skipping_flags(args)
    let turn_id = parse_turn_id_flag(args, default="desktop-1")
    run_desktop_turn(text, turn_id~, memory_seeds=seeds, ctx~)
  }
}

///|
/// 常驻模式只在 native/llvm 后端可用：wasm 里没有阻塞读 stdin 这回事，硬撑成
/// 循环会把测试挂住。这里如实回一行错误，让 Host 立刻知道「这个后端不能服务」。
fn run_desktop_serve() -> Unit {
  println(serve_handle_request(""))
}
