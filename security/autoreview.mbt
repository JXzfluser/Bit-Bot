///|
/// CM-1502: risk level for Auto-review pre-check.
pub(all) enum RiskLevel {
  Low
  Medium
  HighRisk
} derive(Eq, Debug)

///|
pub extend RiskLevel with Eq::{equal, not_equal}

///|
pub extend RiskLevel with Debug::{to_repr}

///|
/// CM-1502: Auto-review verdict — Pass or Block with reason string.
pub(all) enum AutoReviewVerdict {
  Pass
  Block(reason~ : String)
} derive(Eq, Debug)

///|
pub extend AutoReviewVerdict with Eq::{equal, not_equal}

///|
pub extend AutoReviewVerdict with Debug::{to_repr}

///|
pub fn AutoReviewVerdict::is_block(self : AutoReviewVerdict) -> Bool {
  match self {
    Block(_) => true
    Pass => false
  }
}

///|
pub fn AutoReviewVerdict::reason(self : AutoReviewVerdict) -> String? {
  match self {
    Block(reason~) => Some(reason)
    Pass => None
  }
}

///|
/// Auto-review gate (CM-1502).
pub(all) struct AutoReviewGate {
  block_high_risk : Bool
} derive(Eq, Debug)

///|
pub extend AutoReviewGate with Eq::{equal, not_equal}

///|
pub extend AutoReviewGate with Debug::{to_repr}

///|
pub fn AutoReviewGate::default() -> AutoReviewGate {
  { block_high_risk: true, }
}

///|
pub fn AutoReviewGate::permissive() -> AutoReviewGate {
  { block_high_risk: false, }
}

///|
/// CM-1502: block(high_risk) → reason string; lower risk may Pass.
pub fn AutoReviewGate::block(
  self : AutoReviewGate,
  risk : RiskLevel,
  summary~ : String = "",
) -> AutoReviewVerdict {
  match risk {
    HighRisk =>
      if self.block_high_risk {
        let detail = if summary.length() > 0 {
          "high_risk: " + summary
        } else {
          "high_risk: auto-review blocked"
        }
        Block(reason=detail)
      } else {
        Pass
      }
    Medium => Block(reason="medium_risk: elevated action requires review")
    Low => Pass
  }
}

///|
/// CM-1503: outcome of a smart-mode approval retry.
pub(all) enum SmartModeRetryOutcome {
  RaiseApprovalCard(reason~ : String)
  RejectBypass(reason~ : String)
} derive(Eq, Debug)

///|
pub extend SmartModeRetryOutcome with Eq::{equal, not_equal}

///|
pub extend SmartModeRetryOutcome with Debug::{to_repr}

///|
pub fn SmartModeRetryOutcome::raises_card(self : SmartModeRetryOutcome) -> Bool {
  match self {
    RaiseApprovalCard(_) => true
    RejectBypass(_) => false
  }
}

///|
/// CM-1503: only identical action + reason raises approval card;
/// rewritten / encoded variant rejected as bypass.
/// Named smart_mode_retry (not resume — reserved).
pub fn smart_mode_retry(
  original_action~ : String,
  original_reason~ : String,
  retry_action~ : String,
  retry_reason~ : String,
) -> SmartModeRetryOutcome {
  if is_encoded_or_rewritten(original_action, retry_action) {
    return RejectBypass(
      reason="smart-mode: rewritten/encoded variant rejected as bypass",
    )
  }
  if retry_action == original_action && retry_reason == original_reason {
    RaiseApprovalCard(reason=original_reason)
  } else if retry_action != original_action {
    RejectBypass(reason="smart-mode: action rewritten; refuse bypass")
  } else {
    RejectBypass(reason="smart-mode: block reason rewritten; refuse bypass")
  }
}

///|
fn is_encoded_or_rewritten(original : String, retry : String) -> Bool {
  if retry == original {
    return false
  }
  // Base64-ish or hex-wrapped or whitespace-stripped rewrite of same keywords.
  if retry.has_prefix("base64:") ||
    retry.has_prefix("hex:") ||
    retry.has_prefix("b64:") {
    return true
  }
  // Encoded form that merely wraps the original.
  if retry.contains(original) && retry != original {
    return true
  }
  false
}
