///|
/// CM-0108: with inbound channel address, reply lands on same address;
/// omitting channel stays in-app chat (not external).
/// 这条断言现在按生产实际的组合方式写：`channels` 负责把 inbound 地址解析成投递
/// hint，`runtime` 只负责把文本挂进 outbound 信封。此前 runtime 里另有一层
/// `TurnContext::reply_to_channel_target` / `deliver_text_to_inbound` 便利封装，
/// 它没有任何生产调用者（真正的渠道规划在 cmd/desktop_turn 层），却让内核反向
/// 依赖 channels 适配层，已随本次瘦身删除。
test "acceptance_CM-0108_channel_target_inbound_reply" {
  let inbound = "slack:C0123ABCDEF"
  let t0 = @runtime.open_turn(turn_id="acc-0108", text="hi from slack")
  // Reply to inbound → same address.
  let hint = @channels.parse_channel_address(inbound).reply_hint()
  let t1 = match t0.deliver_text(body="回原频道", channel_hint=Some(hint)) {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(t1.outbound.length(), 1)
  assert_eq(t1.outbound[0].channel_hint, Some("slack:C0123ABCDEF"))
  assert_true(@channels.is_external_hint(t1.outbound[0].channel_hint))
  // Omit channel → in-app only, not external.
  let t3 = match t0.deliver_text(body="仅应用内", channel_hint=None) {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(t3.outbound[0].channel_hint, None)
  assert_false(@channels.is_external_hint(None))
  assert_false(@channels.is_external_hint(t3.outbound[0].channel_hint))
  match @channels.assert_not_external(t3.outbound[0].channel_hint) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
}
