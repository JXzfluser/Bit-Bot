///|
/// CM-1106: secret-request — assistant never sees plaintext; paste rejected.
test "acceptance_CM-1106_secret_request_no_plaintext" {
  let vault = @ui_protocol.SecretVault::new()
  let card = @ui_protocol.SecretRequestCard::{
    name: "github_pat",
    label: "GitHub personal access token",
  }
  let secret = "ghp_SUPERSECRETTOKENVALUE123"
  let handle = match vault.submit_secret(card, secret) {
    Ok(h) => h
    Err(e) => fail(e)
  }
  assert_eq(handle.name, "github_pat")
  assert_true(handle.id.has_prefix("sec-"))
  assert_true(vault.has_handle(handle))
  // Transcript must not contain plaintext.
  let log = vault.transcript_log()
  for line in log {
    assert_false(line.contains(secret))
    assert_false(line.contains("ghp_SUPER"))
  }
  // Pasting token into chat rejected.
  match @ui_protocol.paste_token_into_chat("please use " + secret) {
    Err(msg) => {
      assert_true(msg.contains("rejected") || msg.contains("secret-request"))
      assert_false(msg.contains(secret))
    }
    Ok(_) => fail("token paste must be rejected")
  }
  assert_eq(@ui_protocol.redact_secrets(secret), "[REDACTED]")
  match @ui_protocol.paste_token_into_chat("hello team") {
    Ok(t) => assert_eq(t, "hello team")
    Err(e) => fail(e)
  }
}
