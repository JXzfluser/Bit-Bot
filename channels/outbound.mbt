///|
/// CM-1101: outcome of planning an outbound reply relative to inbound channel.
pub(all) enum ChannelDelivery {
  External(channel~ : String)
  InAppOnly
} derive(Eq, Debug)

///|
pub extend ChannelDelivery with Eq::{equal, not_equal}

///|
pub extend ChannelDelivery with Debug::{to_repr}

///|
pub fn ChannelDelivery::is_external(self : ChannelDelivery) -> Bool {
  match self {
    External(_) => true
    InAppOnly => false
  }
}

///|
/// CM-1101: if inbound carried an external channel, reply MUST use the same
/// channel for external delivery. Omitting channel must NOT deliver externally
/// (stays InAppOnly). Mismatched channel → Err.
/// 这里只决定"投到哪里"，不看正文——正文由调用方自己带进信封。早期版本带一个
/// `body` 参数却从不使用，会让调用方误以为这里做过正文校验，已移除。
pub fn plan_channel_reply(
  inbound_address~ : String?,
  outbound_channel~ : String?,
) -> Result[ChannelDelivery, String] {
  match inbound_address {
    None =>
      // No inbound channel: outbound channel optional; None stays in-app.
      match outbound_channel {
        None => Ok(InAppOnly)
        Some(ch) => Ok(External(channel=ch))
      }
    Some(inbound) => {
      let parsed = parse_channel_address(inbound)
      let inbound_is_external = match parsed.kind {
        Slack
        | Email
        | Sms
        | Webhook
        | Voice
        | Teams
        | DingTalk
        | Feishu
        | WeCom => true
        Chat | Internal => false
      }
      if !inbound_is_external {
        match outbound_channel {
          None => Ok(InAppOnly)
          Some(ch) => Ok(External(channel=ch))
        }
      } else {
        match outbound_channel {
          None =>
            // Omit channel → must NOT deliver externally.
            Ok(InAppOnly)
          Some(ch) => {
            let expected = parsed.reply_hint()
            if ch == expected || ch == inbound {
              Ok(External(channel=expected))
            } else {
              Err(
                "reply must use same inbound channel; got " +
                ch +
                " expected " +
                expected,
              )
            }
          }
        }
      }
    }
  }
}

///|
/// Force-external without channel is always refused.
pub fn require_external_channel(
  outbound_channel~ : String?,
) -> Result[String, String] {
  match outbound_channel {
    Some(ch) =>
      if ch.length() == 0 {
        Err("omit channel must not deliver externally")
      } else {
        Ok(ch)
      }
    None => Err("omit channel must not deliver externally")
  }
}
