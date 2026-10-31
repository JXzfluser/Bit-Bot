///|
/// CM-1602: GenerateVideo — text-to-video/short; task queueable; completion notifiable.
/// Kernel-contract mock Host media surface (no real diffusion/encode).

///|
/// Queued GenerateVideo task state.
pub(all) enum VideoTaskState {
  Queued
  Running
  Completed
  Failed(message~ : String)
} derive(Eq, Debug)

///|
pub extend VideoTaskState with Eq::{equal, not_equal}

///|
pub extend VideoTaskState with Debug::{to_repr}

///|
pub fn VideoTaskState::is_queued(self : VideoTaskState) -> Bool {
  match self {
    Queued => true
    Running | Completed | Failed(_) => false
  }
}

///|
pub fn VideoTaskState::is_terminal(self : VideoTaskState) -> Bool {
  match self {
    Completed | Failed(_) => true
    Queued | Running => false
  }
}

///|
/// One GenerateVideo job on the queue.
pub(all) struct VideoGenTask {
  id : String
  prompt : String
  /// Output filename under /workspace/agent-tools/.
  name : String
  mut state : VideoTaskState
  /// Artifact path once completed.
  mut artifact_path : String?
} derive(Eq, Debug)

///|
pub extend VideoGenTask with Eq::{equal, not_equal}

///|
pub extend VideoGenTask with Debug::{to_repr}

///|
/// Completion notification delivered when a queued video finishes.
pub(all) struct VideoCompletionNotify {
  task_id : String
  artifact_path : String
  prompt : String
  /// True when parent/user can be notified of completion.
  notifiable : Bool
  message : String
} derive(Eq, Debug)

///|
pub extend VideoCompletionNotify with Eq::{equal, not_equal}

///|
pub extend VideoCompletionNotify with Debug::{to_repr}

///|
fn mp4_magic_placeholder() -> String {
  "ftypisomBITBOT-GEN-VIDEO"
}

///|
/// CM-1602: enqueue GenerateVideo (text-to-video/short). Task is queueable.
pub fn MediaHost::enqueue_generate_video(
  self : MediaHost,
  prompt~ : String,
  name~ : String = "generated.mp4",
  task_id~ : String = "",
) -> Result[VideoGenTask, String] {
  if prompt.length() == 0 {
    return Err("GenerateVideo requires a prompt")
  }
  let lower = prompt.to_lower()
  if lower.contains("real person video") || lower.contains("deepfake of a real") {
    return Err("GenerateVideo must not forge real-person videos")
  }
  let id = if task_id.length() > 0 {
    task_id
  } else {
    "vid-gen-" + (self.artifacts.length() + 1).to_string()
  }
  let fname = if name.has_suffix(".mp4") || name.has_suffix(".webm") {
    name
  } else {
    name + ".mp4"
  }
  Ok({ id, prompt, name: fname, state: Queued, artifact_path: None, })
}

///|
/// Mark a queued task Running (still on the queue pipeline).
pub fn MediaHost::start_video_task(
  self : MediaHost,
  task : VideoGenTask,
) -> Result[VideoGenTask, String] {
  let _ = self
  match task.state {
    Queued => {
      task.state = Running
      Ok(task)
    }
    Running => Ok(task)
    Completed => Err("GenerateVideo task already completed")
    Failed(message~) => Err("GenerateVideo task failed: " + message)
  }
}

///|
/// Complete a queued/running GenerateVideo task → artifact on disk + notifiable.
pub fn MediaHost::complete_video_task(
  self : MediaHost,
  task : VideoGenTask,
) -> Result[(VideoGenTask, VideoCompletionNotify), String] {
  match task.state {
    Failed(message~) => Err("GenerateVideo task failed: " + message)
    Completed =>
      match task.artifact_path {
        Some(p) =>
          Ok(
            (
              task,
              {
                task_id: task.id,
                artifact_path: p,
                prompt: task.prompt,
                notifiable: true,
                message: "GenerateVideo completed: " + p,
              },
            ),
          )
        None => Err("GenerateVideo completed without artifact path")
      }
    Queued | Running => {
      let path = "/workspace/agent-tools/" + task.name
      self.files.set(path, mp4_magic_placeholder())
      self.artifacts.push(path)
      task.state = Completed
      task.artifact_path = Some(path)
      let notify = {
        task_id: task.id,
        artifact_path: path,
        prompt: task.prompt,
        notifiable: true,
        message: "GenerateVideo completed: " + path,
      }
      Ok((task, notify))
    }
  }
}

///|
/// Result of GenerateVideo: short/video artifact under /workspace.
pub(all) struct GeneratedVideoArtifact {
  path : String
  prompt : String
  mime : String
  on_disk : Bool
  task_id : String
} derive(Eq, Debug)

///|
pub extend GeneratedVideoArtifact with Eq::{equal, not_equal}

///|
pub extend GeneratedVideoArtifact with Debug::{to_repr}

///|
/// Convenience: enqueue → complete in one kernel-contract call (still queue-shaped).
pub fn MediaHost::generate_video(
  self : MediaHost,
  prompt~ : String,
  name~ : String = "generated.mp4",
) -> Result[GeneratedVideoArtifact, String] {
  match self.enqueue_generate_video(prompt~, name~) {
    Err(e) => Err(e)
    Ok(task) =>
      match self.complete_video_task(task) {
        Err(e) => Err(e)
        Ok((done, _notify)) =>
          match done.artifact_path {
            None => Err("GenerateVideo missing artifact")
            Some(path) =>
              Ok({
                path,
                prompt: done.prompt,
                mime: "video/mp4",
                on_disk: true,
                task_id: done.id,
              })
          }
      }
  }
}

///|
/// True when a completion notify is eligible to wake/notify the user.
pub fn VideoCompletionNotify::can_notify(self : VideoCompletionNotify) -> Bool {
  self.notifiable && self.artifact_path.length() > 0
}
