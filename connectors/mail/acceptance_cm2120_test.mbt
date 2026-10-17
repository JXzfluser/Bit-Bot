///|
/// CM-2120: Outlook connector — needsAuth → CRUD; after auth draft/send available.
test "acceptance_CM-2120_outlook_connector_auth_then_draft_send" {
  let outlook = @mail.OutlookConnector::new()
  assert_eq(outlook.namespace_, "user-Outlook")
  assert_true(outlook.is_needs_auth())
  assert_eq(outlook.auth_status(), @connectors.NeedsAuth)
  assert_false(outlook.crud_available())
  // Before auth: draft/send unavailable.
  match outlook.create_draft(to_="a@example.com", subject="hi", body="body") {
    Err(msg) =>
      assert_true(msg.contains("needsAuth") || msg.contains("unavailable"))
    Ok(_) => fail("draft must fail while NeedsAuth")
  }
  match outlook.send_draft(draft_id="outlook-draft-1") {
    Err(msg) =>
      assert_true(msg.contains("needsAuth") || msg.contains("unavailable"))
    Ok(_) => fail("send must fail while NeedsAuth")
  }
  // Mock authenticate → Ready; CRUD available.
  match outlook.authenticate() {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_false(outlook.is_needs_auth())
  assert_eq(outlook.auth_status(), @connectors.Ready)
  assert_true(outlook.crud_available())
  match
    outlook.create_draft(
      to_="boss@example.com",
      subject="Weekly",
      body="Status update.",
    ) {
    Err(e) => fail(e)
    Ok(d) => {
      assert_eq(d.to_, "boss@example.com")
      assert_false(d.sent)
      assert_eq(outlook.draft_count(), 1)
      match outlook.send_draft(draft_id=d.id) {
        Err(e) => fail(e)
        Ok(msg) => {
          assert_true(msg.contains("sent"))
          assert_eq(outlook.sent_count(), 1)
        }
      }
    }
  }
}
