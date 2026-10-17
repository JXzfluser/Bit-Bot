///|
/// CM-2156: short concrete product copy — measurable style-guide sampling.

///|
pub const STYLE_GUIDE_MAX_ACK_CHARS : Int32 = 120

///|
fn fluff_markers() -> Array[String] {
  [
    "leverage synergies", "circle back", "going forward", "touch base", "at the end of the day",
    "it is what it is", "synergize",
  ]
}

///|
fn trim_ws_local(s : String) -> String {
  let mut start = 0
  while start < s.length() {
    let c = s[start]
    if c == ' ' || c == '\t' || c == '\n' {
      start = start + 1
    } else {
      break
    }
  }
  let mut end = s.length()
  while end > start {
    let c = s[end - 1]
    if c == ' ' || c == '\t' || c == '\n' {
      end = end - 1
    } else {
      break
    }
  }
  s[start:end].to_owned()
}

///|
/// True when text matches banned empty-fluff phrases.
pub fn is_fluff_phrase(text : String) -> Bool {
  let lower = text.to_lower()
  for m in fluff_markers() {
    if lower.contains(m) {
      return true
    }
  }
  false
}

///|
/// Concrete cue: contains a digit, path slash, `#`, or common action verb.
pub fn looks_concrete(text : String) -> Bool {
  let lower = text.to_lower()
  let verbs = [
    "open", "install", "need", "wait", "ship", "defer", "run", "read", "write", "send",
    "fix", "pick", "ready", "passed", "failed", "copy",
  ]
  if text.contains("/") || text.contains("#") {
    return true
  }
  let mut i = 0
  while i < text.length() {
    let c = text[i]
    if c >= '0' && c <= '9' {
      return true
    }
    i = i + 1
  }
  for v in verbs {
    if lower.contains(v) {
      return true
    }
  }
  false
}

///|
pub fn is_short_enough(text : String) -> Bool {
  text.length() <= STYLE_GUIDE_MAX_ACK_CHARS
}

///|
/// Result of sampling a line against the short-concrete style guide.
pub(all) struct StyleGuideSample {
  text : String
  passes : Bool
  reason : String
} derive(Eq, Debug)

///|
pub extend StyleGuideSample with Eq::{equal, not_equal}

///|
pub extend StyleGuideSample with Debug::{to_repr}

///|
/// CM-2156: measurable sample check — reject empty fluff; require short+concrete.
pub fn sample_style_guide_check(text : String) -> StyleGuideSample {
  let t = trim_ws_local(text)
  if t.length() == 0 {
    return { text, passes: false, reason: "empty", }
  }
  if is_fluff_phrase(t) {
    return { text, passes: false, reason: "fluff", }
  }
  if !is_short_enough(t) {
    return { text, passes: false, reason: "too_long", }
  }
  if !looks_concrete(t) {
    return { text, passes: false, reason: "not_concrete", }
  }
  { text: t, passes: true, reason: "ok", }
}

///|
pub fn assert_style_guide_ok(text : String) -> Result[Unit, String] {
  let s = sample_style_guide_check(text)
  if s.passes {
    Ok(())
  } else {
    Err("style guide fail: " + s.reason)
  }
}

///|
/// Documented rule labels (aligned with docs/style-guide-short-concrete.md).
pub fn style_guide_rule_labels() -> Array[String] {
  ["non-empty", "concrete", "short", "no-fluff", "sampleable"]
}
