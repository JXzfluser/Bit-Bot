///|
/// CM-2131: SendToUser type=cursor-agent shows cloud agent card; card opens cloud agent.
test "acceptance_CM-2131_cursor_agent_card_opens_cloud" {
  match
    @ui_protocol.send_to_user_cursor_agent(
      turn_id="turn-2131",
      bc_id="bc-2131-demo",
    ) {
    Err(e) => fail(e)
    Ok(msg) => {
      assert_eq(msg.send_type.label(), "cursor-agent")
      assert_true(msg.card.is_cursor_agent_type())
      assert_eq(msg.card.bc_id, "bc-2131-demo")
      assert_true(msg.card.can_open_cloud())
      assert_true(msg.card.url.contains("bc-2131-demo"))
      match msg.open_cloud() {
        Err(e) => fail(e)
        Ok(url) => {
          assert_true(url.has_prefix("https://cursor.com/agents/"))
          assert_true(msg.card.opened)
        }
      }
    }
  }
  // Empty bcId refused.
  match @ui_protocol.issue_cursor_agent_card("") {
    Err(m) => assert_true(m.contains("bcId"))
    Ok(_) => fail("empty bcId must Err")
  }
}
