///|
/// CM-1402: SendToAgent — delivery arrives; loop detection.
test "acceptance_CM-1402_send_to_agent_delivery_loop_detect" {
  let bus = @teammates.SendToAgentBus::new()
  match
    bus.send(
      from_id="asst-a",
      to_id="asst-b",
      body="please review the outline",
      user_visible=false,
    ) {
    Ok(m) => {
      assert_eq(m.to_id, "asst-b")
      assert_false(m.user_visible)
    }
    Err(e) => fail(e)
  }
  let delivered = bus.delivered_to("asst-b")
  assert_eq(delivered.length(), 1)
  assert_eq(delivered[0].body, "please review the outline")
  assert_false(bus.has_loop())
  // Reverse edge in same path → loop.
  match bus.send(from_id="asst-b", to_id="asst-a", body="ack") {
    Err(m) => {
      assert_true(m.contains("loop"))
      assert_true(bus.has_loop())
    }
    Ok(_) => fail("A↔B cycle must be detected")
  }
  // Self-send is a loop.
  let bus2 = @teammates.SendToAgentBus::new()
  match bus2.send(from_id="asst-x", to_id="asst-x", body="noop") {
    Err(m) => {
      assert_true(m.contains("loop") || m.contains("self"))
      assert_true(bus2.has_loop())
    }
    Ok(_) => fail("self-send must Err")
  }
}
