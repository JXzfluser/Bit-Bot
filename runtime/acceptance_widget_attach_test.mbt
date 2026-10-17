///|
/// CM-0105 / CM-0106: widget + attachment in the same SendEnvelope must be rejected.
test "acceptance_CM-0105_CM-0106_widget_attachment_same_envelope_rejected" {
  let env = @ui_protocol.SendEnvelope::{
    turn_id: "t-mix",
    parts: [
      @ui_protocol.Widget(widget_id="w1", payload_json="{}"),
      @ui_protocol.Attachment(
        name="a.png",
        mime="image/png",
        path="/workspace/a.png",
      ),
    ],
    channel_hint: None,
  }
  match @ui_protocol.validate_envelope_no_widget_attachment(env) {
    Err(msg) =>
      assert_true(msg.contains("widget") || msg.contains("attachment"))
    Ok(_) => fail("widget+attachment must be rejected")
  }
  // Widget-only and attachment-only remain valid shapes.
  let widget_only = @ui_protocol.SendEnvelope::{
    turn_id: "t-w",
    parts: [@ui_protocol.Widget(widget_id="w1", payload_json="{}")],
    channel_hint: None,
  }
  assert_true(
    @ui_protocol.validate_envelope_no_widget_attachment(widget_only) is Ok(_),
  )
  let att_only = @ui_protocol.SendEnvelope::{
    turn_id: "t-a",
    parts: [
      @ui_protocol.Attachment(
        name="a.png",
        mime="image/png",
        path="/workspace/a.png",
      ),
    ],
    channel_hint: None,
  }
  assert_true(
    @ui_protocol.validate_envelope_no_widget_attachment(att_only) is Ok(_),
  )
}

///|
/// CM-0106: attachment path containing '..' / scheme must be rejected.
test "acceptance_CM-0106_attachment_path_rejected" {
  assert_true(@ui_protocol.validate_path("/workspace/../etc/passwd") is Err(_))
  assert_true(@ui_protocol.validate_path("http://evil/a") is Err(_))
  let t0 = @runtime.open_turn(turn_id="acc-att", text="file")
  match
    t0.deliver_attachment(
      name="evil",
      mime="text/plain",
      path="/workspace/../etc/passwd",
    ) {
    Err(_) => ()
    Ok(_) => fail("dotdot path must be rejected")
  }
}

///|
/// CM-0111: bare http(s) URL fails; markdown-linked URL ok (ui_protocol + deliver).
test "acceptance_CM-0111_bare_url_fails_linked_ok" {
  assert_true(
    @ui_protocol.ensure_markdown_links("see https://example.com/docs") is Err(_),
  )
  assert_true(
    @ui_protocol.ensure_markdown_links(
      "read [docs](https://example.com/docs) please",
    )
    is Ok(_),
  )
  let t0 = @runtime.open_turn(turn_id="acc-md-bare", text="x")
  match t0.deliver_text(body="see https://example.com/docs") {
    Err(msg) =>
      assert_true(
        msg.contains("URL") || msg.contains("url") || msg.contains("markdown"),
      )
    Ok(_) => fail("bare URL must fail deliver_text")
  }
  match t0.deliver_text(body="read [docs](https://example.com/docs) please") {
    Ok(t1) => {
      assert_eq(t1.outbound.length(), 1)
      assert_eq(t1.phase, @runtime.Working)
    }
    Err(e) => fail(e)
  }
}
