///|
/// CM-2136: Task resume — Given child finished When resume=id Then context preserved and continues.
test "acceptance_CM-2136_task_resume_preserves_context" {
  let h = @task.SubagentHandle::dispatch_executor(
    "task-2136", "turn-parent-2136", "research topic alpha",
  )
  h.mark_running()
  match h.message(body="note: prefer primary sources") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  h.complete(summary="draft findings on alpha")
  assert_true(h.status.is_terminal())
  let reg = @task.TaskResumeRegistry::new()
  match reg.record_finished(h, prompt="research topic alpha") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match reg.resume_by_id("task-2136") {
    Err(e) => fail(e)
    Ok((resumed, ctx)) => {
      assert_eq(resumed.id, "task-2136")
      assert_eq(resumed.parent_turn_id, "turn-parent-2136")
      assert_true(resumed.status is @task.Running)
      assert_false(resumed.status.is_terminal())
      assert_true(
        ctx.is_preserved(
          prompt="research topic alpha",
          prior_summary="draft findings on alpha",
        ),
      )
      assert_eq(ctx.prior_summary, "draft findings on alpha")
      assert_eq(ctx.prompt, "research topic alpha")
      // Inbox context preserved.
      assert_true(resumed.message_arrived(body="note: prefer primary sources"))
      assert_eq(resumed.inbox_snapshot().length(), 1)
      // Continues: can complete again after more work.
      resumed.complete(summary="final alpha report")
      assert_true(resumed.status.is_terminal())
    }
  }
  match reg.resume_by_id("missing-id") {
    Err(m) => assert_true(m.contains("unknown") || m.contains("resume"))
    Ok(_) => fail("missing id must Err")
  }
}
