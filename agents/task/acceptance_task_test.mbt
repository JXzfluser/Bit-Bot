///|
/// CM-1201: dispatch executor; child must not send user messages.
test "acceptance_CM-1201_executor_dispatch_no_user_send" {
  let h = @task.SubagentHandle::dispatch_executor(
    "ex-1", "turn-parent", "do work",
  )
  assert_eq(h.kind.label(), "executor")
  assert_false(h.may_send_to_user)
  h.mark_running()
  assert_eq(h.check(), @task.Running)
  assert_false(h.may_send_to_user)
}

///|
/// CM-1206: status enum accurate across lifecycle.
test "acceptance_CM-1206_check_status" {
  let h = @task.SubagentHandle::dispatch_executor("ex-2", "t", "p")
  assert_eq(h.check(), @task.Starting)
  h.mark_running()
  assert_eq(h.check(), @task.Running)
  assert_false(h.check().is_terminal())
}

///|
/// CM-1207: stop → terminal; no further side effects.
test "acceptance_CM-1207_stop_no_side_effects" {
  let h = @task.SubagentHandle::dispatch_executor("ex-3", "t", "p")
  h.mark_running()
  h.stop()
  assert_eq(h.check(), @task.Stopped)
  assert_true(h.check().is_terminal())
  assert_false(h.can_emit_side_effect())
}

///|
/// CM-1208: complete wakes parent with summary; child still no user send.
test "acceptance_CM-1208_wake_parent_with_summary" {
  let h = @task.SubagentHandle::dispatch_executor("ex-4", "t-parent", "p")
  h.mark_running()
  h.complete(summary="csv done")
  assert_true(h.parent_should_wake())
  assert_eq(h.result_summary, Some("csv done"))
  assert_false(h.may_send_to_user)
  match h.check() {
    @task.Completed(summary~) => assert_eq(summary, "csv done")
    _ => fail("expected Completed")
  }
}
