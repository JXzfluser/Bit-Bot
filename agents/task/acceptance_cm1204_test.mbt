///|
/// CM-1204: Task video/watchVideo — video path in, conclusion out.
test "acceptance_CM-1204_task_video_watch_path_in_conclusion_out" {
  match
    @task.run_watch_video_task(
      task_id="vid-1",
      parent_turn_id="turn-p",
      video_path="/workspace/uploads/demo.mp4",
      question="what is the main topic",
    ) {
    Ok((h, conc)) => {
      assert_eq(h.kind.label(), "watchVideo")
      assert_false(h.may_send_to_user)
      assert_true(h.parent_should_wake())
      assert_eq(conc.task_id, "vid-1")
      assert_eq(conc.video_path, "/workspace/uploads/demo.mp4")
      assert_true(conc.conclusion.length() > 0)
      assert_true(conc.conclusion.contains("/workspace/uploads/demo.mp4"))
      assert_true(
        conc.conclusion.contains("main topic") ||
        conc.conclusion.contains("conclusion"),
      )
      match h.result_summary {
        Some(s) => assert_eq(s, conc.conclusion)
        None => fail("parent must recover conclusion summary")
      }
    }
    Err(e) => fail(e)
  }
  match
    @task.run_watch_video_task(
      task_id="vid-bad",
      parent_turn_id="t",
      video_path="",
    ) {
    Err(m) => assert_true(m.contains("video path") || m.contains("path"))
    Ok(_) => fail("empty video path must Err")
  }
}
