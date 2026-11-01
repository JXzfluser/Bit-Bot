///|
/// CM-1103: Personal Slack bot — only DMs the owner; shared-channel politely refused.
pub(all) enum PersonalSlackSendResult {
  SentDm(owner_id~ : String, text~ : String)
  RefusedSharedChannel(hint~ : String)
} derive(Eq, Debug)

///|
pub extend PersonalSlackSendResult with Eq::{equal, not_equal}

///|
pub extend PersonalSlackSendResult with Debug::{to_repr}

///|
pub fn PersonalSlackSendResult::is_sent(self : PersonalSlackSendResult) -> Bool {
  match self {
    SentDm(_) => true
    RefusedSharedChannel(_) => false
  }
}

///|
pub fn PersonalSlackSendResult::is_polite_refuse(
  self : PersonalSlackSendResult,
) -> Bool {
  match self {
    RefusedSharedChannel(hint~) => {
      let h = hint
      (h.contains("share") || h.contains("Share")) &&
      (h.contains("owner") || h.contains("DM") || h.contains("personal"))
    }
    SentDm(_) => false
  }
}

///|
pub fn PersonalSlackSendResult::refuse_hint(
  self : PersonalSlackSendResult,
) -> String? {
  match self {
    RefusedSharedChannel(hint~) => Some(hint)
    SentDm(_) => None
  }
}

///|
pub(all) struct PersonalSlackBot {
  owner_user_id : String
}

///|
pub fn PersonalSlackBot::new(owner_user_id~ : String) -> PersonalSlackBot {
  { owner_user_id, }
}

///|
/// Share hint when refusing a shared-channel request.
pub fn PersonalSlackBot::share_hint(self : PersonalSlackBot) -> String {
  let _ = self
  "This personal bot only DMs its owner. Please share the reply in the channel yourself."
}

///|
/// Attempt outbound: owner DM ok; shared channel politely refused + share hint.
pub fn PersonalSlackBot::try_send(
  self : PersonalSlackBot,
  target : ChannelAddress,
  text~ : String,
) -> PersonalSlackSendResult {
  match target.kind {
    Slack =>
      match target.slack_target() {
        Some(Dm) =>
          if target.channel_id == self.owner_user_id {
            SentDm(owner_id=self.owner_user_id, text~)
          } else {
            RefusedSharedChannel(hint=self.share_hint())
          }
        Some(TopLevel) | Some(Thread) | None =>
          RefusedSharedChannel(hint=self.share_hint())
      }
    Chat
    | Email
    | Sms
    | Webhook
    | Internal
    | Voice
    | Teams
    | DingTalk
    | Feishu
    | WeCom => RefusedSharedChannel(hint=self.share_hint())
  }
}

///|
pub fn PersonalSlackBot::owner_dm_address(self : PersonalSlackBot) -> String {
  "slack:" + self.owner_user_id
}
