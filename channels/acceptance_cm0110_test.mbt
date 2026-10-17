///|
/// CM-0110: [inbound] reaction wake; lightweight ack default no reply;
/// act only when useful.
test "acceptance_CM-0110_inbound_reaction_no_forced_reply" {
  assert_true(@channels.has_inbound_reaction_cue("[inbound] reaction :+1:"))
  assert_true(@channels.has_inbound_reaction_cue("  [inbound] thumbs up"))
  assert_false(@channels.has_inbound_reaction_cue("hello there"))

  // Default: not useful → wake only, no forced reply.
  let light = @channels.InboundReaction::new(
    emoji="👍",
    target_message_id="msg-42",
    useful=false,
  )
  let d0 = @channels.handle_inbound_reaction(light)
  assert_true(d0.is_wake_only())
  assert_false(d0.acts())
  assert_false(d0.should_reply())
  let plan0 = @channels.plan_reaction_outbound(light)
  assert_false(plan0.reply_forced)
  assert_eq(plan0.outbound_count, 0)
  assert_eq(plan0.disposition, @channels.ReactionWakeDisposition::WakeNoReply)

  // Useful → may act, still no forced reply.
  let useful = @channels.InboundReaction::new(
    emoji="❗",
    target_message_id="msg-99",
    useful=true,
    channel_hint=Some("slack:C0123:1710000.000100"),
  )
  let d1 = @channels.handle_inbound_reaction(useful)
  assert_true(d1.acts())
  assert_false(d1.is_wake_only())
  assert_false(d1.should_reply())
  let plan1 = @channels.plan_reaction_outbound(useful)
  assert_false(plan1.reply_forced)
  assert_eq(plan1.outbound_count, 0)
  match plan1.disposition {
    @channels.ReactionWakeDisposition::ActWhenUseful(reason~) =>
      assert_true(reason.contains("useful"))
    @channels.ReactionWakeDisposition::WakeNoReply =>
      fail("useful reaction must ActWhenUseful")
  }
}
