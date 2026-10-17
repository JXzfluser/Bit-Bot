///|
/// CM-2144: standing permission (e.g. direct-send grant) — revoke takes effect immediately.

///|
pub(all) enum StandingPermissionKind {
  DirectSend
  ExternalPost
} derive(Eq, Debug)

///|
pub extend StandingPermissionKind with Eq::{equal, not_equal}

///|
pub extend StandingPermissionKind with Debug::{to_repr}

///|
pub fn StandingPermissionKind::label(self : StandingPermissionKind) -> String {
  match self {
    DirectSend => "direct-send"
    ExternalPost => "external-post"
  }
}

///|
pub(all) struct StandingGrant {
  id : String
  kind : StandingPermissionKind
  channel : String
  mut active : Bool
} derive(Eq, Debug)

///|
pub extend StandingGrant with Eq::{equal, not_equal}

///|
pub extend StandingGrant with Debug::{to_repr}

///|
pub(all) enum DirectSendAttempt {
  /// Standing grant still active — may send without reconfirm.
  AllowedStanding(grant_id~ : String)
  /// No grant / revoked — next message needs reconfirm.
  NeedReconfirm(reason~ : String)
} derive(Eq, Debug)

///|
pub extend DirectSendAttempt with Eq::{equal, not_equal}

///|
pub extend DirectSendAttempt with Debug::{to_repr}

///|
pub fn DirectSendAttempt::needs_reconfirm(self : DirectSendAttempt) -> Bool {
  match self {
    NeedReconfirm(_) => true
    AllowedStanding(_) => false
  }
}

///|
/// Table of standing permissions; revoke is immediate.
pub(all) struct StandingPermissionTable {
  grants : Array[StandingGrant]
}

///|
pub fn StandingPermissionTable::new() -> StandingPermissionTable {
  { grants: [], }
}

///|
/// Grant prior direct-send standing permission.
pub fn StandingPermissionTable::grant_direct_send(
  self : StandingPermissionTable,
  id~ : String,
  channel~ : String,
) -> StandingGrant {
  let g = { id, kind: DirectSend, channel, active: true, }
  self.grants.push(g)
  g
}

///|
fn standing_find_grant(
  table : StandingPermissionTable,
  id : String,
) -> StandingGrant? {
  for g in table.grants {
    if g.id == id {
      return Some(g)
    }
  }
  None
}

///|
/// CM-2144: revoke standing permission — immediate.
pub fn StandingPermissionTable::revoke(
  self : StandingPermissionTable,
  id : String,
) -> Result[Unit, String] {
  match standing_find_grant(self, id) {
    None => Err("unknown standing permission: " + id)
    Some(g) => {
      g.active = false
      Ok(())
    }
  }
}

///|
pub fn StandingPermissionTable::is_active(
  self : StandingPermissionTable,
  id : String,
) -> Bool {
  match standing_find_grant(self, id) {
    None => false
    Some(g) => g.active
  }
}

///|
/// Next direct-send message: allowed if active grant; else need reconfirm.
pub fn StandingPermissionTable::attempt_direct_send(
  self : StandingPermissionTable,
  grant_id~ : String,
  channel~ : String,
) -> DirectSendAttempt {
  match standing_find_grant(self, grant_id) {
    None =>
      NeedReconfirm(reason="no standing direct-send grant; need reconfirm")
    Some(g) =>
      if !g.active {
        NeedReconfirm(
          reason="standing permission revoked; next message needs reconfirm",
        )
      } else if g.channel != channel {
        NeedReconfirm(reason="standing grant channel mismatch; need reconfirm")
      } else if !(g.kind is DirectSend) {
        NeedReconfirm(reason="grant is not direct-send; need reconfirm")
      } else {
        AllowedStanding(grant_id~)
      }
  }
}
