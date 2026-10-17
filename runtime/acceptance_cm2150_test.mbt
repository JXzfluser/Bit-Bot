///|
/// CM-2150: ReadTranscript — own/child/other assistant traces include tool calls.
test "acceptance_CM-2150_read_transcript_includes_tool_calls" {
  let store = @runtime.TranscriptStore::new()
  store.record_text(@runtime.Own, agent_id="main", text="planning")
  store.record_tool_call(
    @runtime.Own,
    agent_id="main",
    tool_name="WebSearch",
    args_json="{\"q\":\"moonbit\"}",
    result_snippet="hits=3",
  )
  store.record_tool_call(
    @runtime.Child,
    agent_id="ex-1",
    tool_name="Shell",
    args_json="{\"command\":\"moon test\"}",
    result_snippet="passed",
  )
  store.record_text(@runtime.Child, agent_id="ex-1", text="done")
  store.record_tool_call(
    @runtime.OtherAssistant,
    agent_id="peer-a",
    tool_name="Read",
    args_json="{\"path\":\"/workspace/x\"}",
    result_snippet="ok",
  )
  // Own includes tool calls.
  let own = store.read_transcript(@runtime.Own, agent_id=Some("main"))
  assert_true(own.length() >= 2)
  assert_true(@runtime.transcript_includes_tool_calls(own))
  match
    @runtime.read_transcript_for_audit(store, @runtime.Own, agent_id="main") {
    Err(e) => fail(e)
    Ok(entries) => {
      let mut saw = false
      for e in entries {
        if e.is_tool_call() {
          match e.tool_call {
            Some(tc) => {
              assert_eq(tc.tool_name, "WebSearch")
              saw = true
            }
            None => fail("ToolCall entry must carry tool_call")
          }
        }
      }
      assert_true(saw)
    }
  }
  // Child includes tool calls.
  match
    @runtime.read_transcript_for_audit(store, @runtime.Child, agent_id="ex-1") {
    Err(e) => fail(e)
    Ok(entries) => assert_true(@runtime.transcript_includes_tool_calls(entries))
  }
  // Other assistant includes tool calls.
  match
    @runtime.read_transcript_for_audit(
      store,
      @runtime.OtherAssistant,
      agent_id="peer-a",
    ) {
    Err(e) => fail(e)
    Ok(entries) => {
      assert_true(@runtime.transcript_includes_tool_calls(entries))
      assert_eq(entries[0].scope.label(), "other")
    }
  }
  // Text-only transcript fails audit (no tool calls).
  let emptyish = @runtime.TranscriptStore::new()
  emptyish.record_text(@runtime.Own, agent_id="solo", text="hi")
  match
    @runtime.read_transcript_for_audit(emptyish, @runtime.Own, agent_id="solo") {
    Err(m) => assert_true(m.contains("tool call") || m.contains("audit"))
    Ok(_) => fail("text-only must fail audit include-tool-calls")
  }
}
