///|
/// CM-0108: with inbound channel address, reply lands on same address;
/// omitting channel stays in-app chat (not external).
test "acceptance_CM-0108_channel_target_inbound_reply" {
  let inbound = "slack:C0123ABCDEF"
  let t0 = @runtime.open_turn(turn_id="acc-0108", text="hi from slack")
  // Reply to inbound → same address.
  let t1 = match
    t0.reply_to_channel_target(
      body="回原频道",
      inbound_address=Some(inbound),
    ) {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(t1.outbound.length(), 1)
  assert_eq(t1.outbound[0].channel_hint, Some("slack:C0123ABCDEF"))
  assert_true(@channels.is_external_hint(t1.outbound[0].channel_hint))
  // Also via deliver_text_to_inbound helper.
  let t2 = match
    t0.deliver_text_to_inbound(body="via helper", inbound_address=inbound) {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(t2.outbound[0].channel_hint, Some(inbound))
  // Omit channel → in-app only, not external.
  let t3 = match
    t0.reply_to_channel_target(body="仅应用内", inbound_address=None) {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(t3.outbound[0].channel_hint, None)
  assert_false(@channels.is_external_hint(None))
  assert_false(@channels.is_external_hint(t3.outbound[0].channel_hint))
  match @channels.assert_not_external(t3.outbound[0].channel_hint) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
}
