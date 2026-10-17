///|
/// K-batch P0: CM-2142 — draft card send verbatim once (no agent edits).

///|
test "acceptance_CM-2142_draft_card_send_verbatim_once" {
  let session = @mail.VerbatimSendSession::show_draft_card(
    to_="alice@example.test",
    subject="Status update",
    body="Here is the drafted body — do not change.",
  )
  assert_true(session.card_shown)
  assert_eq(session.send_count, 0)
  // Agent must not edit after card shown.
  match session.agent_try_edit(body="sneaky rewrite") {
    Err(m) => assert_true(m.contains("must not edit") || m.contains("verbatim"))
    Ok(_) => fail("agent edit after show must fail")
  }
  // Frozen draft unchanged.
  assert_eq(session.frozen.body, "Here is the drafted body — do not change.")
  // User says send → exactly as drafted, once.
  match session.user_says_send() {
    Err(e) => fail(e)
    Ok(receipt) => {
      assert_eq(receipt.to_, "alice@example.test")
      assert_eq(receipt.subject, "Status update")
      assert_eq(receipt.body, "Here is the drafted body — do not change.")
      assert_eq(receipt.send_count, 1)
      assert_true(receipt.matches_frozen(session.frozen))
    }
  }
  // Second send refused.
  match session.user_says_send() {
    Err(m) => assert_true(m.contains("once") || m.contains("already"))
    Ok(_) => fail("must send only once")
  }
  assert_eq(session.send_count, 1)
}
