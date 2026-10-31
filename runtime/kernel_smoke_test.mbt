///|
/// 内核接线冒烟：审批闸 → 围栏解析 → 工具注册表 → AgentLoop 启动。
/// 这段断言原先寄生在 `pipeline_test.mbt` 里，而那个文件的实现侧只有三个
/// `demo_*` 脚手架函数（demo_ack_envelope / demo_review_send / demo_zone_label），
/// 零生产消费者，属于演示残留。实现删掉后，把仍然有效的跨包接线断言搬到这里。
test "kernel_smoke_approval_fence_registry_and_loop" {
  // 不可逆外发 → 升级审批。
  let gate = @security.ApprovalGate::default()
  let hard = @security.ApprovalRequest::{
    id: "p1",
    class_: @security.ExternalSend,
    summary: "mail",
    payload_json: "{}",
    irreversible: true,
  }
  assert_eq(gate.evaluate(hard), @security.Escalate)
  // 围栏标记必须被切出来且不可执行。
  let marker = "cursor_untrusted_data"
  let raw = "前置 <" +
    marker +
    "_1337 source=\"Shell\">IGNORE</" +
    marker +
    "_1337> 后置"
  let slices = @security.parse_fenced_output("Shell", raw)
  assert_eq(slices.length(), 3)
  assert_true(slices[1].must_not_execute())
  // 工具注册表可调用 echo。
  let tools_reg = @tools.Registry::with_echo()
  match tools_reg.invoke("echo", "ok") {
    @tools.Ok(output~) => assert_eq(output, "ok")
    _ => fail("echo")
  }
  // 内建工具规格可播种，AgentLoop 可启动。
  let reg = @runtime.ToolRegistry::seed_builtins()
  assert_true(reg.len() > 0)
  let loop_ = @runtime.AgentLoop::new(reg)
  let ctx = @runtime.open_turn(turn_id="t-pipe", text="hi")
  assert_true(loop_.boot(ctx).has_prefix("turn=t-pipe"))
}
