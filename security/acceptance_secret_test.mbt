///|
/// CM-1106: SecretRequest value never returned to assistant API; paste-token rejected.
test "acceptance_CM-1106_secret_no_plaintext_to_assistant" {
  let card = @security.SecretRequestCard::new(
    id="sec-1",
    prompt="Paste API token",
  )
  let secret = "ghp_abcdefghijklmnopqrstuvwxyz012345"
  match card.submit_to_vault(value=secret) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  let view = card.assistant_api_view()
  assert_false(view.contains(secret))
  assert_true(view.contains("secret-request"))
  assert_true(view.contains("\"value\":null"))
  assert_false(card.assistant_sees_plaintext(plaintext=secret))
  // Paste-token into chat rejected.
  match @security.reject_paste_token_in_chat("here is my token: " + secret) {
    Err(m) =>
      assert_true(
        m.contains("paste") ||
        m.contains("SecretRequest") ||
        m.contains("rejected"),
      )
    Ok(_) => fail("paste-token into chat must be rejected")
  }
  match
    @security.reject_paste_token_in_chat("please schedule a meeting tomorrow") {
    Ok(_) => ()
    Err(e) => fail("ordinary chat must pass: " + e)
  }
}
