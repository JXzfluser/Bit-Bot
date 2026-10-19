///|
pub(all) enum ChannelKind {
  Chat
  Email
  Slack
  Sms
  Webhook
  Internal
  /// CM-2005: live voice call address voice:<call>
  Voice
  /// CM-1107: Microsoft Teams channel teams:<tenant>/<team>[/<channel>]
  Teams
  /// CN product: 钉钉 dingtalk:<chat|webhook>
  DingTalk
  /// CN product: 飞书 / Lark feishu:<chat_id> (lark: alias)
  Feishu
  /// CN product: 企业微信 wecom:<touser|chatid>
  WeCom
} derive(Eq, Debug)

///|
pub extend ChannelKind with Eq::{not_equal, equal}

///|
pub extend ChannelKind with Debug::{to_repr}

///|
pub(all) struct ChannelId {
  kind : ChannelKind
  id : String
} derive(Eq, Debug)

///|
pub extend ChannelId with Eq::{not_equal, equal}

///|
pub extend ChannelId with Debug::{to_repr}

///|
pub fn ChannelId::render(self : ChannelId) -> String {
  let k = match self.kind {
    Chat => "chat"
    Email => "email"
    Slack => "slack"
    Sms => "sms"
    Webhook => "webhook"
    Internal => "internal"
    Voice => "voice"
    Teams => "teams"
    DingTalk => "dingtalk"
    Feishu => "feishu"
    WeCom => "wecom"
  }
  k + ":" + self.id
}

///|
pub(all) struct InboundMessage {
  channel : ChannelId
  message_id : String
  sender : String
  body : String
  received_at_ms : Int64
  thread_id : String?
} derive(Eq, Debug)

///|
pub extend InboundMessage with Eq::{not_equal, equal}

///|
pub extend InboundMessage with Debug::{to_repr}
