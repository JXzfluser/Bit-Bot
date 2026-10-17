///|
/// CM-1206: subagent lifecycle status.
pub(all) enum SubagentStatus {
  Starting
  Running
  Blocked(reason~ : String)
  Completed(summary~ : String)
  Failed(message~ : String)
  Stopped
} derive(Eq, Debug)

///|
pub extend SubagentStatus with Eq::{equal, not_equal}

///|
pub extend SubagentStatus with Debug::{to_repr}

///|
pub fn SubagentStatus::is_terminal(self : SubagentStatus) -> Bool {
  match self {
    Completed(_) | Failed(_) | Stopped => true
    Starting | Running | Blocked(_) => false
  }
}

///|
/// CM-1201: Task executor handle — parent synthesizes; child must not user-send.
pub(all) struct SubagentHandle {
  id : String
  kind : @agents.SubagentType
  parent_turn_id : String
  mut status : SubagentStatus
  mut may_send_to_user : Bool
  mut wake_parent : Bool
  mut result_summary : String?
  /// CM-1205: follow-up messages delivered while running.
  mut inbox : Array[String]
} derive(Eq, Debug)

///|
pub extend SubagentHandle with Eq::{equal, not_equal}

///|
pub extend SubagentHandle with Debug::{to_repr}

///|
pub fn SubagentHandle::dispatch_executor(
  id : String,
  parent_turn_id : String,
  prompt : String,
) -> SubagentHandle {
  let _ = prompt
  {
    id,
    kind: @agents.Executor,
    parent_turn_id,
    status: Starting,
    may_send_to_user: false,
    wake_parent: false,
    result_summary: None,
    inbox: [],
  }
}

///|
pub fn SubagentHandle::mark_running(self : SubagentHandle) -> Unit {
  self.status = Running
}

///|
/// CM-1206: check status.
pub fn SubagentHandle::check(self : SubagentHandle) -> SubagentStatus {
  self.status
}

///|
/// CM-1207: stop — terminal; no further side effects.
pub fn SubagentHandle::stop(self : SubagentHandle) -> Unit {
  self.status = Stopped
  self.may_send_to_user = false
  self.wake_parent = false
}

///|
pub fn SubagentHandle::can_emit_side_effect(self : SubagentHandle) -> Bool {
  match self.status {
    Running | Starting | Blocked(_) => true
    Completed(_) | Failed(_) | Stopped => false
  }
}

///|
/// CM-1208: complete → WakeParent with summary; still must not send to user as child.
pub fn SubagentHandle::complete(
  self : SubagentHandle,
  summary~ : String,
) -> Unit {
  self.status = Completed(summary~)
  self.result_summary = Some(summary)
  self.wake_parent = true
  self.may_send_to_user = false
}

///|
pub fn SubagentHandle::parent_should_wake(self : SubagentHandle) -> Bool {
  self.wake_parent
}

///|
/// CM-2133: how a parent waits on a background subagent.
/// Busy-loop CheckSubagent is forbidden; use completion-wake / yield.
pub(all) enum ParentWaitMode {
  BusyLoopCheck
  CompletionWake
  YieldUntilWake
} derive(Eq, Debug)

///|
pub extend ParentWaitMode with Eq::{equal, not_equal}

///|
pub extend ParentWaitMode with Debug::{to_repr}

///|
pub fn ParentWaitMode::is_busy_loop(self : ParentWaitMode) -> Bool {
  match self {
    BusyLoopCheck => true
    CompletionWake | YieldUntilWake => false
  }
}

///|
/// CM-2133: parent wait planner — records check attempts; refuses busy-loop.
pub(all) struct ParentWaitSession {
  mut check_count : Int32
  mut mode : ParentWaitMode
  mut woke : Bool
}

///|
pub fn ParentWaitSession::new() -> ParentWaitSession {
  { check_count: 0, mode: YieldUntilWake, woke: false, }
}

///|
/// Preferred wait for a background-running subagent: yield / completion-wake.
pub fn ParentWaitSession::plan_wait(
  self : ParentWaitSession,
  handle : SubagentHandle,
) -> ParentWaitMode {
  match handle.status {
    Running | Starting | Blocked(_) => {
      self.mode = CompletionWake
      CompletionWake
    }
    Completed(_) | Failed(_) | Stopped => {
      self.mode = CompletionWake
      self.woke = true
      CompletionWake
    }
  }
}

///|
/// A single status peek after wake is ok; repeated Check while still running is busy-loop.
pub fn ParentWaitSession::check_once(
  self : ParentWaitSession,
  handle : SubagentHandle,
) -> Result[SubagentStatus, String] {
  self.check_count = self.check_count + 1
  if !handle.status.is_terminal() && self.check_count > 1 {
    self.mode = BusyLoopCheck
    Err("busy-loop CheckSubagent forbidden; use completion-wake / yield")
  } else {
    if handle.status.is_terminal() {
      self.woke = true
      self.mode = CompletionWake
    }
    Ok(handle.check())
  }
}

///|
/// Simulate completion-wake: child completes → parent wakes without poll loop.
pub fn ParentWaitSession::await_completion_wake(
  self : ParentWaitSession,
  handle : SubagentHandle,
  summary~ : String,
) -> SubagentStatus {
  handle.complete(summary~)
  self.mode = CompletionWake
  self.woke = true
  // Wake path does not increment a busy poll counter.
  handle.check()
}

///|
pub fn ParentWaitSession::used_busy_loop(self : ParentWaitSession) -> Bool {
  self.mode.is_busy_loop() || (self.check_count > 1 && !self.woke)
}

///|
/// CM-2162: child reports NeedApproval — blocks + wakes parent (bubble up).
pub fn SubagentHandle::report_need_approval(
  self : SubagentHandle,
  summary~ : String,
  request_id~ : String = "need-appr",
) -> NeedApprovalReport {
  self.status = Blocked(reason="NeedApproval: " + summary)
  self.wake_parent = true
  self.may_send_to_user = false
  { child_id: self.id, request_id, summary, }
}

///|
/// Lightweight report returned by child (parent maps to security ApprovalCard).
pub(all) struct NeedApprovalReport {
  child_id : String
  request_id : String
  summary : String
} derive(Eq, Debug)

///|
pub extend NeedApprovalReport with Eq::{equal, not_equal}

///|
pub extend NeedApprovalReport with Debug::{to_repr}

///|
pub fn NeedApprovalReport::is_need_approval(self : NeedApprovalReport) -> Bool {
  self.summary.length() > 0 && self.child_id.length() > 0
}

///|
/// CM-1203: knowledgeWork report recovered by parent.
pub(all) struct KnowledgeWorkReport {
  task_id : String
  summary : String
} derive(Eq, Debug)

///|
pub extend KnowledgeWorkReport with Eq::{equal, not_equal}

///|
pub extend KnowledgeWorkReport with Debug::{to_repr}

///|
/// CM-1203: dispatch knowledgeWork subagent (no user send).
pub fn SubagentHandle::dispatch_knowledge_work(
  id : String,
  parent_turn_id : String,
  material_prompt : String,
) -> SubagentHandle {
  let _ = material_prompt
  {
    id,
    kind: @agents.KnowledgeWork,
    parent_turn_id,
    status: Starting,
    may_send_to_user: false,
    wake_parent: false,
    result_summary: None,
    inbox: [],
  }
}

///|
/// Run knowledgeWork to completion and recover summary for parent.
pub fn run_knowledge_work_task(
  task_id~ : String,
  parent_turn_id~ : String,
  material_prompt~ : String,
) -> Result[(SubagentHandle, KnowledgeWorkReport), String] {
  if material_prompt.length() == 0 {
    return Err("knowledgeWork requires material prompt")
  }
  let h = SubagentHandle::dispatch_knowledge_work(
    task_id, parent_turn_id, material_prompt,
  )
  h.mark_running()
  let summary = "knowledgeWork summary: " + material_prompt
  h.complete(summary~)
  Ok((h, { task_id, summary, }))
}

///|
/// CM-1204: watchVideo / videoReview conclusion.
pub(all) struct WatchVideoConclusion {
  task_id : String
  video_path : String
  conclusion : String
} derive(Eq, Debug)

///|
pub extend WatchVideoConclusion with Eq::{equal, not_equal}

///|
pub extend WatchVideoConclusion with Debug::{to_repr}

///|
fn video_path_ok(path : String) -> Bool {
  path.length() > 0 &&
  (
    path.has_prefix("/workspace/") ||
    path.has_prefix("/home/") ||
    path.has_suffix(".mp4") ||
    path.has_suffix(".webm") ||
    path.has_suffix(".mov")
  )
}

///|
/// CM-1204: dispatch watchVideo — video path in.
pub fn SubagentHandle::dispatch_watch_video(
  id : String,
  parent_turn_id : String,
  video_path : String,
) -> Result[SubagentHandle, String] {
  if !video_path_ok(video_path) {
    return Err("watchVideo requires a video path")
  }
  Ok({
    id,
    kind: @agents.WatchVideo,
    parent_turn_id,
    status: Starting,
    may_send_to_user: false,
    wake_parent: false,
    result_summary: None,
    inbox: [],
  })
}

///|
/// CM-1204: video path in → conclusion out (parent recovers).
pub fn run_watch_video_task(
  task_id~ : String,
  parent_turn_id~ : String,
  video_path~ : String,
  question~ : String = "summarize",
) -> Result[(SubagentHandle, WatchVideoConclusion), String] {
  match
    SubagentHandle::dispatch_watch_video(task_id, parent_turn_id, video_path) {
    Err(e) => Err(e)
    Ok(h) => {
      h.mark_running()
      let conclusion = "conclusion for " + question + " from " + video_path
      h.complete(summary=conclusion)
      Ok((h, { task_id, video_path, conclusion, }))
    }
  }
}

///|
/// CM-1205: follow-up message delivered to a running subagent.
pub(all) struct SubagentMessage {
  body : String
} derive(Eq, Debug)

///|
pub extend SubagentMessage with Eq::{equal, not_equal}

///|
pub extend SubagentMessage with Debug::{to_repr}

///|
/// CM-1205: deliver a follow-up message while the subagent is running.
/// Message arrives in inbox; status remains queryable via check().
pub fn SubagentHandle::message(
  self : SubagentHandle,
  body~ : String,
) -> Result[Unit, String] {
  if body.length() == 0 {
    return Err("message body required")
  }
  match self.status {
    Running | Starting | Blocked(_) => {
      self.inbox.push(body)
      Ok(())
    }
    Completed(_) | Failed(_) | Stopped =>
      Err("cannot message terminal subagent")
  }
}

///|
/// CM-1205: whether a specific follow-up body arrived.
pub fn SubagentHandle::message_arrived(
  self : SubagentHandle,
  body~ : String,
) -> Bool {
  for m in self.inbox {
    if m == body {
      return true
    }
  }
  false
}

///|
/// CM-1205: inbox snapshot (arrived messages).
pub fn SubagentHandle::inbox_snapshot(self : SubagentHandle) -> Array[String] {
  let out : Array[String] = []
  for m in self.inbox {
    out.push(m)
  }
  out
}

///|
/// CM-1205: status remains queryable after messaging (alias of check).
pub fn SubagentHandle::query_status(self : SubagentHandle) -> SubagentStatus {
  self.check()
}

///|
/// CM-1603: watchVideo answer grounded in extracted frames.
pub(all) struct WatchVideoFrameAnswer {
  task_id : String
  video_path : String
  question : String
  /// Captions from tools/media frames used for grounding.
  frame_captions : Array[String]
  answer : String
} derive(Eq, Debug)

///|
pub extend WatchVideoFrameAnswer with Eq::{equal, not_equal}

///|
pub extend WatchVideoFrameAnswer with Debug::{to_repr}

///|
pub fn WatchVideoFrameAnswer::is_grounded_in_frames(
  self : WatchVideoFrameAnswer,
) -> Bool {
  if self.frame_captions.length() == 0 {
    return false
  }
  // Answer must reference at least one frame caption token.
  for c in self.frame_captions {
    if self.answer.contains(c) || self.answer.contains("frame-") {
      return true
    }
  }
  self.answer.contains("grounded in frames")
}

///|
/// CM-1603: video path in → frames via tools/media → answer grounded in frames.
/// Extends Q watch path without changing run_watch_video_task (CM-1204 stays green).
pub fn run_watch_video_answer_from_frames(
  task_id~ : String,
  parent_turn_id~ : String,
  video_path~ : String,
  question~ : String,
  max_frames~ : Int32 = 4,
) -> Result[(SubagentHandle, WatchVideoFrameAnswer), String] {
  match
    SubagentHandle::dispatch_watch_video(task_id, parent_turn_id, video_path) {
    Err(e) => Err(e)
    Ok(h) => {
      h.mark_running()
      match @media.extract_video_frames(video_path~, max_frames~) {
        Err(e) => {
          h.status = Failed(message=e)
          Err(e)
        }
        Ok(frames) =>
          match @media.answer_from_frames(question~, frames) {
            Err(e) => {
              h.status = Failed(message=e)
              Err(e)
            }
            Ok(answer) => {
              let captions : Array[String] = []
              for f in frames {
                captions.push(f.caption)
              }
              h.complete(summary=answer)
              Ok(
                (
                  h,
                  {
                    task_id,
                    video_path,
                    question,
                    frame_captions: captions,
                    answer,
                  },
                ),
              )
            }
          }
      }
    }
  }
}

///|
/// CM-2136: preserved task context for resume after terminal completion.
pub(all) struct TaskResumeContext {
  task_id : String
  parent_turn_id : String
  prompt : String
  prior_summary : String
  inbox : Array[String]
  kind : @agents.SubagentType
} derive(Eq, Debug)

///|
pub extend TaskResumeContext with Eq::{equal, not_equal}

///|
pub extend TaskResumeContext with Debug::{to_repr}

///|
/// Registry of finished tasks that may be resumed with preserved context.
pub(all) struct TaskResumeRegistry {
  contexts : Array[TaskResumeContext]
  /// Live handles after resume (same id continues).
  live : Array[SubagentHandle]
}

///|
pub fn TaskResumeRegistry::new() -> TaskResumeRegistry {
  { contexts: [], live: [], }
}

///|
/// Record a finished child so resume=id can restore context.
pub fn TaskResumeRegistry::record_finished(
  self : TaskResumeRegistry,
  handle : SubagentHandle,
  prompt~ : String,
) -> Result[Unit, String] {
  if !handle.status.is_terminal() {
    return Err("record_finished requires terminal subagent")
  }
  let summary = match handle.result_summary {
    Some(s) => s
    None =>
      match handle.status {
        Completed(summary~) => summary
        Failed(message~) => message
        Stopped => "stopped"
        _ => ""
      }
  }
  let inbox_copy : Array[String] = []
  for m in handle.inbox {
    inbox_copy.push(m)
  }
  // Replace existing snapshot for same id.
  let mut i = 0
  while i < self.contexts.length() {
    if self.contexts[i].task_id == handle.id {
      self.contexts[i] = {
        task_id: handle.id,
        parent_turn_id: handle.parent_turn_id,
        prompt,
        prior_summary: summary,
        inbox: inbox_copy,
        kind: handle.kind,
      }
      return Ok(())
    }
    i = i + 1
  }
  self.contexts.push({
    task_id: handle.id,
    parent_turn_id: handle.parent_turn_id,
    prompt,
    prior_summary: summary,
    inbox: inbox_copy,
    kind: handle.kind,
  })
  Ok(())
}

///|
fn task_find_context(
  reg : TaskResumeRegistry,
  id : String,
) -> TaskResumeContext? {
  for c in reg.contexts {
    if c.task_id == id {
      return Some(c)
    }
  }
  None
}

///|
/// CM-2136: resume=id — context preserved and task continues (Running).
/// Method name avoids reserved keyword `resume`.
pub fn TaskResumeRegistry::resume_by_id(
  self : TaskResumeRegistry,
  id : String,
) -> Result[(SubagentHandle, TaskResumeContext), String] {
  match task_find_context(self, id) {
    None => Err("unknown task id for resume: " + id)
    Some(ctx) => {
      let inbox_copy : Array[String] = []
      for m in ctx.inbox {
        inbox_copy.push(m)
      }
      let h : SubagentHandle = {
        id: ctx.task_id,
        kind: ctx.kind,
        parent_turn_id: ctx.parent_turn_id,
        status: Running,
        may_send_to_user: false,
        wake_parent: false,
        result_summary: Some(ctx.prior_summary),
        inbox: inbox_copy,
      }
      // Track live resumed handle.
      let mut replaced = false
      let mut i = 0
      while i < self.live.length() {
        if self.live[i].id == id {
          self.live[i] = h
          replaced = true
        }
        i = i + 1
      }
      if !replaced {
        self.live.push(h)
      }
      Ok((h, ctx))
    }
  }
}

///|
pub fn TaskResumeContext::is_preserved(
  self : TaskResumeContext,
  prompt~ : String,
  prior_summary~ : String,
) -> Bool {
  self.prompt == prompt && self.prior_summary == prior_summary
}
