///|
/// CM-2101: ReactToMessage — emoji pill visible; toggle cancels.
test "acceptance_CM-2101_react_to_message_pill_toggle" {
  let host = @ui_protocol.ReactToMessageHost::new()
  match host.react_to_message(message_id="msg-1", emoji="👍") {
    Err(e) => fail(e)
    Ok(pill) => {
      assert_true(pill.visible)
      assert_true(pill.active)
      assert_eq(pill.emoji, "👍")
      assert_true(pill.is_visible_pill())
    }
  }
  match host.get_pill(message_id="msg-1") {
    Some(p) => assert_true(p.is_visible_pill())
    None => fail("pill must be stored")
  }
  match host.react_to_message(message_id="msg-1", emoji="👍") {
    Err(e) => fail(e)
    Ok(pill) => {
      assert_false(pill.active)
      assert_false(pill.visible)
      assert_false(pill.is_visible_pill())
    }
  }
  match host.react_to_message(message_id="msg-1", emoji="🎉") {
    Err(e) => fail(e)
    Ok(pill) => {
      assert_true(pill.is_visible_pill())
      assert_eq(pill.emoji, "🎉")
    }
  }
}
