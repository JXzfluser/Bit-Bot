///|
/// CM-2172 / TEAM-04: teammate permission boundary — no unauthorized outbound; reuse ApprovalGate.

///|
/// Teammate attempting an external outbound action.
pub(all) struct TeammateOutboundRequest {
  teammate_id : String
  channel : String
  summary : String
  draft_body : String
  /// True only when the user explicitly authorized this teammate outbound.
  explicit_user_authorization : Bool
} derive(Eq, Debug)

///|
pub extend TeammateOutboundRequest with Eq::{equal, not_equal}

///|
pub extend TeammateOutboundRequest with Debug::{to_repr}

///|
/// Gate reuse result for teammate outbound (wraps ConsequentialOutcome).
pub(all) enum TeammateOutboundVerdict {
  /// Reused ApprovalGate / plan_consequential — not sent.
  Gated(outcome~ : ConsequentialOutcome)
  /// Attempted send without going through the shared gate — forbidden.
  UnauthorizedBypass(reason~ : String)
} derive(Eq, Debug)

///|
pub extend TeammateOutboundVerdict with Eq::{equal, not_equal}

///|
pub extend TeammateOutboundVerdict with Debug::{to_repr}

///|
pub fn TeammateOutboundVerdict::reused_approval_gate(
  self : TeammateOutboundVerdict,
) -> Bool {
  match self {
    Gated(_) => true
    UnauthorizedBypass(_) => false
  }
}

///|
pub fn TeammateOutboundVerdict::sent_unauthorized(
  self : TeammateOutboundVerdict,
) -> Bool {
  match self {
    UnauthorizedBypass(_) => true
    Gated(outcome~) => outcome.is_allow()
  }
}

///|
/// CM-2172: plan teammate outbound via the same ApprovalGate as other consequential sends.
/// No overreach — without explicit authorization stays DraftOnly (gate reuse).
pub fn plan_teammate_outbound(
  gate : ApprovalGate,
  req : TeammateOutboundRequest,
) -> TeammateOutboundVerdict {
  let approval_req = {
    id: "teammate-outbound-" + req.teammate_id,
    class_: ExternalSend,
    summary: req.summary +
    " [teammate=" +
    req.teammate_id +
    " ch=" +
    req.channel +
    "]",
    payload_json: "{\"teammate\":\"" +
    req.teammate_id +
    "\",\"channel\":\"" +
    req.channel +
    "\"}",
    irreversible: true,
  }
  let outcome = gate.plan_consequential(
    approval_req,
    explicit_user_request=req.explicit_user_authorization,
    draft_body=req.draft_body,
  )
  Gated(outcome~)
}

///|
/// Negative path: teammate must not bypass the shared gate to send.
pub fn teammate_try_outbound_bypass(
  req : TeammateOutboundRequest,
) -> TeammateOutboundVerdict {
  let _ = req
  UnauthorizedBypass(
    reason="teammate outbound must reuse ApprovalGate; bypass forbidden",
  )
}

///|
/// Acceptance helper: no unauthorized outbound when gate is reused without overreach.
pub fn assert_teammate_no_unauthorized_outbound(
  gate : ApprovalGate,
  req : TeammateOutboundRequest,
) -> Result[Unit, String] {
  let v = plan_teammate_outbound(gate, req)
  if !v.reused_approval_gate() {
    return Err("must reuse approval/gate")
  }
  if v.sent_unauthorized() {
    return Err("unauthorized outbound Allow")
  }
  match v {
    Gated(outcome~) =>
      if req.explicit_user_authorization {
        // With explicit auth still not auto-Allow for irreversible ExternalSend.
        if outcome.is_allow() {
          Err("irreversible teammate outbound must not auto-Allow")
        } else {
          Ok(())
        }
      } else if outcome.is_draft_only() {
        Ok(())
      } else {
        Err("without overreach must DraftOnly via gate reuse")
      }
    UnauthorizedBypass(reason~) => Err(reason)
  }
}
