///|
test "parse slack thread address" {
  let a = @channels.parse_channel_address("slack:C9:9.9")
  assert_eq(a.channel_id, "C9")
  assert_eq(a.thread_ts, Some("9.9"))
  assert_eq(a.reply_hint(), "slack:C9:9.9")
  let b = @channels.parse_channel_address("slack:C9")
  assert_false(b.is_threaded())
}
