///|
/// CM-2006: first-start claim inbox — ask local part when no inbox;
/// do NOT default-generate; no claim without selection.
test "acceptance_CM-2006_claim_inbox_ask_local_part_no_default" {
  let svc = @mail.MailService::new()
  assert_eq(svc.list_inboxes().length(), 0)
  let guide = @mail.FirstStartClaimGuide::open(svc)
  assert_true(guide.phase.is_ask_local_part())
  assert_true(
    guide.ask_prompt.contains("local part") ||
    guide.ask_prompt.contains("Choose"),
  )
  assert_eq(guide.suggested_default_local_part(), None)
  match guide.claim_without_selection() {
    Err(m) =>
      assert_true(m.contains("without selection") || m.contains("selection"))
    Ok(_) => fail("must not claim without selection")
  }
  match guide.claim_after_selection(user_confirmed=true) {
    Err(m) =>
      assert_true(
        m.contains("without selection") ||
        m.contains("AskLocalPart") ||
        m.contains("ask"),
      )
    Ok(_) => fail("claim before select must fail")
  }
  match guide.select_local_part(local_part="alpha") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match guide.phase {
    @mail.AwaitingSelection(local_part~) => assert_eq(local_part, "alpha")
    _ => fail("expected AwaitingSelection")
  }
  assert_eq(svc.list_inboxes().length(), 0)
  let guide2 = @mail.FirstStartClaimGuide::open(@mail.MailService::new())
  match guide2.select_local_part(local_part="rnd-auto") {
    Err(m) =>
      assert_true(
        m.contains("default") || m.contains("invent") || m.contains("generate"),
      )
    Ok(_) => fail("rnd-auto must be refused")
  }
  match guide.claim_after_selection(user_confirmed=true) {
    Ok(id) => {
      assert_eq(id.local_part, "alpha")
      assert_eq(svc.list_inboxes().length(), 1)
    }
    Err(e) => fail(e)
  }
  match guide.phase {
    @mail.Claimed(inbox~) => assert_eq(inbox.address(), "alpha@bot.example")
    _ => fail("expected Claimed")
  }
}
