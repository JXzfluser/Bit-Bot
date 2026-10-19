///|
/// CM-0105 / CM-0106: widget must not share a SendEnvelope with attachment.
test "acceptance_CM-0105_CM-0106_envelope_rejects_widget_plus_attachment" {
  let bad = @ui_protocol.SendEnvelope::{
    turn_id: "t1",
    parts: [
      @ui_protocol.Widget(widget_id="w1", payload_json="{}"),
      @ui_protocol.Attachment(
        name="a.txt",
        mime="text/plain",
        path="/workspace/a.txt",
      ),
    ],
    channel_hint: (None : String?),
  }
  assert_true(
    @ui_protocol.validate_envelope_no_widget_attachment(bad) is Err(_),
  )
  let good_widget = @ui_protocol.SendEnvelope::{
    turn_id: "t2",
    parts: [
      @ui_protocol.Text(body="hi"),
      @ui_protocol.Widget(widget_id="w1", payload_json="{}"),
    ],
    channel_hint: (None : String?),
  }
  assert_true(
    @ui_protocol.validate_envelope_no_widget_attachment(good_widget) is Ok(_),
  )
}

///|
/// CM-0111: bare URL fails; linked URL ok.
test "acceptance_CM-0111_markdown_bare_url_fails_linked_ok" {
  assert_true(
    @ui_protocol.ensure_markdown_links("see https://example.com/docs") is Err(_),
  )
  assert_true(
    @ui_protocol.ensure_markdown_links("see http://example.com") is Err(_),
  )
  assert_true(
    @ui_protocol.ensure_markdown_links(
      "read [docs](https://example.com/docs) please",
    )
    is Ok(_),
  )
  assert_true(
    @ui_protocol.ensure_markdown_links(
      "linked [ok](https://ok.test) but also https://bare.test",
    )
    is Err(_),
  )
}

///|
/// CM-0105: interactive WidgetSpec (1–6 opts, multi_select/allow_custom) +
/// submit choice becomes user message payload; Widget+Attachment rejected.
test "acceptance_CM-0105_widget_card_and_choice_user_message" {
  let spec = @ui_protocol.WidgetSpec::{
    prompt: "选择下一步",
    options: [
      { label: "继续", value: "cont", style: @ui_protocol.Primary, },
      { label: "取消", value: "cancel", style: @ui_protocol.Danger, },
    ],
    multi_select: true,
    allow_custom: true,
    dismiss_on_move_on: false,
  }
  assert_true(spec.validate() is Ok(_))
  assert_eq(spec.multi_select, true)
  assert_eq(spec.allow_custom, true)
  assert_true(spec.options.length() >= 1 && spec.options.length() <= 6)

  let too_few = @ui_protocol.WidgetSpec::{
    prompt: "x",
    options: [],
    multi_select: false,
    allow_custom: false,
    dismiss_on_move_on: false,
  }
  assert_true(too_few.validate() is Err(_))

  let choice = @ui_protocol.WidgetChoice::{
    widget_id: "w-decide",
    selected_values: ["cont"],
    custom_text: Some("顺便说明一下"),
  }
  let payload = choice.as_user_message_payload()
  assert_true(payload.contains("widget:w-decide:"))
  assert_true(payload.contains("cont"))
  assert_true(payload.contains("顺便说明一下"))

  let mixed = @ui_protocol.SendEnvelope::{
    turn_id: "t-mix",
    parts: [
      @ui_protocol.Widget(widget_id="w1", payload_json="{}"),
      @ui_protocol.Attachment(
        name="a.txt",
        mime="text/plain",
        path="/workspace/a.txt",
      ),
    ],
    channel_hint: (None : String?),
  }
  assert_true(
    @ui_protocol.validate_envelope_no_widget_attachment(mixed) is Err(_),
  )
}

///|
/// CM-0106: path present in mock FS is deliverable Ok; hallucinated path rejected.
test "acceptance_CM-0106_mock_fs_exists_ok_hallucinated_rejected" {
  let fs = @ui_protocol.MockFS::new([
    "/workspace/out/report.pdf", "/home/box/agent-data/shot.png",
  ])
  match
    @ui_protocol.deliverable_attachment(
      fs, "report.pdf", "application/pdf", "/workspace/out/report.pdf",
    ) {
    Ok(ref_) => {
      assert_eq(ref_.path, "/workspace/out/report.pdf")
      assert_eq(ref_.name, "report.pdf")
    }
    Err(e) => fail(e)
  }
  // Shape-valid /workspace path but NOT in mock FS → hallucinated.
  match
    @ui_protocol.deliverable_attachment(
      fs, "ghost.bin", "application/octet-stream", "/workspace/out/ghost-not-real.bin",
    ) {
    Err(msg) =>
      assert_true(msg.contains("hallucinated") || msg.contains("exist"))
    Ok(_) => fail("hallucinated path must be rejected")
  }
  assert_true(@ui_protocol.validate_path("/workspace/../etc/passwd") is Err(_))
  assert_true(@ui_protocol.validate_path("") is Err(_))
  assert_true(@ui_protocol.validate_path("s3://bucket/x") is Err(_))
}

///|
/// CM-0111: bare https fails; markdown link ok; inventing unknown UI/deeplink rejected.
test "acceptance_CM-0111_reject_unknown_deeplink_and_bare_url" {
  assert_true(
    @ui_protocol.ensure_markdown_links("see https://example.com/docs") is Err(_),
  )
  assert_true(
    @ui_protocol.ensure_markdown_links(
      "read [docs](https://example.com/docs) please",
    )
    is Ok(_),
  )
  let linked = @ui_protocol.linkify_bare_http_urls(
    "nav https://calendar.example.com/create ok",
  )
  assert_true(linked.contains("[https://calendar.example.com/create]("))
  assert_true(@ui_protocol.ensure_markdown_links(linked) is Ok(_))
  let already =
    @ui_protocol.linkify_bare_http_urls("see [docs](https://example.com/a)")
  assert_eq(already, "see [docs](https://example.com/a)")
  assert_true(
    @ui_protocol.validate_deeplink_or_reject("grokbot://settings") is Ok(_),
  )
  assert_true(
    @ui_protocol.validate_deeplink_or_reject("grokbot://invented-panel-xyz")
    is Err(_),
  )
  assert_true(
    @ui_protocol.validate_deeplink_or_reject("grokbot://unknown/anchor")
    is Err(_),
  )
}
