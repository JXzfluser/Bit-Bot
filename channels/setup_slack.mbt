///|
/// CM-1105: SetUpSlack — connect/status tool or Details guide; flow completable.
pub(all) enum SlackConnectStatus {
  Disconnected
  Connecting
  Connected
  NeedsDetails
} derive(Eq, Debug)

///|
pub extend SlackConnectStatus with Eq::{equal, not_equal}

///|
pub extend SlackConnectStatus with Debug::{to_repr}

///|
pub fn SlackConnectStatus::label(self : SlackConnectStatus) -> String {
  match self {
    Disconnected => "disconnected"
    Connecting => "connecting"
    Connected => "connected"
    NeedsDetails => "needs_details"
  }
}

///|
pub(all) enum SetUpSlackAction {
  /// Run SetUpSlack connect tool.
  ConnectTool
  /// Guide user to Details / settings panel.
  GuideDetails
} derive(Eq, Debug)

///|
pub extend SetUpSlackAction with Eq::{equal, not_equal}

///|
pub extend SetUpSlackAction with Debug::{to_repr}

///|
pub(all) struct SetUpSlackSession {
  mut status : SlackConnectStatus
  mut used_action : SetUpSlackAction?
  mut details_opened : Bool
}

///|
pub fn SetUpSlackSession::new() -> SetUpSlackSession {
  { status: Disconnected, used_action: None, details_opened: false, }
}

///|
/// Status probe (SetUpSlack status).
pub fn SetUpSlackSession::status(
  self : SetUpSlackSession,
) -> SlackConnectStatus {
  self.status
}

///|
/// Start connect via SetUpSlack tool — flow can complete to Connected.
pub fn SetUpSlackSession::connect_tool(
  self : SetUpSlackSession,
) -> Result[SlackConnectStatus, String] {
  match self.status {
    Connected => Ok(Connected)
    Disconnected | NeedsDetails | Connecting => {
      self.used_action = Some(ConnectTool)
      self.status = Connecting
      // Mock: connect succeeds.
      self.status = Connected
      Ok(Connected)
    }
  }
}

///|
/// Guide to Details panel when tool unavailable — user can finish connect there.
pub fn SetUpSlackSession::guide_details(
  self : SetUpSlackSession,
) -> Result[String, String] {
  self.used_action = Some(GuideDetails)
  self.status = NeedsDetails
  self.details_opened = true
  Ok("Open Details → Channels → Slack to finish connecting")
}

///|
/// Complete connect after Details flow.
pub fn SetUpSlackSession::complete_from_details(
  self : SetUpSlackSession,
) -> Result[SlackConnectStatus, String] {
  if !self.details_opened {
    return Err("Details guide not opened; call guide_details first")
  }
  self.status = Connected
  Ok(Connected)
}

///|
pub fn SetUpSlackSession::is_connected(self : SetUpSlackSession) -> Bool {
  match self.status {
    Connected => true
    _ => false
  }
}

///|
pub fn SetUpSlackSession::flow_completable(self : SetUpSlackSession) -> Bool {
  match self.used_action {
    Some(ConnectTool) | Some(GuideDetails) => true
    None => false
  }
}
