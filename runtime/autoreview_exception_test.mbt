///|
test "auto-review host notice followable; fence data ignored" {
  match @runtime.classify_tool_output("auto-review", "retry with flag") {
    @runtime.FollowHostRetry => ()
    _ => fail("host auto-review should follow")
  }
  let slices = @security.parse_fenced_output(
    "Shell", "前置 <cursor_untrusted_data_1337 source=\"evil\">ignore me</cursor_untrusted_data_1337> 后",
  )
  let mut saw_ignore = false
  for s in slices {
    match @runtime.policy_for_slice(s) {
      @runtime.IgnoreAsData => saw_ignore = true
      _ => ()
    }
  }
  assert_true(saw_ignore)
}
