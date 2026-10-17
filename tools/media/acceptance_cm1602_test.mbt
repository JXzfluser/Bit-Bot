///|
/// CM-1602: GenerateVideo — text-to-video/short; task queueable; completion notifiable.
test "acceptance_CM-1602_generate_video_queue_and_notify" {
  let host = @media.MediaHost::mock()
  // Enqueue is queueable (Queued state).
  match
    host.enqueue_generate_video(
      prompt="a short geometric logo animation for Bit Bot",
      name="bitbot-logo.mp4",
      task_id="vid-q-1",
    ) {
    Err(e) => fail(e)
    Ok(task) => {
      assert_eq(task.id, "vid-q-1")
      assert_true(task.state.is_queued())
      assert_eq(task.state, @media.Queued)
      assert_eq(task.artifact_path, None)
      match host.start_video_task(task) {
        Err(e) => fail(e)
        Ok(running) => {
          assert_eq(running.state, @media.Running)
          match host.complete_video_task(running) {
            Err(e) => fail(e)
            Ok((done, notify)) => {
              assert_eq(done.state, @media.Completed)
              assert_true(done.state.is_terminal())
              match done.artifact_path {
                Some(p) => {
                  assert_true(p.has_prefix("/workspace/"))
                  assert_true(p.has_suffix(".mp4"))
                  assert_true(host.exists(p))
                }
                None => fail("completed video must have artifact path")
              }
              // Completion is notifiable.
              assert_true(notify.notifiable)
              assert_true(notify.can_notify())
              assert_eq(notify.task_id, "vid-q-1")
              assert_true(notify.message.contains("completed"))
              assert_true(notify.artifact_path.has_suffix(".mp4"))
            }
          }
        }
      }
    }
  }
  // Convenience generate_video still produces on-disk short.
  match host.generate_video(prompt="sunset timelapse short", name="sunset.mp4") {
    Ok(art) => {
      assert_true(art.on_disk)
      assert_eq(art.mime, "video/mp4")
      assert_true(host.exists(art.path))
    }
    Err(e) => fail(e)
  }
  match host.enqueue_generate_video(prompt="") {
    Err(m) => assert_true(m.contains("prompt"))
    Ok(_) => fail("empty prompt must Err")
  }
}
