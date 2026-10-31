///|
/// CM-1106: secret-request — the assistant never sees plaintext, and a
/// pasted credential is rejected.
///
/// The vault itself lives in the Host (`hosts/desktop/secret_vault.js`,
/// encrypted at rest, never crossing IPC) and the card shape lives in
/// `security/` — this file used to hold a second vault that kept plaintext
/// in kernel memory, plus a conflicting duplicate card. Both are gone; what
/// the kernel owns is the rule that decides whether a string looks like a
/// credential, and the rule table is shared with the Host
/// (`core/secret_shapes.mbt`).
test "acceptance_CM-1106_secret_request_no_plaintext" {
  let secret = "ghp_SUPERSECRETTOKENVALUE123"
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

///|
/// The kernel's rule table used to be NARROWER than the Host's: `API_KEY=…`,
/// `api-key=…` and `xoxs-…` were caught by the Host but not by the kernel.
/// The kernel is the backstop for CLI and API callers, which have no
/// renderer — so a credential could reach the transcript. Both sides now
/// run the same table.
test "acceptance_CM-1106_kernel_catches_every_shape_the_host_catches" {
  let must_catch = [
    "ghp_abcdefghijklmnopqrstuvwxyz012345", "gho_abcdefghijklmnopqrstuvwxyz012345",
    "github_pat_abcdefghijklmnopqrstuvwxyz", "sk-proj-abcdefghijklmnop", "sk_live_abcdefghij",
    "xoxb-abcdefghij", "xoxs-abcdefghij", "AKIAIOSFODNN7EXAMPLE", "AIzaSyA1234567890abcdefghijklmnopqrstuv",
    "api_key=abcdef123456", "apikey=abcdef123456", "api-key=abcdef123456", "API_KEY=abcdef123456",
    "Authorization: Bearer abcdef123456", "cookie=abcdef123456", "Cookie: abcdef123456",
    "-----BEGIN RSA PRIVATE KEY-----",
  ]
  for s in must_catch {
    assert_true(@ui_protocol.paste_token_into_chat(s) is Err(_))
    assert_eq(@ui_protocol.redact_secrets(s), "[REDACTED]")
  }
}

///|
/// The other direction matters just as much: ordinary text must not be
/// treated as a credential. The old kernel rule flagged EVERY string of 32+
/// characters without spaces — a bare UUID, a git SHA, a base64 blob — which
/// is a false-positive machine, not a safety feature.
test "acceptance_CM-1106_ordinary_text_is_not_a_secret" {
  let must_pass = [
    "task-2136", "sk-", "hello team", "550e8400-e29b-41d4-a716-446655440000", "please schedule a meeting tomorrow",
    "the quick brown fox jumps over the lazy dog", "https://example.com/some/path?query=1",
    "aGVsbG8gd29ybGQgdGhpcyBpcyBiYXNlNjQ=",
  ]
  for s in must_pass {
    assert_true(@ui_protocol.paste_token_into_chat(s) is Ok(_))
    assert_eq(@ui_protocol.redact_secrets(s), s)
  }
}
