///|
/// CM-1101: omitting channel must NOT deliver externally.
test "acceptance_CM-1101_omit_channel_not_external" {
  let inbound = Some("slack:C0123ABCDEF:1710000.000100")
  match
    @channels.plan_channel_reply(inbound_address=inbound, outbound_channel=None) {
    Ok(d) => {
      assert_false(d.is_external())
      assert_eq(d, @channels.InAppOnly)
    }
    Err(e) => fail(e)
  }
  // Same channel → external ok.
  match
    @channels.plan_channel_reply(
      inbound_address=inbound,
      outbound_channel=Some("slack:C0123ABCDEF:1710000.000100"),
    ) {
    Ok(d) => assert_true(d.is_external())
    Err(e) => fail(e)
  }
  match @channels.require_external_channel(outbound_channel=None) {
    Err(m) => assert_true(m.contains("omit") || m.contains("externally"))
    Ok(_) => fail("omit channel must not deliver externally")
  }
  // MoonBit核 helper: None hint is not external.
  assert_false(@channels.is_external_hint(None))
}

///|
/// CM-1102: slack:C:ts / slack:U / slack:D — thread / DM / top-level.
/// 这里直接用 `parse_channel_address` + `slack_target` 判定语义：`parse_slack_address`
/// 那层只是重复校验 "slack:" 前缀和 DM id 形状，没人调用，已作为死代码删除。
test "acceptance_CM-1102_slack_address_thread_dm_top" {
  let thread = @channels.parse_channel_address(
    "slack:C0123ABCDEF:1710000.000100",
  )
  assert_eq(thread.slack_target(), Some(@channels.Thread))
  assert_true(thread.is_thread())
  assert_eq(thread.channel_id, "C0123ABCDEF")
  assert_eq(thread.thread_ts, Some("1710000.000100"))
  let dm_u = @channels.parse_channel_address("slack:U0ABCDEF")
  assert_eq(dm_u.slack_target(), Some(@channels.Dm))
  assert_true(dm_u.is_dm())
  assert_eq(dm_u.channel_id, "U0ABCDEF")
  let dm_d = @channels.parse_channel_address("slack:D0XYZ123")
  assert_eq(dm_d.slack_target(), Some(@channels.Dm))
  assert_true(dm_d.is_dm())
  let top = @channels.parse_channel_address("slack:C999TOP")
  assert_eq(top.slack_target(), Some(@channels.TopLevel))
  assert_true(top.is_toplevel())
}

///|
/// CM-1104: channel target degrades widget → text; naked widget forbidden.
test "acceptance_CM-1104_channel_degrades_widget" {
  let env = @ui_protocol.SendEnvelope::{
    turn_id: "t-ch-degrade",
    parts: [
      @ui_protocol.Text(body="hi"),
      @ui_protocol.Widget(widget_id="w1", payload_json="{\"prompt\":\"pick\"}"),
    ],
    channel_hint: (None : String?),
  }
  assert_true(@channels.has_bare_widget(env.parts))
  match
    @channels.reject_naked_widget_on_channel(env.parts, channel_target=true) {
    Err(m) => assert_true(m.contains("naked") || m.contains("forbidden"))
    Ok(_) => fail("naked widget must be forbidden on channel")
  }
  let addr = @channels.parse_channel_address("slack:C123")
  let out = @channels.deliver_for_channel(env, addr)
  assert_false(@channels.has_bare_widget(out.parts))
  assert_eq(out.channel_hint, Some("slack:C123"))
  match out.parts[1] {
    @ui_protocol.Text(body~) => {
      assert_true(body.contains("widget"))
      assert_true(body.contains("w1") || body.contains("link"))
    }
    _ => fail("widget must degrade to Text")
  }
  match
    @channels.reject_naked_widget_on_channel(out.parts, channel_target=true) {
    Ok(_) => ()
    Err(e) => fail("degraded parts must pass: " + e)
  }
}
