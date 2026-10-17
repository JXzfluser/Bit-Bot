///|
test "agent loop boot" {
  let reg = @runtime.ToolRegistry::seed_builtins()
  assert_eq(reg.len() >= 20, true)
  let agent = @runtime.AgentLoop::new(reg)
  let ctx = @runtime.open_turn(turn_id="t1", text="hi")
  let msg = agent.boot(ctx)
  assert_eq(msg.has_prefix("turn=t1"), true)
}
