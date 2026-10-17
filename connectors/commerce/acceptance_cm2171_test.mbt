///|
/// L-batch P0: CM-2171 credential entry via secure form — no plaintext in logs.

///|
test "acceptance_CM-2171_credential_entry_secure_form_no_log" {
  let form = @commerce.SecureCredentialForm::new()
  // Abstract fixtures — not real secrets/cards.
  let pw = "fixture-pw-NOT-REAL-2171"
  let card = "4111111111111111-FIXTURE"
  match form.enter(@commerce.Password, plaintext=pw) {
    Ok(e) => {
      assert_true(e.filled)
      assert_true(e.vault_handle.has_prefix("vault-h-"))
      assert_false(e.vault_handle.contains(pw))
    }
    Err(e) => fail(e)
  }
  match form.enter(@commerce.CardNumber, plaintext=card) {
    Ok(e) => {
      assert_true(e.filled)
      assert_eq(e.kind, @commerce.CardNumber)
    }
    Err(e) => fail(e)
  }
  assert_false(form.log_contains_plaintext(plaintext=pw))
  assert_false(form.log_contains_plaintext(plaintext=card))
  for line in form.audit_log {
    assert_false(line.contains(pw))
    assert_false(line.contains(card))
    assert_true(line.contains("REDACTED") || line.contains("secure_form"))
  }
  assert_eq(form.audit_log.length(), 2)
}
