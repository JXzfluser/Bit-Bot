///|
/// CM-2170: legitimate lower-privilege safer adaptation ≠ rewrite/encode bypass of Auto-review.
pub(all) enum AdaptationKind {
  /// Same goal via genuinely safer / lower-privilege path (read vs write, sanctioned tool).
  SaferLowerPrivilege(note~ : String)
  /// Rewriting / encoding / splitting to slip past Auto-review — forbidden bypass.
  BypassRewrite(reason~ : String)
} derive(Eq, Debug)

///|
pub extend AdaptationKind with Eq::{equal, not_equal}

///|
pub extend AdaptationKind with Debug::{to_repr}

///|
pub fn AdaptationKind::is_safer_path(self : AdaptationKind) -> Bool {
  match self {
    SaferLowerPrivilege(_) => true
    BypassRewrite(_) => false
  }
}

///|
pub fn AdaptationKind::is_bypass(self : AdaptationKind) -> Bool {
  match self {
    BypassRewrite(_) => true
    SaferLowerPrivilege(_) => false
  }
}

///|
fn looks_like_encode_or_rewrite(original : String, adapted : String) -> Bool {
  if adapted == original {
    return false
  }
  if adapted.has_prefix("base64:") ||
    adapted.has_prefix("hex:") ||
    adapted.has_prefix("b64:") {
    return true
  }
  // Encoded wrap of original keywords.
  if adapted.contains(original) && adapted != original {
    return true
  }
  // Whitespace-stripped or trivial rename of same command keywords.
  let o = original.replace(old=" ", new="")
  let a = adapted.replace(old=" ", new="")
  if o.length() > 0 && a == o && adapted != original {
    return true
  }
  false
}

///|
/// Classify an adaptation after Auto-review block.
/// - lowers_privilege + !encode/rewrite → SaferLowerPrivilege
/// - encode/rewrite / keyword dodge → BypassRewrite
pub fn classify_adaptation(
  original_action~ : String,
  adapted_action~ : String,
  lowers_privilege~ : Bool,
  uses_sanctioned_tool~ : Bool = false,
) -> AdaptationKind {
  if looks_like_encode_or_rewrite(original_action, adapted_action) {
    return BypassRewrite(
      reason="adaptation rewrites/encodes command to bypass Auto-review",
    )
  }
  if lowers_privilege || uses_sanctioned_tool {
    let note = if uses_sanctioned_tool {
      "sanctioned lower-privilege tool"
    } else {
      "lower-privilege safer path"
    }
    SaferLowerPrivilege(note~)
  } else if adapted_action != original_action {
    BypassRewrite(
      reason="action changed without lowering privilege; refuse as bypass",
    )
  } else {
    // Identical retry is smart-mode same-action (not this classifier's safer path).
    BypassRewrite(reason="identical action is not a safer adaptation")
  }
}

///|
/// Convenience: is this pair a legitimate safer path?
pub fn is_legitimate_safer_path(
  original_action~ : String,
  adapted_action~ : String,
  lowers_privilege~ : Bool,
  uses_sanctioned_tool~ : Bool = false,
) -> Bool {
  classify_adaptation(
    original_action~,
    adapted_action~,
    lowers_privilege~,
    uses_sanctioned_tool~,
  ).is_safer_path()
}
