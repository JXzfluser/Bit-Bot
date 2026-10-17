///|
test "secret guard blocks credential shaped args" {
  match @runtime.guard_tool_args("api_key=sk-test") {
    @tools.Blocked(_) => ()
    _ => fail("expected blocked")
  }
  match @runtime.guard_tool_args("hello") {
    @tools.Ok(_) => ()
    _ => fail("expected ok")
  }
}
