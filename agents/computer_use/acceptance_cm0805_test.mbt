///|
/// CM-0805: request_box_help — do not pre-ask「要交棒吗」; handoff itself is the ask.
test "acceptance_CM-0805_request_box_help_handoff_is_ask" {
  assert_true(@ui_protocol.is_forbidden_pre_ask_handoff("要交棒吗？"))
  match
    @computer_use.computer_use_request_box_help(
      reason="captcha blocking checkout form",
    ) {
    Err(e) => fail(e)
    Ok(handoff) => {
      assert_true(handoff.is_ask)
      assert_false(handoff.pre_asked)
      assert_true(handoff.is_handoff_ask())
      assert_true(
        handoff.handoff_message.contains("captcha") ||
        handoff.handoff_message.contains("desktop"),
      )
      assert_false(
        @ui_protocol.is_forbidden_pre_ask_handoff(handoff.handoff_message),
      )
      assert_false(handoff.handoff_message.contains("要交棒吗"))
    }
  }
  // Pre-ask phrasing in reason is refused.
  match @ui_protocol.request_box_help(reason="要交棒吗 before continuing") {
    Err(msg) =>
      assert_true(
        msg.contains("pre-ask") ||
        msg.contains("handoff") ||
        msg.contains("ask"),
      )
    Ok(_) =>
      fail(
        "pre-ask「要交棒吗」must be refused; handoff itself is the ask",
      )
  }
}
