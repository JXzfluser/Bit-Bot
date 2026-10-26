///|
test "CTX-1 history keeps user, assistant, tool and observation entries" {
  let ctx = @runtime.AgentContext::new(session_id="s1")
  ctx.append_user("hello")
  ctx.append_assistant("thinking")
  ctx.append_tool("Read", "file body")
  ctx.append_observation("Nope", "unknown tool: Nope")
  let msgs = ctx.wire_messages()
  assert_eq(msgs.length(), 4)
  assert_eq(msgs[0].role, "user")
  assert_eq(msgs[0].content, "hello")
  assert_eq(msgs[1].role, "assistant")
  assert_eq(msgs[2].role, "tool")
  assert_eq(msgs[3].role, "tool")
  assert_eq(ctx.turn_count(), 1)
}

///|
test "CTX-2 the token budget is an estimate, not a real token count" {
  // 40 ASCII characters are about ten tokens with the char/4 estimate.
  assert_eq(@runtime.estimate_tokens("0123456789"), 3)
  assert_eq(@runtime.estimate_tokens("0123456789012345678901234567890123456789"), 10)
  // CJK text is counted one token per character.
  assert_eq(@runtime.estimate_tokens("计划"), 2)
  let ctx = @runtime.AgentContext::with_budget(
    session_id="s2",
    budget_tokens=10,
    keep_recent_turns=1,
  )
  assert_false(ctx.over_budget())
  ctx.append_user("0123456789012345678901234567890123456789")
  assert_true(ctx.over_budget())
}

///|
test "CTX-3 compaction folds older turns and never drops a key result" {
  let ctx = @runtime.AgentContext::with_budget(
    session_id="s3",
    budget_tokens=100000,
    keep_recent_turns=1,
  )
  ctx.append_user("first question")
  ctx.append_tool("Read", "important file body")
  ctx.append_user("second question")
  ctx.append_tool("Read", "recent body")
  assert_true(ctx.compact(@runtime.HeuristicSummarizer::new()))
  assert_true(ctx.summary.contains("first question"))
  assert_eq(ctx.turn_count(), 1)
  let mut kept_key = false
  let mut kept_recent = false
  for m in ctx.wire_messages() {
    if m.content.contains("important file body") {
      kept_key = true
    }
    if m.content.contains("recent body") {
      kept_recent = true
    }
  }
  assert_true(kept_key)
  assert_true(kept_recent)
}

///|
test "CTX-4 a session survives encode and decode" {
  let ctx = @runtime.AgentContext::new(session_id="s7")
  ctx.append_user("line one\nline two")
  ctx.append_tool("Shell", "exit code: 3")
  ctx.set_todos([{ id: "1", content: "step", status: "done" }])
  let back = @runtime.AgentContext::decode(ctx.encode())
  assert_eq(back.session(), "s7")
  assert_eq(back.turn_count(), 1)
  assert_eq(back.done_todo_count(), 1)
  assert_eq(back.todos[0].content, "step")
  let mut saw_text = false
  for m in back.wire_messages() {
    if m.content.contains("line one\nline two") {
      saw_text = true
    }
  }
  assert_true(saw_text)
}

///|
test "CTX-5 the plan block shows what the model wrote" {
  let ctx = @runtime.AgentContext::new(session_id="s8")
  assert_eq(ctx.plan_block(), "")
  ctx.set_todos([
    { id: "1", content: "read the file", status: "done" },
    { id: "2", content: "summarize", status: "pending" },
  ])
  let plan = ctx.plan_block()
  assert_true(plan.contains("[plan]"))
  assert_true(plan.contains("1. [x] read the file"))
  assert_true(plan.contains("2. [ ] summarize"))
  assert_eq(ctx.done_todo_count(), 1)
  let msgs = ctx.wire_messages()
  assert_eq(msgs[0].role, "system")
  assert_true(msgs[0].content.contains("read the file"))
}

///|
test "CTX-6 todo arguments parse into plan actions" {
  let replace = @runtime.parse_todo_action(
    "{\"todos\":[{\"id\":\"1\",\"content\":\"first\",\"status\":\"pending\"},{\"id\":\"2\",\"title\":\"second\",\"status\":\"done\"}]}",
  )
  match replace {
    Err(e) => assert_true(false, msg=e)
    Ok(@runtime.TodoAction::Replace(items)) => {
      assert_eq(items.length(), 2)
      assert_eq(items[0].content, "first")
      assert_eq(items[1].content, "second")
      assert_eq(items[1].status, "done")
    }
    Ok(_) => assert_true(false, msg="expected Replace")
  }
  let done = @runtime.parse_todo_action("{\"id\":\"2\",\"status\":\"done\"}")
  match done {
    Err(e) => assert_true(false, msg=e)
    Ok(@runtime.TodoAction::MarkDone(id)) => assert_eq(id, "2")
    Ok(_) => assert_true(false, msg="expected MarkDone")
  }
  match @runtime.parse_todo_action("{\"todos\":[]}") {
    Err(_) => ()
    Ok(_) => assert_true(false, msg="empty todo list must be rejected")
  }
}

///|
test "CTX-7 exit codes and tool results are read out of the output" {
  assert_eq(@runtime.extract_exit_code("boom, exit code: 3"), 3)
  assert_eq(@runtime.extract_exit_code("exit_code=7"), 7)
  assert_eq(@runtime.extract_exit_code("no code here"), -1)
}
