///|
/// CM-1101: omitting channel must NOT deliver externally.
test "acceptance_CM-1101_omit_channel_not_external" {
  let inbound = Some("slack:C0123ABCDEF:1710000.000100")
  match
    @channels.plan_channel_reply(
      inbound_address=inbound,
      outbound_channel=None,
      body="hello",
    ) {
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
      body="hello",
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
test "acceptance_CM-1102_slack_address_thread_dm_top" {
  match @channels.parse_slack_address("slack:C0123ABCDEF:1710000.000100") {
    Ok(a) => {
      assert_eq(a.slack_target(), Some(@channels.Thread))
      assert_true(a.is_thread())
      assert_eq(a.channel_id, "C0123ABCDEF")
      assert_eq(a.thread_ts, Some("1710000.000100"))
    }
    Err(e) => fail(e)
  }
  match @channels.parse_slack_address("slack:U0ABCDEF") {
    Ok(a) => {
      assert_eq(a.slack_target(), Some(@channels.Dm))
      assert_true(a.is_dm())
      assert_eq(a.channel_id, "U0ABCDEF")
    }
    Err(e) => fail(e)
  }
  match @channels.parse_slack_address("slack:D0XYZ123") {
    Ok(a) => {
      assert_eq(a.slack_target(), Some(@channels.Dm))
      assert_true(a.is_dm())
    }
    Err(e) => fail(e)
  }
  match @channels.parse_slack_address("slack:C999TOP") {
    Ok(a) => {
      assert_eq(a.slack_target(), Some(@channels.TopLevel))
      assert_true(a.is_toplevel())
    }
    Err(e) => fail(e)
  }
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
