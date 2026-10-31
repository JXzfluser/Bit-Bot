///|
/// Desktop / multi-end host CLI: one MoonBit turn → JSON on stdout.
/// ADR 0002 Host FFI 回注: `--apply-host-results` absorbs Host execution results.
/// Session memory: `--seed-memory key=value` (repeatable) from Host disk.
/// TurnContext: `--session-id` `--machine-id` `--machine-kind` `--channel`.
/// T1-07: `--serve` keeps this process alive and takes one argv line per turn.
///
/// `--secret-probe <text>` is not a turn: it prints the kernel's verdict for
/// the shared secret-shape rules and exits. It exists so the Host side can be
/// checked against the kernel BEHAVIOURALLY, not only by comparing the two
/// rule tables (`scripts/prove_secret_shapes.mjs` does both). The kernel is
/// the backstop that keeps plaintext out of the transcript for CLI and API
/// callers, which have no renderer of their own — so "the Host catches it"
/// is not enough.
fn main {
  let args = @env.args()
  match secret_probe_arg(args) {
    Some(text) => {
      println(secret_probe_answer(text))
      return
    }
    None => ()
  }
  if serve_requested(args) {
    run_desktop_serve()
  } else {
    println(dispatch_desktop_main(args).to_json_line())
  }
}

///|
/// Read `--secret-probe <text>` out of argv.
fn secret_probe_arg(args : Array[String]) -> String? {
  let mut i = 0
  while i < args.length() {
    if args[i] == "--secret-probe" && i + 1 < args.length() {
      return Some(args[i + 1])
    }
    i = i + 1
  }
  None
}

///|
/// The probe answer: one line, `secret=true|false`.
fn secret_probe_answer(text : String) -> String {
  let verdict = if @core.looks_like_secret(text) { "true" } else { "false" }
  "secret=" + verdict
}
