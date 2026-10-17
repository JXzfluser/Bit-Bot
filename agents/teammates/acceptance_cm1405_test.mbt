///|
/// CM-1405: Members panel — group member list in info panel; matches app-ui.
/// Kernel-contract only.
test "acceptance_CM-1405_members_panel_matches_app_ui" {
  let dir = @teammates.TeammateDirectory::new()
  match dir.create_agent(id="asst-alpha", name="Alpha", role="researcher") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match dir.create_agent(id="asst-beta", name="Beta", role="executor") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  let panel = @teammates.MembersPanel::from_directory(dir, group_id="group-1")
  assert_true(panel.matches_app_ui())
  assert_eq(panel.section_anchor, "members")
  assert_eq(
    panel.section_anchor,
    @ui_protocol.InfoPanelSection::Members.label(),
  )
  assert_eq(panel.member_ids().length(), 2)
  assert_true(panel.contains("asst-alpha"))
  assert_true(panel.contains("asst-beta"))
  // Info panel with Members section can host the list.
  let info = @ui_protocol.PerAgentInfoPanel::full(agent_id="group-1")
  assert_true(info.has_members)
  let host = @teammates.HostMembersPanelMock::new()
  match host.open(panel, info) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  let ids = host.last_ids()
  assert_eq(ids.length(), 2)
  assert_eq(ids[0], "asst-alpha")
  // Incomplete info panel (no Members) refused.
  let bad_info : @ui_protocol.PerAgentInfoPanel = {
    agent_id: "group-1",
    has_desktop_preview: true,
    has_routines: true,
    has_channels: true,
    has_members: false,
    has_gear_settings: true,
    open_trigger: @ui_protocol.InfoPanelOpenTrigger::ClickAgentName,
  }
  match host.open(panel, bad_info) {
    Err(m) => assert_true(m.contains("Members") || m.contains("members"))
    Ok(_) => fail("missing Members section must Err")
  }
}
