///|
/// CM-0101: SendToUser text Markdown envelope; first outbound is confirm/clarify
/// with a non-empty Text part (DeliveredMessage).
test "acceptance_CM-0101_send_to_user_text_delivery" {
  let t0 = @runtime.open_turn(
    turn_id="acc-0101",
    text="请帮我处理长任务",
  )
  let t1 = match
    t0.deliver_confirm_then(
      confirm="收到，我先确认一下范围",
      follow_up="已开始处理，稍后汇报进度",
    ) {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(t1.outbound.length(), 2)
  match t1.first_delivered() {
    None => fail("first outbound must yield DeliveredMessage")
    Some(dm) => {
      assert_true(dm.text.length() > 0)
      assert_true(@runtime.is_confirm_or_clarify(dm.text))
      assert_eq(dm.turn_id, "acc-0101")
      assert_eq(dm.channel_hint, None)
    }
  }
  // Envelope Text part present on both outbound messages.
  assert_eq(t1.outbound[0].parts[0].label(), "text")
  assert_eq(t1.outbound[1].parts[0].label(), "text")
  match @runtime.envelope_text_body(t1.outbound[0]) {
    Some(b) => assert_true(b.length() > 0)
    None => fail("SendEnvelope must have Text part")
  }
  // Markdown-linked follow-up still valid via deliver_text path.
  let t2 = match
    t1.deliver_text(body="详见 [文档](https://example.com/docs)") {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(t2.outbound.length(), 3)
  assert_eq(t2.outbound[2].parts[0].label(), "text")
}
