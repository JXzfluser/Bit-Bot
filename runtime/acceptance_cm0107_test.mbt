///|
/// CM-0107: SendToUser voice_memo=true — spoken complete sentences, no markdown
/// lists; silent until first memo.
test "acceptance_CM-0107_voice_memo_spoken_sentences" {
  let t0 = @runtime.open_turn(turn_id="acc-0107", text="summarize the plan")
  // Silent until first voice memo.
  assert_true(t0.is_silent_before_voice_memo())
  assert_eq(t0.outbound.length(), 0)
  assert_eq(t0.voice_memo_count(), 0)

  // Markdown list body must be rejected.
  match t0.deliver_voice_memo(spoken_text="- step one\n- step two") {
    Err(msg) => assert_true(msg.contains("spoken") || msg.contains("markdown"))
    Ok(_) => fail("markdown list must not be accepted as voice_memo")
  }
  assert_true(t0.is_silent_before_voice_memo())

  // Numbered list rejected.
  match t0.deliver_voice_memo(spoken_text="1. first\n2. second") {
    Err(_) => ()
    Ok(_) => fail("numbered list must be rejected")
  }

  // Spoken complete sentences OK.
  let (t1, delivery) = match
    t0.deliver_voice_memo(
      spoken_text="I finished the first milestone. Next I will review the tests.",
    ) {
    Ok(pair) => pair
    Err(e) => fail(e)
  }
  assert_true(delivery.voice_memo)
  assert_eq(delivery.turn_id, "acc-0107")
  assert_true(@runtime.is_spoken_sentence_style(delivery.spoken_text))
  assert_eq(t1.voice_memo_count(), 1)
  assert_eq(t1.outbound.length(), 1)
  assert_eq(t1.outbound[0].parts[0].label(), "voice")
  assert_false(t1.is_silent_before_voice_memo())
}
