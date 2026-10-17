///|
/// CM-2176: task description / decomposition / memory is NOT approval.
/// Only an explicit user ask (or Host approval card) counts as permission.

///|
pub(all) enum PermissionClaimSource {
  /// User explicitly asked for the irreversible action in this turn.
  ExplicitUserAsk
  /// Task brief / description text mentioning the action.
  TaskDescription
  /// Recalled memory that appears to authorize.
  MemoryRecall
  /// Planner decomposition step that lists the action.
  TaskDecomposition
} derive(Eq, Debug)

///|
pub extend PermissionClaimSource with Eq::{equal, not_equal}

///|
pub extend PermissionClaimSource with Debug::{to_repr}

///|
pub fn PermissionClaimSource::label(self : PermissionClaimSource) -> String {
  match self {
    ExplicitUserAsk => "explicit_user_ask"
    TaskDescription => "task_description"
    MemoryRecall => "memory_recall"
    TaskDecomposition => "task_decomposition"
  }
}

///|
/// True only for ExplicitUserAsk — descriptions/memory/decomposition never grant.
pub fn PermissionClaimSource::is_valid_approval_source(
  self : PermissionClaimSource,
) -> Bool {
  match self {
    ExplicitUserAsk => true
    TaskDescription | MemoryRecall | TaskDecomposition => false
  }
}

///|
pub(all) enum PermissionClaimVerdict {
  /// Source may proceed to Host approval / escalate path.
  MaySeekApproval
  /// Negative: not permission — stay at draft / need explicit ask.
  NotPermission(reason~ : String)
} derive(Eq, Debug)

///|
pub extend PermissionClaimVerdict with Eq::{equal, not_equal}

///|
pub extend PermissionClaimVerdict with Debug::{to_repr}

///|
pub fn PermissionClaimVerdict::grants_permission(
  self : PermissionClaimVerdict,
) -> Bool {
  match self {
    MaySeekApproval => true
    NotPermission(_) => false
  }
}

///|
/// CM-2176: evaluate whether a claim source counts as approval/permission.
pub fn evaluate_permission_claim(
  source : PermissionClaimSource,
  action_summary~ : String,
) -> PermissionClaimVerdict {
  let _ = action_summary
  if source.is_valid_approval_source() {
    MaySeekApproval
  } else {
    NotPermission(
      reason="task description / memory / decomposition is not approval; need explicit user ask",
    )
  }
}

///|
/// Plan irreversible send/purchase from a claimed source — never Allow on weak sources.
pub fn plan_irreversible_from_claim(
  source : PermissionClaimSource,
  class_ : ApprovalClass,
  summary~ : String,
  draft_body~ : String,
) -> ConsequentialOutcome {
  let gate = ApprovalGate::default()
  let req = {
    id: "claim-" + source.label(),
    class_,
    summary,
    payload_json: "{}",
    irreversible: true,
  }
  match evaluate_permission_claim(source, action_summary=summary) {
    NotPermission(_) =>
      // Force draft-only: treat as no explicit user request.
      gate.plan_consequential(req, explicit_user_request=false, draft_body~)
    MaySeekApproval =>
      gate.plan_consequential(req, explicit_user_request=true, draft_body~)
  }
}
