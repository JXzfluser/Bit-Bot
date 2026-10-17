///|
test "parse fenced output isolates untrusted body" {
  let marker = "cursor_untrusted_data"
  let raw = "hello <" +
    marker +
    "_1337 source=\"Shell\">SECRET</" +
    marker +
    "_1337> world"
  let slices = @security.parse_fenced_output("Shell", raw)
  assert_eq(slices.length(), 3)
  assert_true(slices[1].must_not_execute())
  match slices[1] {
    @security.Fenced(fence~) => assert_eq(fence.body, "SECRET")
    _ => fail("expected fenced")
  }
}
