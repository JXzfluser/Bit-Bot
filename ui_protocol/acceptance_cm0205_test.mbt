///|
/// CM-0205: per-agent info panel — fields align with app-ui.md anchors
/// (desktop preview, Routines, Channels, Members, gear settings).
/// Kernel-contract only — not fake real Host pixels.
test "acceptance_CM-0205_per_agent_info_panel_fields" {
  let anchors = @ui_protocol.info_panel_section_anchors()
  assert_eq(anchors.length(), 5)
  assert_eq(anchors[0], @ui_protocol.InfoPanelSection::DesktopPreview)
  assert_eq(anchors[1], @ui_protocol.InfoPanelSection::Routines)
  assert_eq(anchors[2], @ui_protocol.InfoPanelSection::Channels)
  assert_eq(anchors[3], @ui_protocol.InfoPanelSection::Members)
  assert_eq(anchors[4], @ui_protocol.InfoPanelSection::GearSettings)
  assert_eq(anchors[0].label(), "desktop-preview")
  assert_eq(anchors[4].label(), "gear-settings")

  let panel = @ui_protocol.PerAgentInfoPanel::full(
    agent_id="agent-bit",
    open_trigger=@ui_protocol.InfoPanelOpenTrigger::ClickAgentName,
  )
  assert_true(panel.fields_align_with_app_ui())
  assert_true(panel.has_desktop_preview)
  assert_true(panel.has_routines)
  assert_true(panel.has_channels)
  assert_true(panel.has_members)
  assert_true(panel.has_gear_settings)
  assert_true(panel.gear_is_per_agent_not_global())

  let via_shortcut = @ui_protocol.PerAgentInfoPanel::full(
    agent_id="agent-bit",
    open_trigger=@ui_protocol.InfoPanelOpenTrigger::KeyboardShortcut,
  )
  assert_eq(
    via_shortcut.open_trigger,
    @ui_protocol.InfoPanelOpenTrigger::KeyboardShortcut,
  )

  let host = @ui_protocol.HostInfoPanelMock::new()
  match host.open(panel) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_eq(host.last_agent_id(), Some("agent-bit"))

  // Incomplete panel must not open (kernel-contract).
  let incomplete : @ui_protocol.PerAgentInfoPanel = {
    agent_id: "x",
    has_desktop_preview: true,
    has_routines: false,
    has_channels: true,
    has_members: true,
    has_gear_settings: true,
    open_trigger: @ui_protocol.InfoPanelOpenTrigger::ClickAgentName,
  }
  assert_false(incomplete.fields_align_with_app_ui())
  match host.open(incomplete) {
    Err(msg) => assert_true(msg.contains("app-ui") || msg.contains("anchor"))
    Ok(_) => fail("incomplete panel must Err")
  }
}
