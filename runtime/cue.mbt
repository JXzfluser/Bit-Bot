///|
/// CM-2003: strip hidden inbound cue prefixes so they are not spoken as user text.
pub fn strip_cue(text : String) -> String {
  let trimmed = strip_leading_ws(text)
  if trimmed.has_prefix("[inbound]") {
    return strip_leading_ws(trimmed[9:].to_owned())
  }
  if trimmed.has_prefix("[hidden]") {
    return strip_leading_ws(trimmed[8:].to_owned())
  }
  if trimmed.has_prefix("[inbound ") {
    match trimmed.find("]") {
      None => trimmed
      Some(at) => strip_leading_ws(trimmed[at + 1:].to_owned())
    }
  } else if trimmed.has_prefix("[hidden ") {
    match trimmed.find("]") {
      None => trimmed
      Some(at) => strip_leading_ws(trimmed[at + 1:].to_owned())
    }
  } else {
    trimmed
  }
}

///|
fn strip_leading_ws(s : String) -> String {
  let mut i = 0
  while i < s.length() {
    let c = s[i]
    if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
      i = i + 1
    } else {
      break
    }
  }
  s[i:].to_owned()
}

///|
/// True when the raw inbound carries a hidden cue marker.
pub fn has_hidden_cue(text : String) -> Bool {
  let t = strip_leading_ws(text)
  t.has_prefix("[inbound]") ||
  t.has_prefix("[hidden]") ||
  t.has_prefix("[inbound ") ||
  t.has_prefix("[hidden ")
}

///|
/// CM-2003: open a turn from possibly-cued text; Hidden when cue present.
/// Returns (context, user_visible_text) — visible text never includes the cue.
pub fn open_turn_stripping_cue(
  turn_id~ : String,
  text~ : String,
  kind~ : InboundKind = User,
) -> (TurnContext, String) {
  let visible = strip_cue(text)
  let resolved_kind = if has_hidden_cue(text) || kind is Hidden {
    Hidden
  } else {
    kind
  }
  let ctx = open_turn(turn_id~, text=visible, kind=resolved_kind)
  (ctx, visible)
}
