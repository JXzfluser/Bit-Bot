///|
/// CM-2003: Hidden inbound / [inbound] cue — should_user_ack=false;
/// strip_cue so user-visible text excludes cue; routing still works.
test "acceptance_CM-2003_hidden_inbound_cue_not_spoken" {
  assert_eq(@runtime.strip_cue("[inbound] real user words"), "real user words")
  assert_eq(@runtime.strip_cue("[hidden] silent wake"), "silent wake")
  assert_eq(@runtime.strip_cue("[inbound cue] payload here"), "payload here")
  assert_true(@runtime.has_hidden_cue("[inbound] x"))
  assert_false(@runtime.has_hidden_cue("plain hello"))

  let (ctx, visible) = @runtime.open_turn_stripping_cue(
    turn_id="acc-2003",
    text="[inbound] please schedule",
  )
  assert_eq(visible, "please schedule")
  assert_false(visible.contains("[inbound]"))
  assert_eq(ctx.inbound_kind, @runtime.Hidden)
  assert_false(ctx.should_ack_user())
  assert_false(ctx.inbound_kind.should_user_ack())
  // Ack must not speak to user.
  let after_ack = ctx.acknowledge(body="must not send cue aloud")
  assert_eq(after_ack.outbound.length(), 0)
  // Routing still works: deliver internal follow-up without speaking cue.
  let delivered = match after_ack.deliver_text(body="routed without cue") {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(delivered.outbound.length(), 1)
  match @runtime.envelope_text_body(delivered.outbound[0]) {
    Some(b) => {
      assert_false(b.contains("[inbound]"))
      assert_eq(b, "routed without cue")
    }
    None => fail("expected Text part")
  }

  // Explicit Hidden kind also skips ack.
  let hidden = @runtime.open_turn(
    turn_id="acc-2003h",
    text="[inbound] wake",
    kind=@runtime.Hidden,
  )
  assert_false(hidden.should_ack_user())
}
