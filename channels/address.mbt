///|
/// Slack-style address: `slack:<channel>:<thread_ts>` or `slack:<channel>` or bare chat.
pub(all) struct ChannelAddress {
  kind : ChannelKind
  channel_id : String
  thread_ts : String?
} derive(Eq, Debug)

///|
pub extend ChannelAddress with Eq::{equal, not_equal}

///|
pub extend ChannelAddress with Debug::{to_repr}

///|
/// CM-0109: parse inbound channel address; thread replies stay in-thread.
pub fn parse_channel_address(raw : String) -> ChannelAddress {
  if raw.has_prefix("slack:") {
    let rest = raw[6:].to_owned()
    match rest.find(":") {
      None => { kind: Slack, channel_id: rest, thread_ts: None, }
      Some(at) => {
        let ch = rest[:at].to_owned()
        let thr = rest[at + 1:].to_owned()
        {
          kind: Slack,
          channel_id: ch,
          thread_ts: if thr.length() > 0 {
            Some(thr)
          } else {
            None
          },
        }
      }
    }
  } else if raw.has_prefix("email:") {
    { kind: Email, channel_id: raw[6:].to_owned(), thread_ts: None, }
  } else if raw.has_prefix("voice:") {
    // CM-2005: voice:<call_id>
    { kind: Voice, channel_id: raw[6:].to_owned(), thread_ts: None, }
  } else if raw.has_prefix("teams:") {
    // CM-1107: teams:<tenant>/<team>[/<channel>]
    { kind: Teams, channel_id: raw[6:].to_owned(), thread_ts: None, }
  } else {
    { kind: Chat, channel_id: raw, thread_ts: None, }
  }
}

///|
pub fn ChannelAddress::reply_hint(self : ChannelAddress) -> String {
  match self.kind {
    Slack =>
      match self.thread_ts {
        Some(ts) => "slack:" + self.channel_id + ":" + ts
        None => "slack:" + self.channel_id
      }
    Email => "email:" + self.channel_id
    Voice => "voice:" + self.channel_id
    Teams => "teams:" + self.channel_id
    Chat | Sms | Webhook | Internal => self.channel_id
  }
}

///|
pub fn ChannelAddress::is_threaded(self : ChannelAddress) -> Bool {
  match self.thread_ts {
    Some(_) => true
    None => false
  }
}
