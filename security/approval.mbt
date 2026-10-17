///|
pub(all) enum ApprovalClass {
  Shell
  LocalMachine
  McpMutation
  CloudAgent
  ExternalSend
  Purchase
  Destructive
} derive(Eq, Debug)

///|
pub extend ApprovalClass with Eq::{not_equal, equal}

///|
pub extend ApprovalClass with Debug::{to_repr}

///|
pub fn ApprovalClass::label(self : ApprovalClass) -> String {
  match self {
    Shell => "Shell"
    LocalMachine => "LocalMachine"
    McpMutation => "McpMutation"
    CloudAgent => "CloudAgent"
    ExternalSend => "ExternalSend"
    Purchase => "Purchase"
    Destructive => "Destructive"
  }
}

///|
pub(all) enum ApprovalDecision {
  Allow
  Deny(reason~ : String)
  NeedUser(reason~ : String)
  Escalate
} derive(Eq, Debug)

///|
pub extend ApprovalDecision with Eq::{not_equal, equal}

///|
pub extend ApprovalDecision with Debug::{to_repr}

///|
pub(all) struct ApprovalRequest {
  id : String
  class_ : ApprovalClass
  summary : String
  payload_json : String
  irreversible : Bool
} derive(Eq, Debug)

///|
pub extend ApprovalRequest with Eq::{not_equal, equal}

///|
pub extend ApprovalRequest with Debug::{to_repr}

///|
/// Auto-review style gate.
pub(all) struct ApprovalGate {
  allow_shell : Bool
  allow_external_send : Bool
  auto_allow_reversible : Bool
} derive(Eq, Debug)

///|
pub extend ApprovalGate with Eq::{not_equal, equal}

///|
pub extend ApprovalGate with Debug::{to_repr}

///|
pub fn ApprovalGate::strict() -> ApprovalGate {
  {
    allow_shell: false,
    allow_external_send: false,
    auto_allow_reversible: false,
  }
}

///|
pub fn ApprovalGate::default() -> ApprovalGate {
  {
    allow_shell: false,
    allow_external_send: false,
    auto_allow_reversible: true,
  }
}

///|
fn high_risk_deny(req : ApprovalRequest) -> ApprovalDecision? {
  // CM-1502: Destructive always Deny with non-empty high-risk reason.
  if req.class_ is Destructive {
    return Some(Deny(reason="high-risk: Destructive blocked by auto-review"))
  }
  // Irreversible Shell / CloudAgent → Deny (dangerous).
  if req.irreversible && (req.class_ is Shell || req.class_ is CloudAgent) {
    return Some(
      Deny(
        reason="high-risk: irreversible " +
          req.class_.label() +
          " blocked by auto-review",
      ),
    )
  }
  None
}

///|
pub fn ApprovalGate::review(
  self : ApprovalGate,
  req : ApprovalRequest,
) -> ApprovalDecision {
  match high_risk_deny(req) {
    Some(d) => return d
    None => ()
  }
  match req.class_ {
    Shell =>
      if self.allow_shell {
        Allow
      } else {
        NeedUser(reason="shell requires approval")
      }
    ExternalSend | Purchase =>
      if self.allow_external_send && req.class_ is ExternalSend {
        Allow
      } else {
        NeedUser(reason="consequential action requires user confirmation")
      }
    Destructive =>
      // Unreachable when high_risk_deny fires; keep arm for exhaustiveness.
      Deny(reason="high-risk: Destructive blocked by auto-review")
    LocalMachine | McpMutation | CloudAgent =>
      NeedUser(reason="auto-review: elevated action")
  }
}

///|
pub fn ApprovalGate::evaluate(
  self : ApprovalGate,
  req : ApprovalRequest,
) -> ApprovalDecision {
  if req.irreversible {
    Escalate
  } else if self.auto_allow_reversible {
    Allow
  } else {
    self.review(req)
  }
}

///|
/// CM-2143 / SEC-06 / PERM-04: terminal state of a send after refuse or expiry.
pub(all) enum SendTerminalState {
  Refused(reason~ : String)
  Expired(reason~ : String)
  Authorized
} derive(Eq, Debug)

///|
pub extend SendTerminalState with Eq::{equal, not_equal}

///|
pub extend SendTerminalState with Debug::{to_repr}

///|
pub fn SendTerminalState::is_terminal_block(self : SendTerminalState) -> Bool {
  match self {
    Refused(_) | Expired(_) => true
    Authorized => false
  }
}

///|
/// CM-2143: after refuse/expire, do not retry via another channel without new auth.
pub fn retry_send_via_channel(
  state : SendTerminalState,
  new_channel~ : String,
  has_new_authorization~ : Bool,
) -> Result[Unit, String] {
  let _ = new_channel
  match state {
    Authorized => Ok(())
    Refused(reason~) | Expired(reason~) =>
      if has_new_authorization {
        Ok(())
      } else {
        Err(
          "send terminal: refuse channel bypass without new authorization (" +
          reason +
          ")",
        )
      }
  }
}

///|
/// Convenience: record a refused ExternalSend decision as terminal.
pub fn ApprovalDecision::to_send_terminal(
  self : ApprovalDecision,
) -> SendTerminalState {
  match self {
    Deny(reason~) => Refused(reason~)
    NeedUser(reason~) => Refused(reason="pending/need-user: " + reason)
    Escalate => Refused(reason="escalated; not authorized to send")
    Allow => Authorized
  }
}
