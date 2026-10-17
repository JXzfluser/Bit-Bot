///|
test "tool registry echo and unknown" {
  let reg = @tools.Registry::with_echo()
  assert_eq(reg.len(), 1)
  match reg.invoke("echo", "ping") {
    @tools.Ok(output~) => assert_eq(output, "ping")
    _ => fail("echo should succeed")
  }
  match reg.invoke("nope", "") {
    @tools.Err(message~) => assert_true(message.has_prefix("unknown tool"))
    _ => fail("unknown should err")
  }
}
