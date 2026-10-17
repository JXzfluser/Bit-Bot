///|
/// CM-1102: Slack delivery target — thread / DM / top-level channel.
pub(all) enum SlackTargetKind {
  Thread
  Dm
  TopLevel
} derive(Eq, Debug)

///|
pub extend SlackTargetKind with Eq::{equal, not_equal}

///|
pub extend SlackTargetKind with Debug::{to_repr}

///|
/// Classify Slack id: U/D → DM; `:ts` present → Thread; else TopLevel (C…).
pub fn classify_slack_target(
  channel_id : String,
  thread_ts : String?,
) -> SlackTargetKind {
  match thread_ts {
    Some(_) => Thread
    None =>
      if channel_id.length() > 0 {
        let c = channel_id[0]
        if c == 'U' || c == 'D' {
          Dm
        } else {
          TopLevel
        }
      } else {
        TopLevel
      }
  }
}

///|
pub fn ChannelAddress::slack_target(self : ChannelAddress) -> SlackTargetKind? {
  match self.kind {
    Slack => Some(classify_slack_target(self.channel_id, self.thread_ts))
    Chat | Email | Sms | Webhook | Internal | Voice | Teams => None
  }
}

///|
pub fn ChannelAddress::is_dm(self : ChannelAddress) -> Bool {
  match self.slack_target() {
    Some(Dm) => true
    _ => false
  }
}

///|
pub fn ChannelAddress::is_thread(self : ChannelAddress) -> Bool {
  match self.slack_target() {
    Some(Thread) => true
    _ => false
  }
}

///|
pub fn ChannelAddress::is_toplevel(self : ChannelAddress) -> Bool {
  match self.slack_target() {
    Some(TopLevel) => true
    _ => false
  }
}

///|
/// CM-1101: None / chat / internal → not external; slack/email/sms/webhook → external.
pub fn is_external_hint(hint : String?) -> Bool {
  match hint {
    None => false
    Some(h) => {
      let addr = parse_channel_address(h)
      match addr.kind {
        Chat | Internal => false
        Slack | Email | Sms | Webhook | Voice | Teams => true
      }
    }
  }
}

///|
/// Destination kind when channel_hint is omitted → always Chat (in-chat).
pub fn destination_kind_for_hint(hint : String?) -> ChannelKind {
  match hint {
    None => Chat
    Some(h) => parse_channel_address(h).kind
  }
}

///|
/// Helper for acceptance: omitting channel must not route off-site.
pub fn assert_not_external(channel_hint : String?) -> Result[Unit, String] {
  if is_external_hint(channel_hint) {
    Err("channel_hint routes external; expected in-chat")
  } else {
    Ok(())
  }
}
