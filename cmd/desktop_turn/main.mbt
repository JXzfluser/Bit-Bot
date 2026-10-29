///|
/// Desktop / multi-end host CLI: one MoonBit turn → JSON on stdout.
/// ADR 0002 Host FFI 回注: `--apply-host-results` absorbs Host execution results.
/// Session memory: `--seed-memory key=value` (repeatable) from Host disk.
/// TurnContext: `--session-id` `--machine-id` `--machine-kind` `--channel`.
/// T1-07: `--serve` keeps this process alive and takes one argv line per turn.
fn main {
  let args = @env.args()
  if serve_requested(args) {
    run_desktop_serve()
  } else {
    println(dispatch_desktop_main(args).to_json_line())
  }
}
