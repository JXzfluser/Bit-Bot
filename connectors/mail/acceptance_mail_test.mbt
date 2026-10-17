///|
/// CM-1001: empty list guides claim; after claim list has one.
test "acceptance_CM-1001_list_inboxes_empty_then_claimed" {
  let svc = @mail.MailService::new()
  assert_eq(svc.list_inboxes().length(), 0)
  match svc.claim_inbox(local_part="alpha", user_confirmed=true) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_eq(svc.list_inboxes().length(), 1)
  assert_eq(svc.list_inboxes()[0].address(), "alpha@bot.example")
}

///|
/// CM-1002: availability without claiming.
test "acceptance_CM-1002_check_availability" {
  let svc = @mail.MailService::new()
  let avail = svc.check_availability()
  assert_true(avail.length() >= 2)
  assert_eq(svc.list_inboxes().length(), 0)
}

///|
/// CM-1003: no confirm / random / double-claim rejected.
test "acceptance_CM-1003_claim_requires_user_selection" {
  let svc = @mail.MailService::new()
  match svc.claim_inbox(local_part="alpha", user_confirmed=false) {
    Err(m) => assert_true(m.contains("confirmation"))
    Ok(_) => fail("must require confirmation")
  }
  match svc.claim_inbox(local_part="random", user_confirmed=true) {
    Err(m) => assert_true(m.contains("random") || m.contains("forbidden"))
    Ok(_) => fail("random forbidden")
  }
  match svc.claim_inbox(local_part="bravo", user_confirmed=true) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match svc.claim_inbox(local_part="charlie", user_confirmed=true) {
    Err(m) => assert_true(m.contains("already"))
    Ok(_) => fail("double claim forbidden")
  }
}

///|
/// CM-1004: search/read thread_id from this service.
test "acceptance_CM-1004_search_and_read_thread" {
  let svc = @mail.MailService::new()
  svc.seed_thread(id="th-1", subject="Hello", snippet="hi")
  let hits = svc.search_threads(query="Hello")
  assert_eq(hits.length(), 1)
  match svc.read_thread(thread_id="th-1") {
    Ok(t) => assert_eq(t.subject, "Hello")
    Err(e) => fail(e)
  }
  match svc.read_thread(thread_id="nope") {
    Err(_) => ()
    Ok(_) => fail("unknown thread must err")
  }
}

///|
/// CM-1005: editable draft card; send only after user presses Send.
test "acceptance_CM-1005_draft_card_send_only_on_press" {
  let card0 = @mail.DraftEmailCard::new(
    to_="a@x.com",
    subject="Hi",
    body="body",
  )
  match card0.try_send() {
    Err(m) => assert_true(m.contains("press Send"))
    Ok(_) => fail("must not send before press")
  }
  let card1 = card0.edit(subject=Some("Hi edited"))
  assert_eq(card1.subject, "Hi edited")
  card1.press_send()
  match card1.try_send() {
    Ok(s) => assert_true(s.contains("a@x.com"))
    Err(e) => fail(e)
  }
  // Without explicit user send intent → DraftOnly via gate.
  let planned = @mail.plan_email_without_explicit_send(
    to_="a@x.com",
    subject="Hi",
    body="body",
  )
  assert_true(planned.is_draft_only())
  assert_false(planned.is_allow())
}
