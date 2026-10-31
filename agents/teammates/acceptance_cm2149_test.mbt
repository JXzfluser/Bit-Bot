///|
/// CM-2149: Cross-assistant no verbatim complaint relay — diplomatic paraphrase only.
test "acceptance_CM-2149_cross_agent_complaint_diplomatic_paraphrase" {
  let complaint = "That other assistant is awful and stupid — always wrong and never works!"
  match @teammates.paraphrase_complaint_for_agent(complaint) {
    Err(e) => fail(e)
    Ok(para) => {
      assert_true(para.was_complaint)
      assert_true(para.is_diplomatic())
      assert_true(para.actionable_body != complaint)
      assert_false(para.actionable_body.contains("awful"))
      assert_false(para.actionable_body.contains("stupid"))
      assert_true(
        para.actionable_body.contains("Please") ||
        para.actionable_body.contains("accuracy") ||
        para.actionable_body.contains("next steps"),
      )
    }
  }
  let bus = @teammates.SendToAgentBus::new()
  match
    bus.send_diplomatic(
      from_id="asst-parent",
      to_id="asst-peer",
      user_complaint=complaint,
    ) {
    Err(e) => fail(e)
    Ok((msg, para)) => {
      assert_eq(msg.to_id, "asst-peer")
      assert_eq(msg.body, para.actionable_body)
      assert_true(msg.body != complaint)
      assert_false(msg.body.contains("stupid"))
      assert_false(msg.body.contains("awful"))
      assert_true(para.is_diplomatic())
    }
  }
  let delivered = bus.delivered_to("asst-peer")
  assert_eq(delivered.length(), 1)
  assert_true(delivered[0].body != complaint)
  // CM-2141 fanout ask-first stays green (aligned; not weakened).
  let targets = ["asst-a", "asst-b"]
  let plan = @teammates.plan_send_to_agent_fanout(
    targets,
    user_explicitly_asked_fanout=false,
  )
  assert_true(plan.requires_ask_first())
  match
    bus.fanout(
      from_id="asst-parent",
      to_ids=targets,
      body="status sync",
      user_explicitly_asked_fanout=false,
    ) {
    Err(m) => assert_true(m.contains("ask user first"))
    Ok(_) => fail("CM-2141 ask-first must still block fanout")
  }
}
