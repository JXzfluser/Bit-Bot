///|
/// M-batch: CM-1904 reset-computer not preferred; CM-1906 update-channel ≠ update-computer.
/// Cross-asserts anchors only; does not duplicate L-batch CM-1903/1905 behavior tests.

///|
/// CM-1904: reset-computer anchor exists; assistant must prefer update-computer.
test "acceptance_CM-1904_reset_computer_not_preferred" {
  let reset = @ui_protocol.SettingsAnchor::ResetComputer
  let update = @ui_protocol.SettingsAnchor::UpdateComputer
  assert_eq(reset.id(), "reset-computer")
  assert_eq(update.id(), "update-computer")
  assert_eq(reset.tab(), @ui_protocol.SettingsTab::Computer)
  assert_eq(update.tab(), @ui_protocol.SettingsTab::Computer)
  // Deep links are distinct and legal.
  assert_eq(
    @ui_protocol.settings_deep_link(reset),
    "grokbot://app/v1/settings?id=reset-computer",
  )
  assert_eq(
    @ui_protocol.settings_deep_link(update),
    "grokbot://app/v1/settings?id=update-computer",
  )
  assert_true(@ui_protocol.is_assistant_preferred_computer_recovery(update))
  assert_false(@ui_protocol.is_assistant_preferred_computer_recovery(reset))
  match @ui_protocol.prefer_update_over_reset(reset) {
    Err(msg) =>
      assert_true(
        msg.contains("not preferred") ||
        msg.contains("update-computer") ||
        msg.contains("reset-computer"),
      )
    Ok(_) => fail("Reset must not be preferred over Update")
  }
  match @ui_protocol.prefer_update_over_reset(update) {
    Ok(a) => assert_eq(a, update)
    Err(e) => fail(e)
  }
}

///|
/// CM-1906: update-channel (app Updates tab) ≠ update-computer (Computer tab / box).
test "acceptance_CM-1906_update_channel_ne_update_computer" {
  assert_true(@ui_protocol.update_channel_ne_update_computer())
  let channel = @ui_protocol.SettingsAnchor::UpdateChannel
  let computer = @ui_protocol.SettingsAnchor::UpdateComputer
  assert_true(channel != computer)
  assert_true(channel.id() != computer.id())
  assert_eq(channel.id(), "update-channel")
  assert_eq(computer.id(), "update-computer")
  assert_eq(channel.tab(), @ui_protocol.SettingsTab::Updates)
  assert_eq(computer.tab(), @ui_protocol.SettingsTab::Computer)
  // Distinct deep links.
  let link_ch = @ui_protocol.settings_deep_link(channel)
  let link_pc = @ui_protocol.settings_deep_link(computer)
  assert_true(link_ch != link_pc)
  match @ui_protocol.parse_settings_deep_link(link_ch) {
    Ok(a) => assert_eq(a, channel)
    Err(e) => fail(e)
  }
  match @ui_protocol.parse_settings_deep_link(link_pc) {
    Ok(a) => assert_eq(a, computer)
    Err(e) => fail(e)
  }
}
