///|
test "thread reply keeps channel hint" {
  let t0 = @runtime.open_turn(turn_id="t-ch", text="hi")
  let t1 = match
    t0.deliver_text_to_inbound(
      body="回线程",
      inbound_address="slack:C1:1234.5",
    ) {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(t1.outbound[0].channel_hint, Some("slack:C1:1234.5"))
  let addr = @channels.parse_channel_address("slack:C1:1234.5")
  assert_true(addr.is_threaded())
  assert_eq(addr.reply_hint(), "slack:C1:1234.5")
}
