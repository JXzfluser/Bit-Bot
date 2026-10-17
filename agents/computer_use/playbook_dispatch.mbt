///|
/// CM-0507: Dispatch site-playbook snippet into a computerUse child task.

///|
pub(all) struct PlaybookChildTask {
  agent_id : String
  playbook_name : String
  snippet : String
  read_first : Bool
  child_task_prompt : String
  handle : @task.SubagentHandle
} derive(Eq, Debug)

///|
pub extend PlaybookChildTask with Eq::{equal, not_equal}

///|
pub extend PlaybookChildTask with Debug::{to_repr}

///|
/// After site match + Read, dispatch snippet into computerUse child (no user send).
pub fn dispatch_site_playbook_snippet(
  agent_id~ : String,
  parent_turn_id~ : String,
  dispatch : @skills.PlaybookDispatchSnippet,
) -> Result[PlaybookChildTask, String] {
  if !dispatch.read_first {
    return Err("site-playbook must Read first before Dispatch")
  }
  if dispatch.snippet.length() == 0 {
    return Err("site-playbook snippet empty")
  }
  let h = @task.SubagentHandle::dispatch_executor(
    agent_id,
    parent_turn_id,
    dispatch.child_task_prompt,
  )
  h.mark_running()
  Ok({
    agent_id,
    playbook_name: dispatch.playbook_name,
    snippet: dispatch.snippet,
    read_first: dispatch.read_first,
    child_task_prompt: dispatch.child_task_prompt,
    handle: h,
  })
}

///|
pub fn PlaybookChildTask::snippet_in_child_task(
  self : PlaybookChildTask,
) -> Bool {
  self.child_task_prompt.contains(self.snippet) && self.read_first
}
