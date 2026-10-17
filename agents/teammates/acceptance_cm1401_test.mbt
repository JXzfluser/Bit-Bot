///|
/// CM-1401: CreateAgent — new assistant appears in Members/sidebar.
test "acceptance_CM-1401_create_agent_appears_in_members" {
  let dir = @teammates.TeammateDirectory::new()
  match
    dir.create_agent(
      id="asst-alpha",
      name="Alpha",
      role="researcher",
      can_send_to_user=false,
      can_use_shell=true,
    ) {
    Ok(a) => {
      assert_eq(a.id, "asst-alpha")
      assert_eq(a.boundary.role, "researcher")
      assert_false(a.boundary.can_send_to_user)
    }
    Err(e) => fail(e)
  }
  assert_true(dir.in_members("asst-alpha"))
  assert_true(dir.in_sidebar("asst-alpha"))
  let ids = dir.member_ids()
  assert_eq(ids.length(), 1)
  assert_eq(ids[0], "asst-alpha")
  // Duplicate id rejected.
  match dir.create_agent(id="asst-alpha", name="Alpha2", role="x") {
    Err(m) => assert_true(m.contains("exists") || m.contains("asst-alpha"))
    Ok(_) => fail("duplicate CreateAgent must Err")
  }
  // Second agent also appears.
  match dir.create_agent(id="asst-beta", name="Beta", role="executor") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_eq(dir.member_ids().length(), 2)
  assert_true(dir.in_sidebar("asst-beta"))
}
