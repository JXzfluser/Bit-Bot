///|
/// CM-1009: unsolicited unsubscribe — cold email single recipient + unsubscribe;
/// card send does not support cold outreach; multi-recipient violation rejected.
test "acceptance_CM-1009_unsolicited_mail_unsubscribe_reject_multi" {
  assert_false(@mail.card_send_supports_cold_outreach())
  // Valid cold: single To + unsubscribe.
  let ok_plan = @mail.UnsolicitedMailPlan::cold(
    "prospect@example.com",
    subject="Intro",
    body="Hello",
    unsubscribe="https://example.com/unsub/abc",
  )
  match @mail.validate_unsolicited_mail(ok_plan) {
    @mail.Allowed => ()
    @mail.Rejected(reason~) => fail("valid cold must Allowed: " + reason)
  }
  // Multi-recipient violation rejected.
  let multi : @mail.UnsolicitedMailPlan = {
    recipients: ["a@example.com", "b@example.com"],
    subject: "blast",
    body: "hi",
    unsubscribe: Some("https://example.com/unsub"),
    kind: @mail.UnsolicitedCold,
  }
  match @mail.validate_unsolicited_mail(multi) {
    @mail.Rejected(reason~) =>
      assert_true(
        reason.contains("multi-recipient") || reason.contains("violation"),
      )
    @mail.Allowed => fail("multi-recipient cold must Rejected")
  }
  // Missing unsubscribe rejected.
  let no_unsub : @mail.UnsolicitedMailPlan = {
    recipients: ["a@example.com"],
    subject: "x",
    body: "y",
    unsubscribe: None,
    kind: @mail.UnsolicitedCold,
  }
  match @mail.validate_unsolicited_mail(no_unsub) {
    @mail.Rejected(reason~) => assert_true(reason.contains("unsubscribe"))
    @mail.Allowed => fail("missing unsubscribe must Rejected")
  }
  // Card send path refuses cold even when plan is otherwise valid.
  match @mail.try_card_send_cold(ok_plan) {
    Err(m) =>
      assert_true(
        m.contains("card send") ||
        m.contains("cold") ||
        m.contains("unsolicited"),
      )
    Ok(_) => fail("card send must not support cold outreach")
  }
  match @mail.plan_unsolicited_send(ok_plan, via_card=true) {
    Err(m) => assert_true(m.contains("card") || m.contains("cold"))
    Ok(_) => fail("via_card cold must Err")
  }
  match @mail.plan_unsolicited_send(ok_plan, via_card=false) {
    Ok(s) => assert_true(s.contains("unsubscribe") || s.contains("cold"))
    Err(e) => fail(e)
  }
  match @mail.plan_unsolicited_send(multi, via_card=false) {
    Err(m) => assert_true(m.contains("multi") || m.contains("violation"))
    Ok(_) => fail("multi must Err")
  }
}
