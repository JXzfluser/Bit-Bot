///|
/// J-batch P0: CM-2133 — no busy-loop CheckSubagent; completion-wake / yield.

///|
test "acceptance_CM-2133_no_busy_loop_check_subagent" {
  let h = @task.SubagentHandle::dispatch_executor(
    "ex-j-2133", "turn-parent", "background work",
  )
  h.mark_running()
  let wait = @task.ParentWaitSession::new()
  let mode = wait.plan_wait(h)
  assert_false(mode.is_busy_loop())
  assert_true(mode is @task.CompletionWake || mode is @task.YieldUntilWake)
  // Completion-wake path: child finishes → parent wakes; no poll loop.
  let status = wait.await_completion_wake(h, summary="done")
  match status {
    @task.Completed(summary~) => assert_eq(summary, "done")
    _ => fail("expected Completed after wake")
  }
  assert_true(h.parent_should_wake())
  assert_false(wait.used_busy_loop())
  // Busy-loop Check while still running is refused.
  let h2 = @task.SubagentHandle::dispatch_executor("ex-j-2133b", "t", "p")
  h2.mark_running()
  let wait2 = @task.ParentWaitSession::new()
  match wait2.check_once(h2) {
    Ok(_) => ()
    Err(e) => fail("first peek ok: " + e)
  }
  match wait2.check_once(h2) {
    Err(m) => {
      assert_true(m.contains("busy-loop") || m.contains("completion-wake"))
      assert_true(wait2.used_busy_loop())
    }
    Ok(_) => fail("second Check while running must be busy-loop refuse")
  }
}
