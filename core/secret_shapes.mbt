///|
/// Secret-shape rules — ONE table, ONE place.
///
/// "What does a credential look like?" has to be answered the SAME way in
/// every place that has to decide. It used to be answered four times:
///
///   1. `ui_protocol/secret_request.mbt`        (prefix + min length)
///   2. `security/secret_request.mbt`           (substring list + a blunt
///      "32 chars with no spaces" rule that flags every long opaque string)
///   3. `hosts/desktop/secret_protocol.js`       (regex table)
///   4. `hosts/shared/host_ffi.js`               (loads #3 through a
///      three-level `require` fallback that silently degrades to null)
///
/// The copies had drifted, and the drift was in the unsafe direction: the
/// kernel's copy was NARROWER than the Host's. `API_KEY=…`, `api-key=…` and
/// `xoxs-…` were caught by the Host but not by the kernel — and the kernel is
/// the backstop that blocks a plaintext secret from reaching the transcript
/// when the caller is a CLI or an API, not the Desktop renderer.
///
/// The table below is the single source of truth. The Host side keeps the
/// same rows (`hosts/desktop/secret_protocol.js` → `SECRET_SHAPE_ROWS`) and
/// `scripts/prove_secret_shapes.mjs` compares them row by row.
///
/// Row format: `id|kind|a|b|c|d`
///   prefix : the text contains `a` followed by >= `b` token characters
///            (A-Z a-z 0-9 _ -)
///   assign : the word `a` (not preceded by a word character), then optional
///            spaces, then `b`, then optional spaces, then >= `c`
///            non-space characters
///   bearer : like `assign`, but the word `c` must follow the separator
///   phrase : the text contains both `a` and `b`
pub fn secret_shape_rows() -> Array[String] {
  [
    "ghp|prefix|ghp_|20|-|-", "gho|prefix|gho_|20|-|-", "ghu|prefix|ghu_|20|-|-",
    "ghs|prefix|ghs_|20|-|-", "ghr|prefix|ghr_|20|-|-", "github_pat|prefix|github_pat_|20|-|-",
    "sk|prefix|sk-|16|-|-", "sk_live|prefix|sk_live_|10|-|-", "xoxa|prefix|xoxa-|10|-|-",
    "xoxb|prefix|xoxb-|10|-|-", "xoxo|prefix|xoxo-|10|-|-", "xoxp|prefix|xoxp-|10|-|-",
    "xoxs|prefix|xoxs-|10|-|-", "akia|prefix|AKIA|16|-|-", "aiza|prefix|AIza|30|-|-",
    "api_key|assign|api_key|=|1|-", "apikey|assign|apikey|=|1|-", "api_dash_key|assign|api-key|=|1|-",
    "authorization|bearer|authorization|:|bearer|1", "cookie_eq|assign|cookie|=|1|-",
    "cookie_colon|assign|cookie|:|1|-", "pem|phrase|-----BEGIN |PRIVATE KEY-----|-|-",
  ]
}

///|
/// The visible stand-in for a redacted secret. The Host renders exactly this
/// string, so a bubble showing it is provably the redaction path and not a
/// truncated value.
pub const SECRET_REDACTION : String = "[REDACTED]"

///|
fn is_word_char(c : UInt16) -> Bool {
  (c >= 'a' && c <= 'z') ||
  (c >= 'A' && c <= 'Z') ||
  (c >= '0' && c <= '9') ||
  c == '_'
}

///|
fn is_token_char(c : UInt16) -> Bool {
  is_word_char(c) || c == '-'
}

///|
fn is_space_char(c : UInt16) -> Bool {
  c == ' ' || c == '\t' || c == '\n' || c == '\r'
}

///|
fn index_of(haystack : String, needle : String, from : Int32) -> Int32 {
  let n = haystack.length()
  let m = needle.length()
  let mut i = from
  while i + m <= n {
    if haystack[i:i + m].to_owned() == needle {
      return i
    }
    i = i + 1
  }
  -1
}

///|
fn skip_spaces(text : String, from : Int32) -> Int32 {
  let mut i = from
  while i < text.length() && is_space_char(text[i]) {
    i = i + 1
  }
  i
}

///|
/// Length of the non-space run starting at `from`.
fn run_length(text : String, from : Int32) -> Int32 {
  let mut i = from
  while i < text.length() && !is_space_char(text[i]) {
    i = i + 1
  }
  i - from
}

///|
/// The text contains `prefix` followed by >= `min_body` token characters.
///
/// Length matters: "task-2136" must not look like an `sk-` key while
/// "sk-proj-abcdefghijklmnop" must.
fn match_prefix(text : String, prefix : String, min_body : Int32) -> Bool {
  let n = text.length()
  let pn = prefix.length()
  if pn == 0 || n < pn + min_body {
    return false
  }
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
/// The word `keyword` (case-insensitive, not glued to a preceding word
/// character), then optional spaces, then `sep`, then optional spaces, then
/// >= `min_value` non-space characters.
fn match_assign(
  text : String,
  keyword : String,
  sep : String,
  min_value : Int32,
) -> Bool {
  let n = text.length()
  let mut start = 0
  while start < n {
    let idx = index_of(text, keyword, start)
    if idx < 0 {
      return false
    }
    let boundary = idx == 0 || !is_word_char(text[idx - 1])
    if boundary {
      let mut j = skip_spaces(text, idx + keyword.length())
      if j < n && text[j:j + sep.length()].to_owned() == sep {
        j = skip_spaces(text, j + sep.length())
        if run_length(text, j) >= min_value {
          return true
        }
      }
    }
    start = idx + 1
  }
  false
}

///|
/// Like `match_assign`, but the word `token` must follow the separator.
fn match_bearer(
  text : String,
  keyword : String,
  sep : String,
  token : String,
  min_value : Int32,
) -> Bool {
  let n = text.length()
  let mut start = 0
  while start < n {
    let idx = index_of(text, keyword, start)
    if idx < 0 {
      return false
    }
    let boundary = idx == 0 || !is_word_char(text[idx - 1])
    if boundary {
      let mut j = skip_spaces(text, idx + keyword.length())
      if j < n && text[j:j + sep.length()].to_owned() == sep {
        j = skip_spaces(text, j + sep.length())
        if j + token.length() <= n &&
          text[j:j + token.length()].to_owned() == token {
          j = skip_spaces(text, j + token.length())
          if run_length(text, j) >= min_value {
            return true
          }
        }
      }
    }
    start = idx + 1
  }
  false
}

///|
/// True when the text looks like it carries a credential.
///
/// The kernel's copy and the Host's copy used to disagree, and the kernel's
/// was the weaker one — so a secret could pass the kernel backstop that is
/// supposed to keep plaintext out of the transcript. Both sides now run
/// this table.
pub fn looks_like_secret(text : String) -> Bool {
  let lower = text.to_lower()
  for row in secret_shape_rows() {
    let parts = row.split("|").to_array()
    if parts.length() < 6 {
      continue
    }
    let kind = parts[1].to_owned()
    let a = parts[2].to_owned()
    let b = parts[3].to_owned()
    let c = parts[4].to_owned()
    let d = parts[5].to_owned()
    let hit = match kind {
      "prefix" => match_prefix(text, a, parse_int_or(b, 0))
      "assign" => match_assign(lower, a, b, parse_int_or(c, 1))
      "bearer" => match_bearer(lower, a, b, c, parse_int_or(d, 1))
      "phrase" => text.contains(a) && text.contains(b)
      _ => false
    }
    if hit {
      return true
    }
  }
  false
}

///|
fn parse_int_or(s : String, fallback : Int32) -> Int32 {
  let mut n = 0
  let mut i = 0
  while i < s.length() {
    let c = s[i]
    if c < '0' || c > '9' {
      return fallback
    }
    n = n * 10 + (c - '0').to_int()
    i = i + 1
  }
  n
}
