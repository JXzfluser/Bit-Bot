///|
/// Desktop host CLI: one MoonBit turn → JSON on stdout.
/// ADR 0002 Host FFI 回注: `--apply-host-results` absorbs Host execution results.
fn main {
  let args = @env.args()
  if args_want_host_continue(args) {
    let (turn_id, prior, results) = parse_host_continue_args(args)
    let result = continue_after_host_ffi(
      turn_id~,
      prior_user_text=prior,
      results,
    )
    println(result.to_json_line())
  } else {
    let text = user_text_from_args(args)
    let result = run_desktop_turn(text)
    println(result.to_json_line())
  }
}
