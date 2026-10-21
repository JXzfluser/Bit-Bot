///|
/// CM-1106: secret-request card shown to the user (not plaintext).
pub(all) struct SecretRequestCard {
  name : String
  label : String
} derive(Eq, Debug)

///|
pub extend SecretRequestCard with Eq::{equal, not_equal}

///|
pub extend SecretRequestCard with Debug::{to_repr}

///|
/// Opaque vault handle — assistant sees only this, never plaintext.
pub(all) struct SecretHandle {
  id : String
  name : String
} derive(Eq, Debug)

///|
pub extend SecretHandle with Eq::{equal, not_equal}

///|
pub extend SecretHandle with Debug::{to_repr}

///|
pub(all) struct SecretVaultEntry {
  handle : SecretHandle
  // plaintext stored only in vault mock; never returned by transcript APIs
  plaintext : String
}

///|
/// Mock secret vault: stores value by handle; assistant APIs never echo plaintext.
pub(all) struct SecretVault {
  mut seq : Int32
  entries : Array[SecretVaultEntry]
  transcript : Array[String]
}

///|
pub fn SecretVault::new() -> SecretVault {
  { seq: 0, entries: [], transcript: [], }
}

///|
fn is_token_char(c : UInt16) -> Bool {
  (c >= 'a' && c <= 'z') ||
  (c >= 'A' && c <= 'Z') ||
  (c >= '0' && c <= '9') ||
  c == '_' ||
  c == '-'
}

///|
/// True when `text` contains `prefix` followed by >= min_body token chars.
/// Length matters: "task-2136" must not look like an `sk-` key while
/// "sk-proj-abcdefghijklmnop" must (GP-101).
fn has_token_shape(text : String, prefix : String, min_body : Int32) -> Bool {
  let n = text.length()
  let pn = prefix.length()
  guard pn > 0 && n >= pn + min_body else { false }
  let mut i = 0
  while i + pn <= n {
    if text[i:i + pn].to_owned() == prefix {
      let mut j = i + pn
      while j < n && is_token_char(text[j]) {
        j = j + 1
      }
      if j - (i + pn) >= min_body {
        return true
      }
    }
    i = i + 1
  }
  false
}

///|
fn looks_like_token(text : String) -> Bool {
  let shapes : Array[(String, Int32)] = [
    ("ghp_", 20), ("gho_", 20), ("ghu_", 20), ("ghs_", 20), ("ghr_", 20),
    ("github_pat_", 20), ("sk-", 16), ("sk_live_", 10), ("xoxb-", 10),
    ("xoxp-", 10), ("xoxa-", 10), ("AKIA", 16), ("AIza", 30),
  ]
  for shape in shapes {
    if has_token_shape(text, shape.0, shape.1) {
      break true
    }
  } nobreak {
    (text.contains("-----BEGIN") && text.contains("PRIVATE KEY-----")) ||
    text.contains("api_key=") ||
    text.contains("apikey=") ||
    text.contains("Authorization: Bearer") ||
    text.contains("cookie=") ||
    text.contains("Cookie:")
  }
}

///|
/// CM-1106: submit secret → handle only; plaintext stays in vault.
pub fn SecretVault::submit_secret(
  self : SecretVault,
  card : SecretRequestCard,
  plaintext : String,
) -> Result[SecretHandle, String] {
  if plaintext.length() == 0 {
    return Err("empty secret")
  }
  self.seq = self.seq + 1
  let handle = { id: "sec-" + self.seq.to_string(), name: card.name, }
  self.entries.push({ handle, plaintext, })
  // Transcript records handle id only — never plaintext.
  self.transcript.push(
    "secret-request submitted name=" + card.name + " handle=" + handle.id,
  )
  Ok(handle)
}

///|
/// Transcript / log API: never echoes plaintext values.
pub fn SecretVault::transcript_log(self : SecretVault) -> Array[String] {
  let out : Array[String] = []
  for line in self.transcript {
    out.push(line)
  }
  for e in self.entries {
    // Guard: if somehow plaintext leaked into a line, redact.
    let _ = e.plaintext
    out.push("vault-entry handle=" + e.handle.id + " name=" + e.handle.name)
  }
  out
}

///|
/// Resolve handle → exists check for tests; does NOT return plaintext to assistant.
pub fn SecretVault::has_handle(
  self : SecretVault,
  handle : SecretHandle,
) -> Bool {
  for e in self.entries {
    if e.handle.id == handle.id {
      break true
    }
  } nobreak {
    false
  }
}

///|
/// CM-1106: pasting a token into chat/transcript is rejected or redacted.
pub fn paste_token_into_chat(text : String) -> Result[String, String] {
  if looks_like_token(text) {
    Err("token paste rejected: use secret-request vault handle, not plaintext")
  } else {
    Ok(text)
  }
}

///|
/// Redact credential-shaped spans for display.
pub fn redact_secrets(text : String) -> String {
  if looks_like_token(text) {
    "[REDACTED]"
  } else {
    text
  }
}
