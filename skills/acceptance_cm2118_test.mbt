///|
/// CM-2118: user private workflows visible at runtime but NOT must-deliver matrix contract.
test "acceptance_CM-2118_user_workflows_visible_not_matrix_contract" {
  let rt = @skills.UserWorkflowRuntime::seed_private_examples()
  let visible = rt.list_visible()
  assert_true(visible.length() >= 3)
  assert_true(rt.is_visible("aihot-scout"))
  assert_true(rt.is_visible("content-research-pipeline"))
  assert_true(rt.is_visible("humanizer-zh"))
  match rt.read_skill_md("aihot-scout") {
    Ok(body) =>
      assert_true(body.contains("aihot-scout") || body.contains("User-private"))
    Err(e) => fail(e)
  }
  // Must-deliver matrix contract must NOT include user private workflows.
  let contract = @skills.MatrixMustDeliverContract::product_seed()
  assert_false(contract.contains_any_user_workflow(rt))
  assert_false(contract.includes_skill("aihot-scout"))
  assert_false(contract.includes_skill("content-research-pipeline"))
  assert_false(contract.includes_skill("humanizer-zh"))
  // Product skills may appear; user ones must not.
  assert_true(
    contract.includes_skill("agent-email") ||
    contract.includes_skill("routines"),
  )
  assert_true(@skills.user_workflows_are_non_goal_ng003())
  // CM-2118 itself documents the non-goal boundary (not elevating user workflows).
  assert_true(
    contract.includes_cm("CM-2111") || !contract.includes_skill("aihot-scout"),
  )
}
