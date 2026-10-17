///|
/// CM-0905: namespaceStatus — refuse calls when ns is not usable.
pub fn may_call_namespace(status : @connectors.ConnectorStatus) -> Bool {
  status.is_usable()
}

///|
/// CM-0903: needsAuth → do not retry call; surface connect-card hint.
pub(all) enum AuthGateOutcome {
  Proceed
  ShowConnectCard(namespace_~ : String, reason~ : String)
  Refuse(reason~ : String)
} derive(Eq, Debug)

///|
pub extend AuthGateOutcome with Eq::{equal, not_equal}

///|
pub extend AuthGateOutcome with Debug::{to_repr}

///|
pub fn gate_before_dynamic_call(
  ns : String,
  status : @connectors.ConnectorStatus,
) -> AuthGateOutcome {
  match status {
    @connectors.Ready => Proceed
    @connectors.NeedsAuth =>
      ShowConnectCard(
        namespace_=ns,
        reason="needsAuth: assistant must not fill token",
      )
    @connectors.NeedsGrant =>
      ShowConnectCard(
        namespace_=ns,
        reason="needsGrant: user must grant access",
      )
    @connectors.Loading => Refuse(reason="namespace loading; not callable")
    @connectors.Error(message~) => Refuse(reason="namespace error: " + message)
    @connectors.Unavailable => Refuse(reason="namespace unavailable")
  }
}

///|
/// Combine status gate + catalog call (CM-0902 + CM-0905).
pub fn DynamicCatalog::call_gated(
  self : DynamicCatalog,
  call : DynamicCall,
  status : @connectors.ConnectorStatus,
) -> ToolResult {
  match gate_before_dynamic_call(call.namespace_, status) {
    Proceed => self.call(call)
    ShowConnectCard(namespace_~, reason~) =>
      Blocked(reason="connect_card:" + namespace_ + ":" + reason)
    Refuse(reason~) => Blocked(reason~)
  }
}

///|
/// CM-2134: grant-flow steps after NeedsGrant refuse.
pub(all) enum GrantFlowStep {
  RefusedNeedsGrant(namespace_~ : String, reason~ : String)
  GrantCardPending(namespace_~ : String)
  GrantedReady(namespace_~ : String)
} derive(Eq, Debug)

///|
pub extend GrantFlowStep with Eq::{equal, not_equal}

///|
pub extend GrantFlowStep with Debug::{to_repr}

///|
/// Mutable grant session: NeedsGrant → refuse + card → user grant → Ready → call.
pub(all) struct GrantSession {
  namespace_ : String
  mut status : @connectors.ConnectorStatus
  mut grant_card_shown : Bool
  mut refused_before_grant : Bool
}

///|
pub fn GrantSession::new(
  namespace_~ : String,
  status~ : @connectors.ConnectorStatus,
) -> GrantSession {
  { namespace_, status, grant_card_shown: false, refused_before_grant: false, }
}

///|
/// CM-2134: Call while NeedsGrant → refuse and surface grant card.
pub fn GrantSession::call(
  self : GrantSession,
  catalog : DynamicCatalog,
  call : DynamicCall,
) -> ToolResult {
  match gate_before_dynamic_call(self.namespace_, self.status) {
    Proceed => catalog.call(call)
    ShowConnectCard(namespace_~, reason~) => {
      self.grant_card_shown = true
      self.refused_before_grant = true
      Blocked(reason="grant_flow:" + namespace_ + ":" + reason)
    }
    Refuse(reason~) => {
      self.refused_before_grant = true
      Blocked(reason~)
    }
  }
}

///|
/// User grants access → status becomes Ready (recovery path).
pub fn GrantSession::user_grants(self : GrantSession) -> GrantFlowStep {
  self.status = @connectors.Ready
  self.grant_card_shown = true
  GrantedReady(namespace_=self.namespace_)
}

///|
pub fn GrantSession::current_step(self : GrantSession) -> GrantFlowStep {
  match self.status {
    @connectors.NeedsGrant =>
      if self.grant_card_shown {
        GrantCardPending(namespace_=self.namespace_)
      } else {
        RefusedNeedsGrant(
          namespace_=self.namespace_,
          reason="needsGrant: user must grant access",
        )
      }
    @connectors.Ready => GrantedReady(namespace_=self.namespace_)
    _ =>
      RefusedNeedsGrant(
        namespace_=self.namespace_,
        reason="namespace not ready for grant flow",
      )
  }
}
