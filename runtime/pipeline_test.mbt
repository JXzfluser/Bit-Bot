///|
test "approval to fence to outbound to registry" {
  let gate = @security.ApprovalGate::default()
  let hard = @security.ApprovalRequest::{
    id: "p1",
    class_: @security.ExternalSend,
    summary: "mail",
    payload_json: "{}",
    irreversible: true,
  }
  assert_eq(gate.evaluate(hard), @security.Escalate)
  let marker = "cursor_untrusted_data"
  let raw = "前置 <" +
    marker +
    "_1337 source=\"Shell\">IGNORE</" +
    marker +
    "_1337> 后置"
  let slices = @security.parse_fenced_output("Shell", raw)
  assert_eq(slices.length(), 3)
  assert_true(slices[1].must_not_execute())
  let env = @runtime.demo_ack_envelope("t-pipe", "ack")
  assert_eq(env.part_count(), 1)
  let tools_reg = @tools.Registry::with_echo()
  match tools_reg.invoke("echo", "ok") {
    @tools.Ok(output~) => assert_eq(output, "ok")
    _ => fail("echo")
  }
  let reg = @runtime.ToolRegistry::seed_builtins()
  assert_true(reg.len() > 0)
  let loop_ = @runtime.AgentLoop::new(reg)
  let ctx = @runtime.open_turn(turn_id="t-pipe", text="hi")
  assert_true(loop_.boot(ctx).has_prefix("turn=t-pipe"))
}
