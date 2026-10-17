///|
test "deliver milestone channel and end_turn locks tools" {
  let t0 = @runtime.open_turn(turn_id="t-d", text="long job")
  let t1 = t0.acknowledge(body="收到，开始处理")
  assert_eq(t1.phase, @runtime.Acknowledged)
  assert_eq(t1.outbound.length(), 1)
  let t2 = match t1.milestone(body="进度 1/2") {
    Ok(t) => t
    Err(e) => fail(e)
  }
  let t3 = match t2.milestone(body="进度 2/2") {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(t3.outbound.length(), 3)
  assert_eq(t3.phase, @runtime.Milestone)
  let t4 = match t3.deliver_text(body="完成", channel_hint=Some("slack:C1")) {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(t4.outbound[3].channel_hint, Some("slack:C1"))
  let t5 = match t4.finalize_text(body="终态答复") {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(t5.phase, @runtime.Ended)
  assert_false(t5.allows_tools())
  let blocked = match t5.milestone(body="should not append") {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(blocked.outbound.length(), t5.outbound.length())
}
