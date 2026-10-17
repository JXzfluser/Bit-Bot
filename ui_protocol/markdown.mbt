///|
/// Find next occurrence of needle at or after from; returns code-unit index.
fn find_from(hay : String, needle : String, from : Int32) -> Int32? {
  if needle.length() == 0 || from < 0 || from > hay.length() {
    return None
  }
  let slice = hay[from:].to_owned()
  match slice.find(needle) {
    None => None
    Some(rel) => Some(from + rel)
  }
}

///|
/// Strip one markdown link `[label](url)` starting at `open_bracket`, returning
/// the index just after the closing `)` or None if not a well-formed link.
fn skip_markdown_link(text : String, open_bracket : Int32) -> Int32? {
  // Expect: [ ... ] ( url )
  if open_bracket >= text.length() || text[open_bracket] != '[' {
    return None
  }
  match find_from(text, "](", open_bracket + 1) {
    None => None
    Some(mid) =>
      match find_from(text, ")", mid + 2) {
        None => None
        Some(close) => Some(close + 1)
      }
  }
}

///|
/// Build text with all `[label](url)` spans removed so bare URLs remain visible.
fn strip_markdown_links(text : String) -> String {
  let sb = StringBuilder()
  let mut i = 0
  while i < text.length() {
    if text[i] == '[' {
      match skip_markdown_link(text, i) {
        Some(next) => {
          i = next
          continue
        }
        None => {
          sb.write_char('[')
          i = i + 1
          continue
        }
      }
    } else {
      sb.write_string(text[i:i + 1].to_owned())
      i = i + 1
    }
  }
  sb.to_string()
}

///|
/// CM-0111: outbound user-visible text must not contain bare http(s) URLs.
/// Passes when every URL is wrapped as markdown `[label](url)`.
pub fn ensure_markdown_links(text : String) -> Result[Unit, String] {
  let stripped = strip_markdown_links(text)
  if stripped.contains("http://") || stripped.contains("https://") {
    Err("bare http(s) URL must be markdown-linked as [label](url)")
  } else {
    Ok(())
  }
}

///|
/// Alias used by some call sites / docs (same semantics as ensure_markdown_links).
pub fn validate_outbound_links(text : String) -> Result[Unit, String] {
  ensure_markdown_links(text)
}

///|
/// Known grokbot:// deeplink anchors the UI may invent; anything else is rejected.
fn known_deeplink_anchors() -> Array[String] {
  [
    "grokbot://settings", "grokbot://inbox", "grokbot://approvals", "grokbot://help",
  ]
}

///|
/// CM-0111 + CM-1902: reject invented grokbot:// anchors; accept settings?id= closed set.
pub fn validate_deeplink_or_reject(link : String) -> Result[Unit, String] {
  if link.length() == 0 {
    return Err("deeplink must not be empty")
  }
  if link.has_prefix("grokbot://") {
    // CM-1902: legal settings deep links.
    if link.has_prefix("grokbot://app/v1/settings?id=") {
      match parse_settings_deep_link(link) {
        Ok(_) => return Ok(())
        Err(e) => return Err(e)
      }
    }
    for known in known_deeplink_anchors() {
      if link == known || link.has_prefix(known + "/") {
        return Ok(())
      }
    }
    return Err("unknown grokbot:// deeplink anchor must not be invented")
  }
  // Non-grokbot schemes are not deeplink anchors; callers use ensure_markdown_links.
  if link.contains("://") {
    return Err("non-grokbot deeplink scheme is not a known UI anchor")
  }
  Ok(())
}
