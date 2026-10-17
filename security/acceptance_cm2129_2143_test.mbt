///|
/// J-batch P0: CM-2129 credential fill + CM-2143 refused-send no channel bypass.
/// Abstract fixtures only — no real credentials.

///|
/// CM-2129: ListCredentials hit → credential-request fill succeeds; no secret plaintext to assistant.
test "acceptance_CM-2129_credential_request_fill_no_plaintext" {
  let store = @security.CredentialStore::new()
  // Abstract fixture secret — not a real credential shape.
  let fixture_secret = "fixture-secret-alpha-0001"
  store.save(
    id="cred-fixture-1",
    label="Example Login",
    domain="login.example.test",
    username="fixture-user",
    secret=fixture_secret,
  )
  let list = store.list_credentials()
  assert_eq(list.length(), 1)
  assert_eq(list[0].domain, "login.example.test")
  assert_true(list[0].has_secret)
  match store.fill_credential_request(domain="login.example.test") {
    Err(e) => fail(e)
    Ok(filled) => {
      assert_true(filled.filled)
      assert_eq(filled.credential_id, "cred-fixture-1")
      assert_eq(filled.domain, "login.example.test")
      assert_true(filled.fill_handle.has_prefix("fill-h-"))
      assert_true(filled.assistant_view.contains("credential-request"))
      assert_true(filled.assistant_view.contains("\"value\":null"))
      assert_false(filled.assistant_view.contains(fixture_secret))
      assert_false(store.fill_leaks_secret_to_assistant(filled))
    }
  }
  // Unknown domain does not fill.
  match store.fill_credential_request(domain="missing.example.test") {
    Err(m) => assert_true(m.contains("no credential") || m.contains("hit"))
    Ok(_) => fail("missing domain must not fill")
  }
}

///|
/// CM-2143: refused/expired send must not retry via another channel without new authorization.
test "acceptance_CM-2143_refused_send_no_channel_bypass" {
  let gate = @security.ApprovalGate::strict()
  let req = @security.ApprovalRequest::{
    id: "send-1",
    class_: @security.ExternalSend,
    summary: "post to slack",
    payload_json: "{}",
    irreversible: true,
  }
  let decision = gate.review(req)
  let terminal = decision.to_send_terminal()
  assert_true(terminal.is_terminal_block())
  // No new auth → refuse channel bypass (e.g. Slack → email).
  match
    @security.retry_send_via_channel(
      terminal,
      new_channel="email",
      has_new_authorization=false,
    ) {
    Err(m) => {
      assert_true(m.contains("bypass") || m.contains("authorization"))
      assert_false(m.contains("sent ok"))
    }
    Ok(_) => fail("must not bypass via another channel without new auth")
  }
  // Expired similarly blocked.
  let expired = @security.Expired(reason="approval card expired")
  match
    @security.retry_send_via_channel(
      expired,
      new_channel="sms",
      has_new_authorization=false,
    ) {
    Err(_) => ()
    Ok(_) => fail("expired must not bypass")
  }
  // Fresh authorization allows a new attempt.
  match
    @security.retry_send_via_channel(
      terminal,
      new_channel="email",
      has_new_authorization=true,
    ) {
    Ok(_) => ()
    Err(e) => fail("new authorization must allow: " + e)
  }
}
