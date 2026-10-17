///|
/// CM-1101: omitting channel_hint must stay in-chat — no Slack/email off-site.
test "acceptance_CM-1101_omit_channel_stays_in_chat" {
  assert_false(@channels.is_external_hint(None))
  assert_eq(@channels.destination_kind_for_hint(None), @channels.Chat)
  match @channels.assert_not_external(None) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  // Explicit external addresses are off-site.
  assert_true(@channels.is_external_hint(Some("slack:C123")))
  assert_true(@channels.is_external_hint(Some("email:a@b.com")))
  assert_false(@channels.is_external_hint(Some("session-local")))
  match @channels.assert_not_external(Some("slack:C1")) {
    Err(_) => ()
    Ok(_) => fail("slack hint must be external")
  }
}

///|
/// CM-1102: slack:C:ts → thread; slack:U / slack:D → DM; bare slack:C → toplevel.
test "acceptance_CM-1102_slack_thread_dm_toplevel" {
  let thread = @channels.parse_channel_address("slack:C123:1234.56")
  assert_eq(thread.channel_id, "C123")
  assert_eq(thread.thread_ts, Some("1234.56"))
  assert_true(thread.is_thread())
  assert_false(thread.is_dm())
  assert_false(thread.is_toplevel())
  assert_eq(thread.slack_target(), Some(@channels.Thread))

  let dm_u = @channels.parse_channel_address("slack:U456")
  assert_eq(dm_u.channel_id, "U456")
  assert_eq(dm_u.thread_ts, None)
  assert_true(dm_u.is_dm())
  assert_false(dm_u.is_thread())
  assert_false(dm_u.is_toplevel())
  assert_eq(dm_u.slack_target(), Some(@channels.Dm))

  let dm_d = @channels.parse_channel_address("slack:D789")
  assert_true(dm_d.is_dm())
  assert_eq(dm_d.slack_target(), Some(@channels.Dm))

  let top = @channels.parse_channel_address("slack:C123")
  assert_eq(top.channel_id, "C123")
  assert_eq(top.thread_ts, None)
  assert_true(top.is_toplevel())
  assert_false(top.is_dm())
  assert_false(top.is_thread())
  assert_eq(top.slack_target(), Some(@channels.TopLevel))
}

///|
/// CM-1104: external channel delivery degrades Widget → Text/link; no bare Widget.
test "acceptance_CM-1104_channel_degrades_no_bare_widget" {
  let env = @ui_protocol.SendEnvelope::{
    turn_id: "t-ch",
    parts: [
      @ui_protocol.Text(body="hello"),
      @ui_protocol.Widget(widget_id="w1", payload_json="{\"prompt\":\"pick\"}"),
    ],
    channel_hint: (None : String?),
  }
  assert_true(@channels.has_bare_widget(env.parts))
  let addr = @channels.parse_channel_address("slack:C123")
  let out = @channels.deliver_for_channel(env, addr)
  assert_false(@channels.has_bare_widget(out.parts))
  assert_eq(out.channel_hint, Some("slack:C123"))
  assert_eq(out.parts.length(), 2)
  match out.parts[1] {
    @ui_protocol.Text(body~) => {
      assert_true(body.contains("widget"))
      assert_true(body.contains("w1") || body.contains("link"))
    }
    _ => fail("widget must degrade to Text")
  }
  // Chat may still use widgets.
  let chat_addr = @channels.parse_channel_address("local-chat")
  let chat_out = @channels.deliver_for_channel(env, chat_addr)
  assert_true(@channels.has_bare_widget(chat_out.parts))
  assert_eq(chat_out.channel_hint, None)
}
