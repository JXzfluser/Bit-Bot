///|
/// Desktop / multi-end host CLI: one MoonBit turn → JSON on stdout.
/// ADR 0002 Host FFI 回注: `--apply-host-results` absorbs Host execution results.
/// Session memory: `--seed-memory key=value` (repeatable) from Host disk.
/// TurnContext: `--session-id` `--machine-id` `--machine-kind` `--channel`.
fn main {
  let args = @env.args()
  let ctx = parse_turn_context(args)
  if args_want_host_continue(args) {
    let (turn_id, prior, results) = parse_host_continue_args(args)
    let result = continue_after_host_ffi(
      turn_id~,
      prior_user_text=prior,
      results,
      ctx~,
    )
    println(result.to_json_line())
  } else {
    let seeds = parse_memory_seeds(args)
    let text = user_text_from_args_skipping_flags(args)
    let turn_id = parse_turn_id_flag(args, default="desktop-1")
    let result = run_desktop_turn(text, turn_id~, memory_seeds=seeds, ctx~)
    println(result.to_json_line())
  }
}
