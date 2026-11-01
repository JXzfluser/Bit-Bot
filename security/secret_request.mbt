///|
/// CM-1106: SecretRequest card — value lives in vault, never returned to
/// the assistant API surface.
pub(all) struct SecretRequestCard {
  id : String
  prompt : String
  mut vault_value : String?
  mut submitted : Bool
} derive(Eq, Debug)

///|
pub extend SecretRequestCard with Eq::{equal, not_equal}

///|
pub extend SecretRequestCard with Debug::{to_repr}

///|
pub fn SecretRequestCard::new(
  id~ : String,
  prompt~ : String,
) -> SecretRequestCard {
  { id, prompt, vault_value: None, submitted: false, }
}

///|
/// User submits secret into vault (Host path). Assistant never receives value.
pub fn SecretRequestCard::submit_to_vault(
  self : SecretRequestCard,
  value~ : String,
) -> Result[Unit, String] {
  if value.length() == 0 {
    return Err("empty secret")
  }
  self.vault_value = Some(value)
  self.submitted = true
  Ok(())
}

///|
/// Assistant-visible view: never includes plaintext secret.
pub fn SecretRequestCard::assistant_api_view(
  self : SecretRequestCard,
) -> String {
  let status = if self.submitted { "submitted" } else { "pending" }
  "{\"type\":\"secret-request\",\"id\":\"" +
  self.id +
  "\",\"prompt\":\"" +
  self.prompt +
  "\",\"status\":\"" +
  status +
  "\",\"value\":null}"
}

///|
/// True if assistant view leaks plaintext (must stay false after submit).
pub fn SecretRequestCard::assistant_sees_plaintext(
  self : SecretRequestCard,
  plaintext~ : String,
) -> Bool {
  let view = self.assistant_api_view()
  view.contains(plaintext)
}

///|
/// CM-1106: paste-token into chat is rejected.
///
/// The rule is `core/secret_shapes.mbt` — the same table the Host uses. This
/// package used to carry its own, weaker copy: a substring list plus a
/// blanket "32 characters with no spaces" rule that flagged every long
/// opaque string (a bare UUID, a base64 blob, a git SHA) as a secret, while
/// missing the shapes the Host actually catches (`API_KEY=…`, `api-key=…`,
/// `xoxs-…`). One table, both sides.
pub fn reject_paste_token_in_chat(text : String) -> Result[Unit, String] {
  if @core.looks_like_secret(text) {
    Err("paste-token into chat rejected; use SecretRequest card")
  } else {
    Ok(())
  }
}
