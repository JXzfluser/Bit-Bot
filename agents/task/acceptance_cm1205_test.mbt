///|
/// CM-1205: Message running subagent — message arrives; status queryable.
test "acceptance_CM-1205_message_subagent_arrives_status_queryable" {
  let h = @task.SubagentHandle::dispatch_executor(
    "ex-msg-1", "turn-parent", "long task",
  )
  h.mark_running()
  assert_eq(h.query_status(), @task.Running)
  match h.message(body="please also export csv") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_true(h.message_arrived(body="please also export csv"))
  assert_eq(h.inbox_snapshot().length(), 1)
  // Status still queryable after message arrives.
  assert_eq(h.check(), @task.Running)
  assert_eq(h.query_status(), @task.Running)
  assert_false(h.check().is_terminal())
  // Second follow-up also arrives.
  match h.message(body="and attach chart") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_eq(h.inbox_snapshot().length(), 2)
  assert_true(h.message_arrived(body="and attach chart"))
  // Terminal subagent rejects further messages.
  h.complete(summary="done")
  match h.message(body="too late") {
    Err(m) => assert_true(m.contains("terminal") || m.contains("cannot"))
    Ok(_) => fail("terminal subagent must reject message")
  }
  // Empty body rejected while running.
  let h2 = @task.SubagentHandle::dispatch_executor("ex-msg-2", "t", "p")
  h2.mark_running()
  match h2.message(body="") {
    Err(m) => assert_true(m.contains("body") || m.contains("required"))
    Ok(_) => fail("empty body must Err")
  }
}
