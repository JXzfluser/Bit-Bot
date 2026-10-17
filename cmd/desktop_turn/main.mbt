///|
/// Desktop host CLI: one MoonBit turn → JSON on stdout.
fn main {
  let args = @env.args()
  let text = user_text_from_args(args)
  let result = run_desktop_turn(text)
  println(result.to_json_line())
}
