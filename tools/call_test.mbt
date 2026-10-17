///|
test "tool call and effect dto" {
  let call = @tools.ToolCall::echo("c1", "hi")
  assert_eq(call.name, "echo")
  let eff = @tools.ExecTool(call~)
  match eff {
    @tools.ExecTool(call~) => assert_eq(call.id, "c1")
    _ => fail("expected ExecTool")
  }
}
