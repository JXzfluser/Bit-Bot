///|
/// CM-2128: ReactToMessage outbound — thank-you → React end_turn shows pill, may omit body.
test "acceptance_CM-2128_react_outbound_end_turn_pill_no_body" {
  let host = @ui_protocol.ReactToMessageHost::new()
  assert_true(@ui_protocol.is_thank_you_message("thank you so much!"))
  assert_true(@ui_protocol.is_thank_you_message("Thanks!"))
  match
    @ui_protocol.plan_thank_you_react_end_turn(
      host,
      turn_id="turn-2128",
      user_message_id="user-msg-thanks",
      user_text="thank you!",
    ) {
    Err(e) => fail(e)
    Ok(turn) => {
      assert_true(turn.end_turn)
      assert_true(turn.shows_pill())
      assert_true(turn.may_omit_body())
      assert_true(turn.body_omitted)
      assert_eq(turn.body.length(), 0)
      assert_true(turn.pill.is_visible_pill())
      assert_eq(turn.pill.emoji, "🙏")
      // Envelope is Reaction-only (no Text body part).
      assert_eq(turn.envelope.part_count(), 1)
      assert_eq(turn.envelope.parts[0].label(), "reaction")
    }
  }
  // Direct API: omit_body=true.
  let host2 = @ui_protocol.ReactToMessageHost::new()
  match
    host2.react_outbound_end_turn(
      turn_id="t2",
      message_id="m2",
      emoji="👍",
      omit_body=true,
    ) {
    Err(e) => fail(e)
    Ok(turn) => {
      assert_true(turn.shows_pill())
      assert_true(turn.body_omitted)
      assert_true(turn.end_turn)
    }
  }
}
