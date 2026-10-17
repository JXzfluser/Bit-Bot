///|
/// CM-0102: user inbound produces ack outbound; Hidden/Agent do not.
test "acceptance_CM-0102_user_ack_hidden_agent_no_ack" {
  let user = @runtime.open_turn(
    turn_id="acc-u",
    text="长任务请处理",
    kind=@runtime.User,
  )
  assert_true(user.should_ack_user())
  let u2 = user.acknowledge(body="收到，开始处理")
  assert_eq(u2.phase, @runtime.Acknowledged)
  assert_eq(u2.outbound.length(), 1)
  assert_eq(u2.outbound[0].parts[0].label(), "text")
  assert_true(u2.phase != @runtime.Ended)

  let hidden = @runtime.open_turn(
    turn_id="acc-h",
    text="[hidden cue]",
    kind=@runtime.Hidden,
  )
  assert_false(hidden.should_ack_user())
  let h2 = hidden.acknowledge(body="must not send")
  assert_eq(h2.outbound.length(), 0)
  assert_eq(h2.phase, @runtime.Opened)

  let agent = @runtime.open_turn(
    turn_id="acc-a",
    text="[agent ping]",
    kind=@runtime.Agent,
  )
  assert_false(agent.should_ack_user())
  let a2 = agent.acknowledge(body="must not send")
  assert_eq(a2.outbound.length(), 0)
}

///|
/// CM-0103: ≥2 milestones then final (separate outbound envelopes).
test "acceptance_CM-0103_two_milestones_then_final" {
  let t0 = @runtime.open_turn(turn_id="acc-ms", text="long")
  let t1 = t0.acknowledge(body="ack")
  let t2 = match t1.milestone(body="进度 1/3") {
    Ok(t) => t
    Err(e) => fail(e)
  }
  let t3 = match t2.milestone(body="进度 2/3") {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(t3.outbound.length(), 3)
  assert_eq(t3.phase, @runtime.Milestone)
  let t4 = match t3.finalize_text(body="终态答复") {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(t4.phase, @runtime.Ended)
  assert_eq(t4.outbound.length(), 4)
}

///|
/// CM-0104: after end_turn, further deliver/milestone must NOT append outbound.
test "acceptance_CM-0104_end_turn_stops_user_delivery" {
  let t0 = @runtime.open_turn(turn_id="acc-end", text="x")
  let t1 = t0.acknowledge(body="ack")
  let t2 = match t1.finalize_text(body="done") {
    Ok(t) => t
    Err(e) => fail(e)
  }
  let n = t2.outbound.length()
  assert_eq(t2.phase, @runtime.Ended)
  assert_false(t2.allows_tools())
  let after_ms = match t2.milestone(body="late milestone") {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(after_ms.outbound.length(), n)
  let after_del = match t2.deliver_text(body="late deliver") {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(after_del.outbound.length(), n)
}
