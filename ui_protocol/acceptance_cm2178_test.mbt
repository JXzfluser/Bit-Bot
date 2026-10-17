///|
/// CM-2178: Settings page guide — when permission missing guide to Settings;
/// Given missing perm When acceptance Then do not pretend connected. Kernel-contract OK.
test "acceptance_CM-2178_missing_permission_guide_settings_not_pretend" {
  let kinds = [
    @ui_protocol.MissingPermissionKind::ConnectorNeedsAuth(
      namespace_="user-Gmail",
    ),
    @ui_protocol.MissingPermissionKind::ConnectorNeedsGrant(
      namespace_="user-Slack",
    ),
    @ui_protocol.MissingPermissionKind::LocalExecutionDisabled,
    @ui_protocol.MissingPermissionKind::DeviceToolPermission(tool="camera"),
  ]
  for k in kinds {
    let guide = @ui_protocol.guide_missing_permission_to_settings(k)
    assert_false(guide.pretends_connected)
    assert_true(guide.guides_to_settings())
    match guide.open_settings.validate() {
      Ok(_) => ()
      Err(e) => fail(e)
    }
    let anchor = k.settings_anchor()
    match guide.open_settings.anchor {
      Some(a) => assert_eq(a, anchor)
      None => fail("guide must include Settings anchor")
    }
    let deep = @ui_protocol.settings_deep_link(anchor)
    assert_true(deep.has_prefix("grokbot://app/v1/settings?id="))
    // Valid guidance mentions Settings.
    let ok_text = "Permission missing — open Settings (" +
      deep +
      ") to connect. Not connected yet."
    match
      @ui_protocol.validate_missing_permission_guidance(
        guide,
        assistant_text=ok_text,
      ) {
      Ok(_) => ()
      Err(e) => fail(e)
    }
  }
  // Pretend-connected is forbidden.
  assert_true(
    @ui_protocol.is_pretend_connected_guidance(
      "You're already connected — nothing to do.",
    ),
  )
  let g = @ui_protocol.guide_missing_permission_to_settings(
    @ui_protocol.MissingPermissionKind::ConnectorNeedsAuth(namespace_="user-X"),
  )
  match
    @ui_protocol.validate_missing_permission_guidance(
      g,
      assistant_text="You're already connected to X.",
    ) {
    Err(msg) => assert_true(msg.contains("pretend") || msg.contains("Settings"))
    Ok(_) => fail("must not accept pretend-connected guidance")
  }
  // Host Settings mock records the open intent (kernel-contract).
  let host = @ui_protocol.HostSettingsUiMock::new()
  match host.open_settings(g.open_settings) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
}
