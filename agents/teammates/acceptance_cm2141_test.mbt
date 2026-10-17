///|
/// CM-2141: SendToAgent fan-out — Given no explicit ask When wanting to notify multiple Then ask user first.
test "acceptance_CM-2141_send_to_agent_fanout_ask_first" {
  let targets = ["asst-a", "asst-b", "asst-c"]
  // No explicit ask → must ask first (do not fan-out).
  let plan = @teammates.plan_send_to_agent_fanout(
    targets,
    user_explicitly_asked_fanout=false,
  )
  assert_true(plan.requires_ask_first())
  match plan {
    @teammates.MustAskUserFirst(reason~, to_ids~) => {
      assert_true(reason.contains("ask user first"))
      assert_eq(to_ids.length(), 3)
    }
    _ => fail("multi without ask must be MustAskUserFirst")
  }
  let bus = @teammates.SendToAgentBus::new()
  match
    bus.fanout(
      from_id="asst-parent",
      to_ids=targets,
      body="sync status",
      user_explicitly_asked_fanout=false,
    ) {
    Err(m) => assert_true(m.contains("ask user first"))
    Ok(_) => fail("must not fan-out without explicit ask")
  }
  assert_eq(bus.delivered_to("asst-a").length(), 0)
  // Explicit ask → fan-out delivers to all.
  let bus2 = @teammates.SendToAgentBus::new()
  match
    bus2.fanout(
      from_id="asst-parent",
      to_ids=targets,
      body="sync status",
      user_explicitly_asked_fanout=true,
    ) {
    Err(e) => fail(e)
    Ok(msgs) => {
      assert_eq(msgs.length(), 3)
      assert_eq(bus2.delivered_to("asst-a").length(), 1)
      assert_eq(bus2.delivered_to("asst-b").length(), 1)
      assert_eq(bus2.delivered_to("asst-c").length(), 1)
    }
  }
  // Single recipient never requires ask-first.
  let single = @teammates.plan_send_to_agent_fanout(
    ["asst-only"],
    user_explicitly_asked_fanout=false,
  )
  assert_false(single.requires_ask_first())
}
