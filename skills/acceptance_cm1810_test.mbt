///|
/// CM-1810: code-changes workflow discipline; coordinates with source-control (CM-1305 intact).
test "acceptance_CM-1810_code_changes_with_source_control" {
  assert_eq(@skills.code_changes_skill_name(), "code-changes")
  // Box workspace + native Origin → Origin backend; may register origin trigger.
  match
    @skills.plan_code_changes(
      repo_kind=@skills.NativeOrigin,
      scope=@skills.BoxWorkspace,
      paths=["/workspace/bitbot/skills/code_changes.mbt"],
    ) {
    Ok(plan) => {
      assert_eq(plan.sc_backend, @skills.Origin)
      assert_eq(plan.sc_backend.mcp_namespace(), "cursor-origin")
      assert_true(plan.may_register_origin_trigger)
      match plan.try_origin_trigger(repo="org/native", event="pr") {
        Ok(id) => assert_true(id.contains("org/native"))
        Err(e) => fail(e)
      }
    }
    Err(e) => fail(e)
  }
  // Mirror: GitHub routing; origin trigger rejected (CM-1305 coordination).
  match
    @skills.plan_code_changes(
      repo_kind=@skills.GithubMirror,
      scope=@skills.BoxWorkspace,
      paths=["/workspace/app/main.mbt"],
    ) {
    Ok(plan) => {
      assert_eq(plan.sc_backend, @skills.Github)
      assert_false(plan.may_register_origin_trigger)
      match plan.try_origin_trigger(repo="org/mirror", event="pr") {
        Err(m) => assert_true(m.contains("mirror") || m.contains("origin"))
        Ok(_) => fail("mirror must not register origin trigger")
      }
    }
    Err(e) => fail(e)
  }
  // Machine checkout without explicit ask → Err (NG-007).
  match
    @skills.plan_code_changes(
      repo_kind=@skills.GithubNative,
      scope=@skills.MachineCheckout,
      paths=["/home/user/proj/a.mbt"],
      explicit_machine_ask=false,
    ) {
    Err(m) => assert_true(m.contains("explicit") || m.contains("machine"))
    Ok(_) => fail("machine checkout without ask must Err")
  }
  // Path outside box roots rejected in BoxWorkspace.
  match
    @skills.plan_code_changes(
      repo_kind=@skills.NativeOrigin,
      scope=@skills.BoxWorkspace,
      paths=["/etc/passwd"],
    ) {
    Err(m) => assert_true(m.contains("/workspace") || m.contains("path"))
    Ok(_) => fail("outside box path must Err")
  }
}
