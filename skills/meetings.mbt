///|
/// CM-2153: meetings / live meeting chat skill — may allow non-draft-card outbound
/// when skill explicitly permits (pairs with channels/live_meeting_chat).

///|
pub fn meetings_skill_name() -> String {
  "meetings"
}

///|
pub fn meetings_skill_md() -> String {
  "# meetings\n\nLive meeting chat may send non-draft-card when this skill allows direct send.\nDefault remains draft card for ordinary channels.\n"
}

///|
/// Whether the meetings skill grants live-meeting-chat direct send for this turn.
pub fn meetings_skill_allows_live_chat_direct_send(
  skill_loaded~ : Bool,
  explicit_allow_direct~ : Bool,
) -> Bool {
  skill_loaded && explicit_allow_direct
}

///|
/// Build a channels LiveMeetingChatContext from skill gate + body.
pub fn plan_meetings_live_chat_outbound(
  skill_loaded~ : Bool,
  explicit_allow_direct~ : Bool,
  is_live_meeting_chat~ : Bool,
  body~ : String,
) -> Result[@channels.OutboundSendMode, String] {
  let allow = meetings_skill_allows_live_chat_direct_send(
    skill_loaded~,
    explicit_allow_direct~,
  )
  @channels.plan_live_meeting_chat_outbound(
    {
      is_live_meeting_chat,
      skill_allows_direct_send: allow,
      body,
    },
  )
}
