///|
/// K-1/K-3 的纯函数部分(可在 wasm target 下测)。
/// FFI 那半边在 native file 里,由 scripts/prove_agent_context.js 端到端证明。

///|
test "K-1 agent context slot is per (bot, session)" {
  // 槽位是 (Bot, 会话):新会话不该带着上个会话的记忆。
  assert_eq(agent_context_slot("bot-A", "sess-1"), "bot-A__sess-1")
  assert_eq(agent_context_slot("  bot-B  ", "  sess-2  "), "bot-B__sess-2")
  // 同一个 Bot 换会话 → 不同的槽位。
  assert_true(
    agent_context_slot("bot-A", "sess-1") !=
    agent_context_slot("bot-A", "sess-2"),
  )
  // 同一个会话换 Bot → 不同的槽位。
  assert_true(
    agent_context_slot("bot-A", "sess-1") !=
    agent_context_slot("bot-B", "sess-1"),
  )
  // 缺省值:没 Bot 走默认 Bot,没会话走默认会话。
  assert_eq(agent_context_slot("", ""), "agent-bit__default")
  assert_eq(agent_context_slot("   ", "   "), "agent-bit__default")
}

///|
test "K-1 context request encodes op, slot and text" {
  let req = encode_context_request("load_context", "bot-A", "")
  assert_true(req.contains("\"op\":\"load_context\""))
  assert_true(req.contains("\"slot\":\"bot-A\""))
  let save = encode_context_request("save_context", "bot-A", "line1\nline2")
  assert_true(save.contains("\"op\":\"save_context\""))
  // 换行必须被转义,否则一行上下文会变成两行 FFI 请求。
  assert_true(save.contains("\\n"))
  assert_false(save.contains("\"text\":\"line1\nline2\""))
}

///|
test "K-1 context reply extracts the text and tolerates an unknown op" {
  assert_eq(parse_context_reply("{\"output\":\"abc\"}"), "abc")
  // 旧 Host 不认识这两个 op → unknown op → 当作没有历史。
  assert_eq(
    parse_context_reply("{\"error\":\"unknown op\",\"output\":\"\"}"),
    "",
  )
  assert_eq(parse_context_reply(""), "")
}

///|
test "K-1 context survives an encode/decode round trip" {
  let ctx = @runtime.AgentContext::new(session_id="s1")
  ctx.append_user("请记住这个数字 4271")
  let text = ctx.encode()
  let back = @runtime.AgentContext::decode(text)
  assert_eq(back.turn_count(), ctx.turn_count())
  // 历史里确实有那句话。
  let messages = back.wire_messages()
  let mut found = false
  for m in messages {
    if m.content.contains("4271") {
      found = true
    }
  }
  assert_true(found)
}

///|
test "K-1 aligned context carries the current session id" {
  let ctx = @runtime.AgentContext::new(session_id="old-session")
  let same = agent_context_aligned(ctx, "old-session")
  assert_eq(same.session(), "old-session")
  let moved = agent_context_aligned(ctx, "new-session")
  assert_eq(moved.session(), "new-session")
  // 对齐 session id 不该把历史弄丢。
  ctx.append_user("别忘了我")
  let kept = agent_context_aligned(ctx, "new-session")
  assert_eq(kept.turn_count(), ctx.turn_count())
}
