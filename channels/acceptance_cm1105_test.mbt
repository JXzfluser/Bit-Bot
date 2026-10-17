///|
/// CM-1105: SetUpSlack connect/status or Details guide; connect flow completable.
test "acceptance_CM-1105_setup_slack_connect_flow" {
  let s1 = @channels.SetUpSlackSession::new()
  assert_eq(s1.status(), @channels.Disconnected)
  assert_false(s1.is_connected())
  match s1.connect_tool() {
    Ok(st) => {
      assert_eq(st, @channels.Connected)
      assert_true(s1.is_connected())
      assert_true(s1.flow_completable())
    }
    Err(e) => fail(e)
  }
  // Alternate path: Details guide then complete.
  let s2 = @channels.SetUpSlackSession::new()
  match s2.guide_details() {
    Ok(msg) => {
      assert_true(msg.contains("Details") || msg.contains("Slack"))
      assert_eq(s2.status(), @channels.NeedsDetails)
      assert_true(s2.flow_completable())
    }
    Err(e) => fail(e)
  }
  match s2.complete_from_details() {
    Ok(st) => {
      assert_eq(st, @channels.Connected)
      assert_true(s2.is_connected())
    }
    Err(e) => fail(e)
  }
  // Cannot complete Details without opening guide.
  let s3 = @channels.SetUpSlackSession::new()
  match s3.complete_from_details() {
    Err(m) => assert_true(m.contains("Details") || m.contains("guide"))
    Ok(_) => fail("must open Details guide first")
  }
}
