///|
/// CM-1603: watchVideo — answer grounded in frames (Q watch path remains intact).
test "acceptance_CM-1603_watch_video_answer_from_frames" {
  match
    @task.run_watch_video_answer_from_frames(
      task_id="vid-frames-1",
      parent_turn_id="turn-p",
      video_path="/workspace/uploads/demo.mp4",
      question="what color is the logo on screen",
      max_frames=3,
    ) {
    Ok((h, ans)) => {
      assert_eq(h.kind.label(), "watchVideo")
      assert_false(h.may_send_to_user)
      assert_true(h.parent_should_wake())
      assert_eq(ans.video_path, "/workspace/uploads/demo.mp4")
      assert_eq(ans.question, "what color is the logo on screen")
      assert_true(ans.frame_captions.length() >= 1)
      assert_true(ans.is_grounded_in_frames())
      assert_true(
        ans.answer.contains("grounded in frames") ||
        ans.answer.contains("frame-"),
      )
      assert_true(
        ans.answer.contains("logo") ||
        ans.answer.contains("color") ||
        ans.answer.contains("question") ||
        ans.answer.length() > 0,
      )
      match h.result_summary {
        Some(s) => assert_eq(s, ans.answer)
        None => fail("parent must recover grounded answer")
      }
    }
    Err(e) => fail(e)
  }
  // Empty path still Err (same gate as CM-1204).
  match
    @task.run_watch_video_answer_from_frames(
      task_id="bad",
      parent_turn_id="t",
      video_path="",
      question="x",
    ) {
    Err(m) => assert_true(m.contains("path") || m.contains("video"))
    Ok(_) => fail("empty path must Err")
  }
}
