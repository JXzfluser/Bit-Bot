///|
/// Desktop / multi-end host CLI: one MoonBit turn → JSON on stdout.
/// ADR 0002 Host FFI 回注: `--apply-host-results` absorbs Host execution results.
/// Session memory: `--seed-memory key=value` (repeatable) from Host disk.
/// TurnContext: `--session-id` `--machine-id` `--machine-kind` `--channel`.
fn main {
  let args = @env.args()
  println(dispatch_desktop_main(args).to_json_line())
}
