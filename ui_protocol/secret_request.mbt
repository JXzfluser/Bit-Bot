///|
/// CM-1106: the kernel's backstop for "a credential must not reach the
/// transcript".
///
/// The Host owns the real vault (`hosts/desktop/secret_vault.js`, encrypted
/// at rest, never crosses IPC). This file used to hold a SECOND vault — a
/// `SecretVault` that kept plaintext in kernel memory — plus a duplicate
/// `SecretRequestCard` that conflicted with the one in `security`. Both are
/// gone: the card lives in `security/` only, and the value lives in the Host
/// only. See `docs/scaffold-status.md` §"删除冲突的重复类型文件".
///
/// What stays here is the part the kernel genuinely owns: the rule that
/// decides whether a string looks like a credential. The rules themselves
/// live in `core/secret_shapes.mbt` so the Host and the kernel cannot
/// disagree — the kernel's copy used to be narrower than the Host's, which
/// let `API_KEY=…` past the one backstop that matters for CLI and API
/// callers.
pub fn paste_token_into_chat(text : String) -> Result[String, String] {
  if @core.looks_like_secret(text) {
    Err("token paste rejected: use secret-request vault handle, not plaintext")
  } else {
    Ok(text)
  }
}

///|
/// Redact credential-shaped text for display.
pub fn redact_secrets(text : String) -> String {
  if @core.looks_like_secret(text) {
    @core.SECRET_REDACTION
  } else {
    text
  }
}
