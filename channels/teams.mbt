///|
/// CM-1107: Microsoft Teams channel — inbound/outbound + routine trigger;
/// tenant/team scope must be correct.

///|
/// Tenant + team (+ optional channel) scope for Teams.
pub(all) struct TeamsScope {
  tenant_id : String
  team_id : String
  channel_id : String?
} derive(Eq, Debug)

///|
pub extend TeamsScope with Eq::{equal, not_equal}

///|
pub extend TeamsScope with Debug::{to_repr}

///|
pub fn TeamsScope::of(
  tenant_id~ : String,
  team_id~ : String,
  channel_id~ : String? = None,
) -> TeamsScope {
  { tenant_id, team_id, channel_id, }
}

///|
/// Address form: teams:<tenant>/<team> or teams:<tenant>/<team>/<channel>
pub fn TeamsScope::to_address(self : TeamsScope) -> String {
  match self.channel_id {
    Some(ch) => "teams:" + self.tenant_id + "/" + self.team_id + "/" + ch
    None => "teams:" + self.tenant_id + "/" + self.team_id
  }
}

///|
pub fn TeamsScope::matches(self : TeamsScope, other : TeamsScope) -> Bool {
  self.tenant_id == other.tenant_id && self.team_id == other.team_id
}

///|
pub fn TeamsScope::same_tenant_team(
  self : TeamsScope,
  other : TeamsScope,
) -> Bool {
  self.matches(other)
}

///|
/// Parse teams: address into scope.
pub fn parse_teams_scope(raw : String) -> Result[TeamsScope, String] {
  if !raw.has_prefix("teams:") {
    return Err("not a teams: address")
  }
  let rest = raw[6:].to_owned()
  let parts = rest.split("/").to_array()
  if parts.length() < 2 {
    return Err("teams address requires tenant/team")
  }
  let tenant = parts[0].to_owned()
  let team = parts[1].to_owned()
  if tenant.length() == 0 || team.length() == 0 {
    return Err("teams tenant and team must be non-empty")
  }
  let ch : String? = if parts.length() >= 3 {
    let c = parts[2].to_owned()
    if c.length() > 0 {
      Some(c)
    } else {
      None
    }
  } else {
    None
  }
  Ok(TeamsScope::of(tenant_id=tenant, team_id=team, channel_id=ch))
}

///|
/// Inbound Teams message bound to a scope.
pub(all) struct TeamsInbound {
  scope : TeamsScope
  message_id : String
  sender : String
  body : String
} derive(Eq, Debug)

///|
pub extend TeamsInbound with Eq::{equal, not_equal}

///|
pub extend TeamsInbound with Debug::{to_repr}

///|
/// Outbound delivery plan for Teams.
pub(all) enum TeamsOutboundPlan {
  Deliver(scope~ : TeamsScope, body~ : String)
  Rejected(reason~ : String)
} derive(Eq, Debug)

///|
pub extend TeamsOutboundPlan with Eq::{equal, not_equal}

///|
pub extend TeamsOutboundPlan with Debug::{to_repr}

///|
/// CM-1107: reply must stay in same tenant/team scope as inbound.
pub fn plan_teams_outbound(
  inbound : TeamsInbound,
  outbound_scope : TeamsScope,
  body~ : String,
) -> TeamsOutboundPlan {
  if !inbound.scope.same_tenant_team(outbound_scope) {
    Rejected(
      reason="Teams outbound tenant/team scope mismatch; expected " +
        inbound.scope.to_address(),
    )
  } else {
    Deliver(scope=outbound_scope, body~)
  }
}

///|
/// Routine trigger binding for Teams events (CM-1107 + CM-0409 shape).
pub(all) struct TeamsRoutineTrigger {
  scope : TeamsScope
  event_kind : String
} derive(Eq, Debug)

///|
pub extend TeamsRoutineTrigger with Eq::{equal, not_equal}

///|
pub extend TeamsRoutineTrigger with Debug::{to_repr}

///|
pub fn TeamsRoutineTrigger::new(
  scope : TeamsScope,
  event_kind : String,
) -> Result[TeamsRoutineTrigger, String] {
  if event_kind.length() == 0 {
    return Err("Teams routine trigger requires event_kind")
  }
  let ok = event_kind == "message" ||
    event_kind == "channelMessage" ||
    event_kind == "mention" ||
    event_kind == "reaction"
  if !ok {
    return Err("unknown Teams event_kind: " + event_kind)
  }
  Ok({ scope, event_kind, })
}

///|
/// Whether an inbound event wakes this routine (same tenant/team + event kind).
pub fn TeamsRoutineTrigger::matches_inbound(
  self : TeamsRoutineTrigger,
  inbound : TeamsInbound,
  event_kind : String,
) -> Bool {
  self.scope.same_tenant_team(inbound.scope) && self.event_kind == event_kind
}

///|
/// Kernel session: connect Teams channel under a fixed scope.
pub(all) struct TeamsChannelSession {
  scope : TeamsScope
  mut connected : Bool
  inbound_log : Array[TeamsInbound]
  outbound_log : Array[String]
}

///|
pub fn TeamsChannelSession::connect(scope : TeamsScope) -> TeamsChannelSession {
  { scope, connected: true, inbound_log: [], outbound_log: [], }
}

///|
pub fn TeamsChannelSession::receive(
  self : TeamsChannelSession,
  msg : TeamsInbound,
) -> Result[Unit, String] {
  if !self.connected {
    return Err("Teams channel not connected")
  }
  if !msg.scope.same_tenant_team(self.scope) {
    return Err("inbound Teams scope outside session tenant/team")
  }
  self.inbound_log.push(msg)
  Ok(())
}

///|
pub fn TeamsChannelSession::send(
  self : TeamsChannelSession,
  outbound_scope : TeamsScope,
  body~ : String,
) -> Result[String, String] {
  if !self.connected {
    return Err("Teams channel not connected")
  }
  // Fabricate a synthetic inbound-aligned check against session scope.
  let synthetic = {
    scope: self.scope,
    message_id: "session",
    sender: "system",
    body: "",
  }
  match plan_teams_outbound(synthetic, outbound_scope, body~) {
    Deliver(scope~, body~) => {
      let addr = scope.to_address()
      self.outbound_log.push(addr + "|" + body)
      Ok(addr)
    }
    Rejected(reason~) => Err(reason)
  }
}
