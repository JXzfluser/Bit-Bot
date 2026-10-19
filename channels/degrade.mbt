///|
fn part_is_widget(part : @ui_protocol.MessageKind) -> Bool {
  match part {
    @ui_protocol.Widget(_) => true
    _ => false
  }
}

///|
/// CM-1104: convert Widget parts to Text with a link/summary — no bare Widget outbound.
pub fn degrade_for_channel(
  parts : Array[@ui_protocol.MessageKind],
) -> Array[@ui_protocol.MessageKind] {
  let out : Array[@ui_protocol.MessageKind] = []
  for p in parts {
    match p {
      @ui_protocol.Widget(widget_id~, payload_json~) => {
        let summary = "[widget degraded] id=" +
          widget_id +
          " link=https://cursor.com/widgets/" +
          widget_id +
          " payload=" +
          payload_json
        out.push(@ui_protocol.Text(body=summary))
      }
      other => out.push(other)
    }
  }
  out
}

///|
pub fn has_bare_widget(parts : Array[@ui_protocol.MessageKind]) -> Bool {
  for p in parts {
    if part_is_widget(p) {
      break true
    }
  } nobreak {
    false
  }
}

///|
/// Deliver envelope to a channel address: external channels degrade widgets.
pub fn deliver_for_channel(
  env : @ui_protocol.SendEnvelope,
  address : ChannelAddress,
) -> @ui_protocol.SendEnvelope {
  match address.kind {
    Chat | Internal =>
      { turn_id: env.turn_id, parts: env.parts, channel_hint: None, }
    Slack | Email | Sms | Webhook | Voice | Teams | DingTalk | Feishu | WeCom =>
      {
        turn_id: env.turn_id,
        parts: degrade_for_channel(env.parts),
        channel_hint: Some(address.reply_hint()),
      }
  }
}

///|
/// CM-1104: naked (undegraded) widget on a channel target is forbidden.
pub fn reject_naked_widget_on_channel(
  parts : Array[@ui_protocol.MessageKind],
  channel_target~ : Bool,
) -> Result[Unit, String] {
  if channel_target && has_bare_widget(parts) {
    Err("naked widget forbidden on channel target")
  } else {
    Ok(())
  }
}
