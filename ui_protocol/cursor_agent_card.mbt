///|
/// CM-2131: SendToUser type=cursor-agent shows cloud agent card (kernel-contract).
/// Given bcId When issue card Then can open cloud agent.

///|
/// SendToUser content type for Host rendering.
pub(all) enum SendToUserType {
  Markdown
  Widget
  CursorAgent
} derive(Eq, Debug)

///|
pub extend SendToUserType with Eq::{equal, not_equal}

///|
pub extend SendToUserType with Debug::{to_repr}

///|
pub fn SendToUserType::label(self : SendToUserType) -> String {
  match self {
    Markdown => "markdown"
    Widget => "widget"
    CursorAgent => "cursor-agent"
  }
}

///|
/// Cloud agent card issued via SendToUser (type=cursor-agent).
pub(all) struct CursorAgentCard {
  bc_id : String
  url : String
  type_label : String
  mut opened : Bool
} derive(Eq, Debug)

///|
pub extend CursorAgentCard with Eq::{equal, not_equal}

///|
pub extend CursorAgentCard with Debug::{to_repr}

///|
pub fn CursorAgentCard::is_cursor_agent_type(self : CursorAgentCard) -> Bool {
  self.type_label == "cursor-agent"
}

///|
pub fn CursorAgentCard::can_open_cloud(self : CursorAgentCard) -> Bool {
  self.bc_id.length() > 0 && self.url.has_prefix("https://")
}

///|
/// Issue a cursor-agent card for a known bcId (kernel-contract mock).
pub fn issue_cursor_agent_card(
  bc_id : String,
) -> Result[CursorAgentCard, String] {
  if bc_id.length() == 0 {
    return Err("cursor-agent card requires bcId")
  }
  Ok({
    bc_id,
    url: "https://cursor.com/agents/" + bc_id,
    type_label: SendToUserType::CursorAgent.label(),
    opened: false,
  })
}

///|
/// SendToUser envelope carrying a cursor-agent card.
pub(all) struct SendToUserCursorAgent {
  turn_id : String
  send_type : SendToUserType
  card : CursorAgentCard
} derive(Eq, Debug)

///|
pub extend SendToUserCursorAgent with Eq::{equal, not_equal}

///|
pub extend SendToUserCursorAgent with Debug::{to_repr}

///|
/// Given bcId When SendToUser type=cursor-agent Then card is issued.
pub fn send_to_user_cursor_agent(
  turn_id~ : String,
  bc_id~ : String,
) -> Result[SendToUserCursorAgent, String] {
  match issue_cursor_agent_card(bc_id) {
    Err(e) => Err(e)
    Ok(card) => Ok({ turn_id, send_type: CursorAgent, card, })
  }
}

///|
/// Open the cloud agent from the card (Host would navigate; kernel-contract records open).
pub fn CursorAgentCard::open_cloud_agent(
  self : CursorAgentCard,
) -> Result[String, String] {
  if !self.can_open_cloud() {
    return Err("cannot open cloud agent: missing bcId or url")
  }
  self.opened = true
  Ok(self.url)
}

///|
pub fn SendToUserCursorAgent::open_cloud(
  self : SendToUserCursorAgent,
) -> Result[String, String] {
  if !(self.send_type is CursorAgent) {
    return Err("SendToUser type is not cursor-agent")
  }
  self.card.open_cloud_agent()
}
