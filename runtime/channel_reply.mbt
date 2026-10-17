///|
/// CM-0109: when inbound carries a thread address, outbound channel_hint mirrors it.
pub fn TurnContext::deliver_text_to_inbound(
  self : TurnContext,
  body~ : String,
  inbound_address~ : String,
) -> Result[TurnContext, String] {
  let addr = @channels.parse_channel_address(inbound_address)
  self.deliver_text(body~, channel_hint=Some(addr.reply_hint()))
}

///|
/// CM-0108: reply using inbound address when present; omit channel → in-app only.
pub fn TurnContext::reply_to_channel_target(
  self : TurnContext,
  body~ : String,
  inbound_address~ : String?,
) -> Result[TurnContext, String] {
  match inbound_address {
    None =>
      // Omit channel → stay in-app chat (not external).
      match self.deliver_text(body~, channel_hint=None) {
        Err(e) => Err(e)
        Ok(t) => {
          guard !@channels.is_external_hint(None) else {
            Err("omit channel must not be external")
          }
          Ok(t)
        }
      }
    Some(addr) =>
      match
        @channels.plan_channel_reply(
          inbound_address=Some(addr),
          outbound_channel=Some(
            @channels.parse_channel_address(addr).reply_hint(),
          ),
          body~,
        ) {
        Err(e) => Err(e)
        Ok(delivery) =>
          match delivery {
            @channels.External(channel~) =>
              self.deliver_text(body~, channel_hint=Some(channel))
            @channels.InAppOnly => self.deliver_text(body~, channel_hint=None)
          }
      }
  }
}
