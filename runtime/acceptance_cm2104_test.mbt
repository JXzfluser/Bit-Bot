///|
/// CM-2104: independent read-only tools may emit in parallel (e.g. two WebSearch/Read).
test "acceptance_CM-2104_parallel_readonly_tools_same_turn" {
  match
    @runtime.emit_two_readonly_same_turn(
      a_name="WebSearch",
      a_args="{\"query\":\"moonbit\"}",
      b_name="Read",
      b_args="{\"path\":\"/workspace/README.md\"}",
    ) {
    Err(e) => fail(e)
    Ok(plan) => {
      assert_true(plan.can_emit_parallel())
      assert_eq(plan.parallel_batches.length(), 1)
      assert_eq(plan.parallel_batches[0].length(), 2)
      assert_eq(plan.parallel_batches[0][0].name, "WebSearch")
      assert_eq(plan.parallel_batches[0][1].name, "Read")
      assert_eq(plan.parallel_batches[0][0].mutability, @runtime.ReadOnly)
      assert_eq(plan.parallel_batches[0][1].mutability, @runtime.ReadOnly)
    }
  }
  match
    @runtime.emit_two_readonly_same_turn(
      a_name="WebSearch",
      a_args="{\"query\":\"a\"}",
      b_name="WebSearch",
      b_args="{\"query\":\"b\"}",
    ) {
    Ok(plan) => assert_true(plan.can_emit_parallel())
    Err(e) => fail(e)
  }
  match
    @runtime.emit_two_readonly_same_turn(
      a_name="WebSearch",
      a_args="{}",
      b_name="Shell",
      b_args="{}",
    ) {
    Err(m) => assert_true(m.contains("read-only") || m.contains("parallel"))
    Ok(_) => fail("Shell must not parallel as readonly")
  }
  assert_eq(@runtime.classify_tool_mutability("WebSearch"), @runtime.ReadOnly)
  assert_eq(@runtime.classify_tool_mutability("Read"), @runtime.ReadOnly)
  assert_eq(@runtime.classify_tool_mutability("Shell"), @runtime.Mutating)
}
