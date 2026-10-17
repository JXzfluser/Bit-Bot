///|
/// Full draft of an irreversible outbound action (CM-1501).
/// Without an explicit user request the gate must stop here — never Allow.
pub(all) struct DraftOutbound {
  class_ : ApprovalClass
  summary : String
  body : String
  payload_json : String
} derive(Eq, Debug)

///|
pub extend DraftOutbound with Eq::{not_equal, equal}

///|
pub extend DraftOutbound with Debug::{to_repr}

///|
/// Outcome of planning a consequential action (CM-1501).
pub(all) enum ConsequentialOutcome {
  DraftOnly(draft~ : DraftOutbound)
  Escalate
  NeedUser(reason~ : String)
  Allow
} derive(Eq, Debug)

///|
pub extend ConsequentialOutcome with Eq::{not_equal, equal}

///|
pub extend ConsequentialOutcome with Debug::{to_repr}

///|
pub fn ConsequentialOutcome::is_draft_only(self : ConsequentialOutcome) -> Bool {
  match self {
    DraftOnly(_) => true
    _ => false
  }
}

///|
pub fn ConsequentialOutcome::is_allow(self : ConsequentialOutcome) -> Bool {
  match self {
    Allow => true
    _ => false
  }
}

///|
/// CM-1501: without explicit user request → DraftOnly (not Allow, not silent send).
/// With explicit flag → Escalate (irreversible) or NeedUser/review — still not auto-Allow
/// unless the gate itself permits external send.
pub fn ApprovalGate::plan_consequential(
  self : ApprovalGate,
  req : ApprovalRequest,
  explicit_user_request~ : Bool,
  draft_body~ : String,
) -> ConsequentialOutcome {
  if !explicit_user_request {
    DraftOnly(draft={
      class_: req.class_,
      summary: req.summary,
      body: draft_body,
      payload_json: req.payload_json,
    })
  } else if req.irreversible {
    Escalate
  } else {
    match self.review(req) {
      Allow =>
        // Default gate never Allows ExternalSend/Purchase; preserve Allow only if review did.
        Allow
      Deny(reason~) => NeedUser(reason~)
      NeedUser(reason~) => NeedUser(reason~)
      Escalate => Escalate
    }
  }
}
