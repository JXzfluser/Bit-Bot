///|
/// CM-2120: Outlook connector — needsAuth → CRUD; after auth draft/send available.
/// Kernel-contract mock auth (no real OAuth).

///|
pub(all) struct OutlookDraft {
  id : String
  to_ : String
  subject : String
  body : String
  mut sent : Bool
} derive(Eq, Debug)

///|
pub extend OutlookDraft with Eq::{equal, not_equal}

///|
pub extend OutlookDraft with Debug::{to_repr}

///|
/// user-Outlook connector surface.
pub(all) struct OutlookConnector {
  namespace_ : String
  mut status : @connectors.ConnectorStatus
  drafts : Array[OutlookDraft]
  mut next_id : Int32
  sent_ids : Array[String]
}

///|
/// Fresh connector starts in NeedsAuth (not usable for CRUD).
pub fn OutlookConnector::new() -> OutlookConnector {
  {
    namespace_: "user-Outlook",
    status: @connectors.NeedsAuth,
    drafts: [],
    next_id: 1,
    sent_ids: [],
  }
}

///|
pub fn OutlookConnector::auth_status(
  self : OutlookConnector,
) -> @connectors.ConnectorStatus {
  self.status
}

///|
pub fn OutlookConnector::is_needs_auth(self : OutlookConnector) -> Bool {
  self.status is @connectors.NeedsAuth
}

///|
/// Mock authenticate — transitions NeedsAuth → Ready.
pub fn OutlookConnector::authenticate(
  self : OutlookConnector,
) -> Result[Unit, String] {
  match self.status {
    @connectors.NeedsAuth => {
      self.status = @connectors.Ready
      Ok(())
    }
    @connectors.Ready => Ok(())
    @connectors.Loading => Err("outlook still loading")
    @connectors.NeedsGrant => Err("outlook needs grant, not auth")
    @connectors.Error(message~) => Err("outlook error: " + message)
    @connectors.Unavailable => Err("outlook unavailable")
  }
}

///|
/// Draft/send CRUD available only when Ready (after auth).
pub fn OutlookConnector::crud_available(self : OutlookConnector) -> Bool {
  self.status.is_usable()
}

///|
fn OutlookConnector::require_ready(
  self : OutlookConnector,
) -> Result[Unit, String] {
  if self.crud_available() {
    Ok(())
  } else {
    Err("outlook needsAuth: draft/send unavailable until authenticate")
  }
}

///|
/// Create draft — Err while NeedsAuth.
pub fn OutlookConnector::create_draft(
  self : OutlookConnector,
  to_~ : String,
  subject~ : String,
  body~ : String,
) -> Result[OutlookDraft, String] {
  match self.require_ready() {
    Err(e) => Err(e)
    Ok(_) => {
      let n = self.next_id
      self.next_id = n + 1
      let d = {
        id: "outlook-draft-" + n.to_string(),
        to_,
        subject,
        body,
        sent: false,
      }
      self.drafts.push(d)
      Ok(d)
    }
  }
}

///|
/// Send draft — Err while NeedsAuth; marks sent after auth.
pub fn OutlookConnector::send_draft(
  self : OutlookConnector,
  draft_id~ : String,
) -> Result[String, String] {
  match self.require_ready() {
    Err(e) => Err(e)
    Ok(_) => {
      let mut i = 0
      while i < self.drafts.length() {
        if self.drafts[i].id == draft_id {
          if self.drafts[i].sent {
            return Err("draft already sent: " + draft_id)
          }
          self.drafts[i].sent = true
          self.sent_ids.push(draft_id)
          return Ok("sent outlook draft " + draft_id)
        }
        i = i + 1
      }
      Err("outlook draft not found: " + draft_id)
    }
  }
}

///|
pub fn OutlookConnector::draft_count(self : OutlookConnector) -> Int32 {
  self.drafts.length()
}

///|
pub fn OutlookConnector::sent_count(self : OutlookConnector) -> Int32 {
  self.sent_ids.length()
}
