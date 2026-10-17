///|
/// CM-2135: user private workflows (WeChat etc.) visible at runtime but NOT written into
/// Bit must-deliver native capability / P0 matrix contract. Distinct from CM-2118.
test "acceptance_CM-2135_user_private_workflows_not_kernel_must_deliver" {
  let rt = @skills.UserWorkflowRuntime::seed_wechat_and_private()
  // Runtime-visible (WeChat + prior private examples).
  assert_true(rt.is_visible("wechat-cover-infographic"))
  assert_true(rt.is_visible("wechat-title-hook"))
  assert_true(rt.is_visible("aihot-scout"))
  assert_true(rt.is_user_private("wechat-cover-infographic"))
  match rt.read_skill_md("wechat-title-hook") {
    Ok(body) => assert_true(body.contains("WeChat") || body.contains("wechat"))
    Err(e) => fail(e)
  }
  // Must NOT be written into native must-deliver / P0 matrix.
  let p0 = @skills.NativeMustDeliverP0::product_seed()
  assert_false(p0.contains_any_user_workflow(rt))
  assert_false(p0.includes_native("wechat-cover-infographic"))
  assert_false(p0.includes_native("wechat-title-hook"))
  assert_false(p0.includes_native("aihot-scout"))
  match p0.try_write_user_workflow_as_native(rt, "wechat-cover-infographic") {
    Err(m) =>
      assert_true(m.contains("must not enter") || m.contains("must-deliver"))
    Ok(_) => fail("WeChat user workflow must not elevate to P0 native")
  }
  // Product native skills may still be listed.
  assert_true(
    p0.includes_native("agent-email") || p0.includes_native("routines"),
  )
  assert_true(@skills.user_private_workflows_not_kernel_must_deliver())
  // CM-2118 contract surface still excludes user workflows (shared API kept green).
  let contract = @skills.MatrixMustDeliverContract::product_seed()
  assert_false(contract.contains_any_user_workflow(rt))
}
