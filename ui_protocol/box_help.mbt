///|
/// CM-0805: request_box_help — handoff itself is the ask; do not pre-ask「要交棒吗」.

///|
pub(all) struct BoxHelpHandoff {
  reason : String
  /// The handoff card / message IS the ask (no prior yes/no).
  handoff_message : String
  is_ask : Bool
  pre_asked : Bool
} derive(Eq, Debug)

///|
pub extend BoxHelpHandoff with Eq::{equal, not_equal}

///|
pub extend BoxHelpHandoff with Debug::{to_repr}

///|
fn contains_forbidden_pre_ask(text : String) -> Bool {
  text.contains("要交棒吗") ||
  text.contains("要交棒麼") ||
  text.contains("要交棒麽") ||
  text.to_lower().contains("want me to hand off") ||
  text.to_lower().contains("shall i hand off")
}

///|
/// CM-0805: emit handoff as the ask — never a separate pre-ask question.
pub fn request_box_help(reason~ : String) -> Result[BoxHelpHandoff, String] {
  if reason.length() == 0 {
    return Err("request_box_help requires a reason")
  }
  if contains_forbidden_pre_ask(reason) {
    return Err(
      "request_box_help must not pre-ask handoff; handoff itself is the ask",
    )
  }
  let msg = "Box help needed: " +
    reason +
    " — please take over the desktop to complete this step."
  if contains_forbidden_pre_ask(msg) {
    return Err("internal: handoff message must not contain pre-ask")
  }
  Ok({ reason, handoff_message: msg, is_ask: true, pre_asked: false, })
}

///|
pub fn BoxHelpHandoff::is_handoff_ask(self : BoxHelpHandoff) -> Bool {
  self.is_ask &&
  !self.pre_asked &&
  !contains_forbidden_pre_ask(self.handoff_message)
}

///|
/// Detect forbidden pre-ask phrasing (for acceptance).
pub fn is_forbidden_pre_ask_handoff(text : String) -> Bool {
  contains_forbidden_pre_ask(text)
}
