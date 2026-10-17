///|
/// CM-2161: parallel multi-subagent — same turn ≥2 handles all Running.

///|
/// Spawn multiple executor handles in one turn; each is marked Running.
/// Requires ≥2 prompts; returns Err otherwise.
pub fn spawn_parallel_executors(
  parent_turn_id~ : String,
  prompts : Array[String],
) -> Result[Array[SubagentHandle], String] {
  if prompts.length() < 2 {
    return Err("parallel multi-subagent requires ≥2 prompts/handles")
  }
  if parent_turn_id.length() == 0 {
    return Err("parent_turn_id must not be empty")
  }
  let handles : Array[SubagentHandle] = []
  let mut i = 0
  while i < prompts.length() {
    let prompt = prompts[i]
    if prompt.length() == 0 {
      return Err("prompt must not be empty")
    }
    let id = "ex-par-" + parent_turn_id + "-" + (i + 1).to_string()
    let h = SubagentHandle::dispatch_executor(id, parent_turn_id, prompt)
    h.mark_running()
    handles.push(h)
    i = i + 1
  }
  Ok(handles)
}

///|
/// Count how many handles are currently Running.
pub fn count_running_handles(handles : Array[SubagentHandle]) -> Int32 {
  let mut n = 0
  for h in handles {
    match h.check() {
      Running => n = n + 1
      _ => ()
    }
  }
  n
}

///|
/// CM-2161 acceptance helper: Given ≥2 handles When spawn Then ≥2 Running.
pub fn assert_parallel_multi_running(
  handles : Array[SubagentHandle],
) -> Result[Unit, String] {
  let n = count_running_handles(handles)
  if n < 2 {
    Err("expected ≥2 Running handles, got " + n.to_string())
  } else if handles.length() < 2 {
    Err("expected ≥2 handles")
  } else {
    Ok(())
  }
}
