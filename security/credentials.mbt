///|
/// CM-2130: ListCredentials — metadata only; never secret/password/token plaintext.

///|
pub(all) struct CredentialMeta {
  id : String
  label : String
  domain : String
  username_hint : String
  /// Always empty / redacted on list surface.
  has_secret : Bool
} derive(Eq, Debug)

///|
pub extend CredentialMeta with Eq::{equal, not_equal}

///|
pub extend CredentialMeta with Debug::{to_repr}

///|
/// Vault entry (internal); secret never exposed by ListCredentials.
pub(all) struct CredentialRecord {
  id : String
  label : String
  domain : String
  username : String
  secret : String
} derive(Eq, Debug)

///|
pub extend CredentialRecord with Eq::{equal, not_equal}

///|
pub extend CredentialRecord with Debug::{to_repr}

///|
pub(all) struct CredentialStore {
  records : Array[CredentialRecord]
}

///|
pub fn CredentialStore::new() -> CredentialStore {
  { records: [], }
}

///|
pub fn CredentialStore::save(
  self : CredentialStore,
  id~ : String,
  label~ : String,
  domain~ : String,
  username~ : String,
  secret~ : String,
) -> Unit {
  self.records.push({ id, label, domain, username, secret, })
}

///|
fn username_hint(username : String) -> String {
  if username.length() <= 2 {
    "***"
  } else {
    username[0:1].to_owned() + "***"
  }
}

///|
/// CM-2130: list metadata only — no secret/password/token plaintext.
pub fn CredentialStore::list_credentials(
  self : CredentialStore,
) -> Array[CredentialMeta] {
  let out : Array[CredentialMeta] = []
  for r in self.records {
    out.push({
      id: r.id,
      label: r.label,
      domain: r.domain,
      username_hint: username_hint(r.username),
      has_secret: r.secret.length() > 0,
    })
  }
  out
}

///|
/// Serialize list for assistant view; must not embed any stored secret.
pub fn CredentialStore::list_credentials_json(self : CredentialStore) -> String {
  let metas = self.list_credentials()
  let mut sb = ""
  sb = sb + "["
  let mut i = 0
  for m in metas {
    if i > 0 {
      sb = sb + ","
    }
    sb = sb +
      "{\"id\":\"" +
      m.id +
      "\",\"label\":\"" +
      m.label +
      "\",\"domain\":\"" +
      m.domain +
      "\",\"username_hint\":\"" +
      m.username_hint +
      "\",\"has_secret\":" +
      (if m.has_secret { "true" } else { "false" }) +
      "}"
    i = i + 1
  }
  sb + "]"
}

///|
/// True if any stored secret appears in the list JSON (must stay false).
pub fn CredentialStore::list_leaks_secret(self : CredentialStore) -> Bool {
  let json = self.list_credentials_json()
  for r in self.records {
    if r.secret.length() > 0 && json.contains(r.secret) {
      break true
    }
  } nobreak {
    false
  }
}

///|
/// CM-2129: outcome of filling a browser/login form from a stored credential.
/// Assistant/model surface never includes secret plaintext.
pub(all) struct CredentialFillResult {
  credential_id : String
  domain : String
  filled : Bool
  /// Opaque host handle — not the secret.
  fill_handle : String
  /// Assistant-visible JSON; must not embed secret.
  assistant_view : String
} derive(Eq, Debug)

///|
pub extend CredentialFillResult with Eq::{equal, not_equal}

///|
pub extend CredentialFillResult with Debug::{to_repr}

///|
fn CredentialStore::find_record_by_domain(
  self : CredentialStore,
  domain : String,
) -> CredentialRecord? {
  for r in self.records {
    if r.domain == domain {
      break Some(r)
    }
  } nobreak {
    None
  }
}

///|
/// CM-2129: ListCredentials hit → credential-request fill succeeds.
/// Secret stays in vault/host path; assistant_view has no plaintext.
pub fn CredentialStore::fill_credential_request(
  self : CredentialStore,
  domain~ : String,
) -> Result[CredentialFillResult, String] {
  // First ensure ListCredentials would hit this domain.
  let metas = self.list_credentials()
  let mut hit = false
  for m in metas {
    if m.domain == domain && m.has_secret {
      hit = true
      break
    }
  }
  if !hit {
    return Err("no credential metadata hit for domain: " + domain)
  }
  match self.find_record_by_domain(domain) {
    None => Err("credential record missing after list hit")
    Some(rec) => {
      let handle = "fill-h-" + rec.id
      let view = "{\"type\":\"credential-request\",\"status\":\"filled\",\"id\":\"" +
        rec.id +
        "\",\"domain\":\"" +
        rec.domain +
        "\",\"fill_handle\":\"" +
        handle +
        "\",\"value\":null}"
      // Guard: never put secret into assistant view.
      if view.contains(rec.secret) {
        return Err("internal: assistant_view must not contain secret")
      }
      Ok({
        credential_id: rec.id,
        domain: rec.domain,
        filled: true,
        fill_handle: handle,
        assistant_view: view,
      })
    }
  }
}

///|
/// True if assistant_view (or any leaked surface) contains the stored secret.
pub fn CredentialStore::fill_leaks_secret_to_assistant(
  self : CredentialStore,
  result : CredentialFillResult,
) -> Bool {
  for r in self.records {
    if r.id == result.credential_id {
      if r.secret.length() > 0 && result.assistant_view.contains(r.secret) {
        break true
      } else {
        break false
      }
    }
  } nobreak {
    false
  }
}
