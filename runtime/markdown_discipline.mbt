///|
/// CM-0111: reject bare http(s) URLs that are not inside a markdown link.
pub fn has_bare_url(text : String) -> Bool {
  let markers = ["http://", "https://"]
  for m in markers {
    match find_substr(text, m) {
      None => ()
      Some(at) =>
        // markdown link form: ](url  — if char before scheme is '(' and we can find "](" before, OK
        if !is_markdown_link_url(text, at) {
          break true
        }
    }
  } nobreak {
    false
  }
}

///|
fn is_markdown_link_url(text : String, url_at : Int32) -> Bool {
  if url_at == 0 {
    return false
  }
  // look back for "]("
  if url_at >= 2 {
    let prev = text[url_at - 2:url_at].to_owned()
    prev == "]("
  } else {
    false
  }
}

///|
fn find_substr(hay : String, needle : String) -> Int32? {
  if needle.length() == 0 || needle.length() > hay.length() {
    return None
  }
  let last = hay.length() - needle.length()
  for i = 0; i <= last; i = i + 1 {
    if hay[i:i + needle.length()].to_owned() == needle {
      break Some(i)
    }
  } nobreak {
    None
  }
}

///|
pub fn assert_markdown_links(text : String) -> Bool {
  !has_bare_url(text)
}
