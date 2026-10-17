///|
/// CM-0109: parse slack:C:ts; outbound channel_hint equals inbound thread address.
test "acceptance_CM-0109_thread_reply_stays_in_thread" {
  let inbound = "slack:C99THREAD:1712345.000100"
  let addr = @channels.parse_channel_address(inbound)
  assert_true(addr.is_threaded())
  assert_eq(addr.reply_hint(), inbound)
  assert_eq(addr.channel_id, "C99THREAD")
  assert_eq(addr.thread_ts, Some("1712345.000100"))
  let t0 = @runtime.open_turn(turn_id="acc-0109", text="thread msg")
  let t1 = match
    t0.deliver_text_to_inbound(body="回同线程", inbound_address=inbound) {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(t1.outbound[0].channel_hint, Some(inbound))
  // Must not collapse to top-level channel without ts.
  assert_true(t1.outbound[0].channel_hint != Some("slack:C99THREAD"))
}
