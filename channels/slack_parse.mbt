///|
/// CM-1102: parse SlackAddress forms `slack:C:ts` / `slack:U` / `slack:D`.
/// Returns ChannelAddress + classified SlackTargetKind.
pub fn parse_slack_address(raw : String) -> Result[ChannelAddress, String] {
  if !raw.has_prefix("slack:") {
    return Err("not a slack address")
  }
  let addr = parse_channel_address(raw)
  match addr.slack_target() {
    None => Err("not classified as slack target")
    Some(Thread) =>
      match addr.thread_ts {
        None => Err("thread requires ts")
        Some(_) => Ok(addr)
      }
    Some(Dm) =>
      if addr.channel_id.has_prefix("U") || addr.channel_id.has_prefix("D") {
        Ok(addr)
      } else {
        Err("DM requires U or D id")
      }
    Some(TopLevel) => Ok(addr)
  }
}
