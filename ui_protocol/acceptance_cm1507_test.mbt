///|
/// CM-1507: settings auto-review / rules / security-keys anchors via grokbot://.
/// Reuses settings_ui.mbt closed-set anchors without breaking M-batch.
test "acceptance_CM-1507_auto_review_settings_deeplink_anchors" {
  let targets = [
    @ui_protocol.SettingsAnchor::AutoReview,
    @ui_protocol.SettingsAnchor::AutoReviewRules,
    @ui_protocol.SettingsAnchor::SecurityKeys,
  ]
  assert_eq(targets[0].id(), "auto-review")
  assert_eq(targets[1].id(), "auto-review-rules")
  assert_eq(targets[2].id(), "security-keys")
  for a in targets {
    let link = @ui_protocol.settings_deep_link(a)
    assert_true(link.has_prefix("grokbot://app/v1/settings?id="))
    match @ui_protocol.parse_settings_deep_link(link) {
      Ok(back) => assert_eq(back, a)
      Err(e) => fail(e)
    }
    // Open Settings intent with the security/auto-review anchor.
    let intent = @ui_protocol.OpenSettingsIntent::open(
      @ui_protocol.SettingsEntry::CommandPalette,
      anchor=Some(a),
    )
    match intent.validate() {
      Ok(_) => ()
      Err(e) => fail(e)
    }
    let host = @ui_protocol.HostSettingsUiMock::new()
    match host.open_settings(intent) {
      Ok(_) => ()
      Err(e) => fail(e)
    }
  }
  // Unknown security-ish id still Errors (closed set).
  match
    @ui_protocol.parse_settings_deep_link(
      "grokbot://app/v1/settings?id=auto-review-unknown",
    ) {
    Err(_) => ()
    Ok(_) => fail("unknown auto-review id must Err")
  }
}
