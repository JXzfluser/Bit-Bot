///|
/// CM-1202: Task computerUse returns structured outcome only (wrap ComputerUseOutcome).
test "acceptance_CM-1202_computer_use_task_outcome_only" {
  match
    @computer_use.run_computer_use_task(
      task_id="cu-task-1",
      parent_turn_id="turn-p",
      { task: "open settings and capture outcome", allow_shell_escape: false, },
    ) {
    Ok(report) => {
      assert_eq(report.task_id, "cu-task-1")
      let view = report.parent_view()
      assert_eq(view.agent_id, "cu-task-1")
      assert_eq(view.summary, "structured outcome only")
      assert_eq(view.final_url, Some("https://example.com"))
      assert_false(view.blocked_on_signin)
      // Parent only sees ComputerUseOutcome fields — wrap contract.
      assert_true(view.summary.length() > 0)
    }
    Err(e) => fail(e)
  }
  match
    @computer_use.run_computer_use_task(task_id="cu-bad", parent_turn_id="t", {
      task: "x",
      allow_shell_escape: true,
    }) {
    Err(m) => assert_true(m.contains("Shell") || m.contains("box_host"))
    Ok(_) => fail("shell escape must reject")
  }
}
