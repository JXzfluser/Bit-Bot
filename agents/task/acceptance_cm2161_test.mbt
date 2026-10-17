///|
/// CM-2161: parallel multi-subagent — same turn multiple handles ≥2 Running.
test "acceptance_CM-2161_parallel_multi_subagent_handles_running" {
  match
    @task.spawn_parallel_executors(parent_turn_id="turn-2161", [
      "research A", "research B",
    ]) {
    Err(e) => fail(e)
    Ok(handles) => {
      assert_eq(handles.length(), 2)
      assert_eq(handles[0].parent_turn_id, "turn-2161")
      assert_eq(handles[1].parent_turn_id, "turn-2161")
      assert_true(handles[0].id != handles[1].id)
      assert_eq(handles[0].check(), @task.Running)
      assert_eq(handles[1].check(), @task.Running)
      assert_eq(@task.count_running_handles(handles), 2)
      match @task.assert_parallel_multi_running(handles) {
        Ok(_) => ()
        Err(e) => fail(e)
      }
    }
  }
  // Three handles still ≥2 Running.
  match
    @task.spawn_parallel_executors(parent_turn_id="turn-2161b", ["a", "b", "c"]) {
    Ok(handles) => {
      assert_eq(handles.length(), 3)
      assert_true(@task.count_running_handles(handles) >= 2)
    }
    Err(e) => fail(e)
  }
  // Single prompt must Err (not parallel multi).
  match @task.spawn_parallel_executors(parent_turn_id="t", ["only-one"]) {
    Err(m) => assert_true(m.contains("≥2") || m.contains("2"))
    Ok(_) => fail("single handle must not satisfy parallel multi")
  }
}
