///|
/// CM-2127: inbound mail wake — summarize/draft only; never auto-reply to sender.
test "acceptance_CM-2127_inbound_mail_no_auto_reply" {
  let handler = @mail.InboundMailHandler::new()
  let mail = @mail.InboundMail::{
    message_id: "msg-99",
    from_address: "alice@example.com",
    subject: "Meeting tomorrow",
    body: "Can we meet at 3pm?",
  }
  let actions = handler.handle_wake(mail, user_approved_send=false)
  assert_true(handler.has_summary())
  assert_true(handler.has_draft())
  assert_false(handler.did_auto_reply_to("alice@example.com"))
  let mut saw_summarize = false
  let mut saw_draft = false
  let mut saw_send = false
  for a in actions {
    match a {
      @mail.Summarize(_) => saw_summarize = true
      @mail.DraftReply(to_~, ..) => {
        saw_draft = true
        assert_eq(to_, "alice@example.com")
      }
      @mail.SendApproved(_) => saw_send = true
    }
  }
  assert_true(saw_summarize)
  assert_true(saw_draft)
  assert_false(saw_send)
  // Still no auto-reply even if we later approve (approval ≠ auto).
  let handler2 = @mail.InboundMailHandler::new()
  let _ = handler2.handle_wake(mail, user_approved_send=true)
  assert_false(handler2.did_auto_reply_to("alice@example.com"))
}
