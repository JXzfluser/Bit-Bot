///|
/// CM-0201: UpdateAgentProfile name/title/description; sidebar + info panel reflect immediately.
test "acceptance_CM-0201_update_agent_profile_reflects" {
  let sidebar = @ui_protocol.SidebarModel::new()
  let initial = @ui_protocol.AgentProfile::new(
    id="agent-a",
    name="Bit",
    title="Assistant",
    description="helps with code",
  )
  sidebar.add_agent(initial)
  let updated = @ui_protocol.AgentProfile::new(
    id="agent-a",
    name="BitBot",
    title="MoonBit Helper",
    description="G-batch profile",
  )
  match sidebar.update_agent_profile(updated) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match sidebar.snapshot_for("agent-a") {
    Ok((entry, panel)) => {
      assert_eq(entry.display_name, "BitBot")
      assert_eq(entry.title, "MoonBit Helper")
      assert_eq(panel.name, "BitBot")
      assert_eq(panel.title, "MoonBit Helper")
      assert_eq(panel.description, "G-batch profile")
    }
    Err(e) => fail(e)
  }
}

///|
/// CM-0203: new agent appears in sidebar; delete requires confirm and clears transcript.
test "acceptance_CM-0203_sidebar_visibility_delete_confirm" {
  let sidebar = @ui_protocol.SidebarModel::new()
  let profile = @ui_protocol.AgentProfile::new(
    id="agent-new",
    name="Nova",
    title="New Agent",
    description="fresh",
  )
  sidebar.add_agent(profile)
  assert_true(sidebar.contains("agent-new"))
  assert_eq(sidebar.entries.length(), 1)

  // Delete without confirm must fail and leave agent listed.
  match sidebar.confirm_delete("agent-new", confirmed=false) {
    Err(m) => assert_true(m.contains("confirm"))
    Ok(_) => fail("delete without confirm must Err")
  }
  assert_true(sidebar.contains("agent-new"))

  match sidebar.request_delete("agent-new") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match sidebar.confirm_delete("agent-new", confirmed=true) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_false(sidebar.contains("agent-new"))
  assert_true(sidebar.transcript_was_cleared("agent-new"))
}
