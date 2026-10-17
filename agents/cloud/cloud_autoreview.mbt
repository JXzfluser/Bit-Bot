///|
/// CM-1306: CloudAgent Auto-review — intercept then same-action approval card.

///|
/// Pending cloud action awaiting Auto-review / smart-mode approval.
pub(all) struct CloudAgentAction {
  bc_id : String
  action : String
  risk_summary : String
} derive(Eq, Debug)

///|
pub extend CloudAgentAction with Eq::{equal, not_equal}

///|
pub extend CloudAgentAction with Debug::{to_repr}

///|
/// Session pairing a CloudAgent job with Auto-review gate.
pub(all) struct CloudAgentAutoReviewSession {
  gate : @security.AutoReviewGate
  mut last_block_reason : String?
  mut last_action : String?
  mut approval_card_raised : Bool
}

///|
pub fn CloudAgentAutoReviewSession::new() -> CloudAgentAutoReviewSession {
  {
    gate: @security.AutoReviewGate::default(),
    last_block_reason: None,
    last_action: None,
    approval_card_raised: false,
  }
}

///|
/// Intercept a cloud agent action; high/medium risk blocks with reason.
pub fn CloudAgentAutoReviewSession::intercept(
  self : CloudAgentAutoReviewSession,
  action : CloudAgentAction,
  risk : @security.RiskLevel,
) -> @security.AutoReviewVerdict {
  let verdict = self.gate.block(risk, summary=action.risk_summary)
  match verdict {
    @security.Block(reason~) => {
      self.last_block_reason = Some(reason)
      self.last_action = Some(action.action)
      self.approval_card_raised = false
    }
    @security.Pass => {
      self.last_block_reason = None
      self.last_action = Some(action.action)
    }
  }
  verdict
}

///|
/// CM-1306: after intercept Block, retry the identical action → approval card.
pub fn CloudAgentAutoReviewSession::retry_same_action_card(
  self : CloudAgentAutoReviewSession,
  retry_action~ : String,
) -> Result[@security.SmartModeRetryOutcome, String] {
  match (self.last_action, self.last_block_reason) {
    (None, _) | (_, None) => Err("no prior intercept block to retry")
    (Some(orig), Some(reason)) => {
      let outcome = @security.smart_mode_retry(
        original_action=orig,
        original_reason=reason,
        retry_action~,
        retry_reason=reason,
      )
      if outcome.raises_card() {
        self.approval_card_raised = true
      }
      Ok(outcome)
    }
  }
}

///|
pub fn CloudAgentAutoReviewSession::has_approval_card(
  self : CloudAgentAutoReviewSession,
) -> Bool {
  self.approval_card_raised
}
