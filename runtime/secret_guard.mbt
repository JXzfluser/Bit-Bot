///|
/// CM-1506: refuse credential-shaped payloads in tool args (kernel-side guard).
/// Covers plaintext shapes and common bypass attempts (base64-ish, clipboard,
/// env dump, writing token/cookie/key material to a path).
pub fn looks_like_secret(text : String) -> Bool {
  let keys = [
    "BEGIN PRIVATE KEY", "BEGIN RSA PRIVATE KEY", "BEGIN OPENSSH PRIVATE KEY", "api_key=",
    "api-key=", "Authorization: Bearer", "Bearer ", "cookie=", "Cookie:", "clipboard_monitor",
    "keylogger",
    // Explicit bypass / exfil shapes
     "printenv", "env |", ".aws/credentials", ".ssh/id_rsa", "SKILL_TOKEN=", "session_token=",
  ]
  for k in keys {
    if text.contains(k) {
      break true
    }
  } nobreak {
    // Detect base64-wrapped private-key / bearer-ish blobs: long base64 + key markers.
    looks_like_base64_secret_bypass(text)
  }
}

///|
fn looks_like_base64_secret_bypass(text : String) -> Bool {
  // Bypass attempt: base64("BEGIN PRIVATE KEY...") or base64 bearer material
  // Heuristic: "base64" + (token|key|secret|cookie|bearer) in same args string.
  let lower_markers = ["base64", "b64decode", "base64 -d", "base64 --decode"]
  let secret_words = [
    "token", "secret", "private", "cookie", "bearer", "api_key", "apikey",
  ]
  let mut has_b64 = false
  for m in lower_markers {
    if text.contains(m) {
      has_b64 = true
      break
    }
  }
  if !has_b64 {
    return false
  }
  for w in secret_words {
    if text.contains(w) {
      return true
    }
  }
  false
}

///|
/// Audit tool args: Blocked on credential / bypass shapes (CM-1506).
pub fn guard_tool_args(args : String) -> @tools.ToolResult {
  if looks_like_secret(args) {
    @tools.Blocked(reason="credential exfiltration refused")
  } else {
    @tools.Ok(output="args_ok")
  }
}

///|
/// Named audit entry for bypass-path probes (clipboard dump, env dump, write token).
pub fn audit_bypass_attempt(args : String) -> @tools.ToolResult {
  guard_tool_args(args)
}
