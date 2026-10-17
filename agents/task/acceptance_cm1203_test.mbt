///|
/// CM-1203: Task knowledgeWork — dispatch and recover summary.
test "acceptance_CM-1203_task_knowledge_work_dispatch_summary" {
  match
    @task.run_knowledge_work_task(
      task_id="kw-1",
      parent_turn_id="turn-p",
      material_prompt="organize Q3 notes into outline",
    ) {
    Ok((h, report)) => {
      assert_eq(h.kind.label(), "knowledgeWork")
      assert_false(h.may_send_to_user)
      assert_true(h.parent_should_wake())
      assert_eq(report.task_id, "kw-1")
      assert_true(report.summary.contains("organize Q3 notes"))
      match h.check() {
        @task.Completed(summary~) => assert_eq(summary, report.summary)
        _ => fail("expected Completed with summary")
      }
      assert_eq(h.result_summary, Some(report.summary))
    }
    Err(e) => fail(e)
  }
  match
    @task.run_knowledge_work_task(
      task_id="kw-empty",
      parent_turn_id="t",
      material_prompt="",
    ) {
    Err(m) => assert_true(m.contains("material") || m.contains("prompt"))
    Ok(_) => fail("empty material must Err")
  }
}
