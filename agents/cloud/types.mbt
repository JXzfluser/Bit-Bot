///|
pub(all) enum CloudJobStatus {
  Queued
  Running
  Succeeded
  Failed(message~ : String)
  Cancelled
} derive(Eq, Debug)

///|
pub extend CloudJobStatus with Eq::{not_equal, equal}

///|
pub extend CloudJobStatus with Debug::{to_repr}

///|
/// Placeholder for a remote Cloud Agent job submitted by the runtime.
pub(all) struct CloudAgentJob {
  id : String
  prompt : String
  status : CloudJobStatus
  created_at_ms : Int64
  result_uri : String?
} derive(Eq, Debug)

///|
pub extend CloudAgentJob with Eq::{not_equal, equal}

///|
pub extend CloudAgentJob with Debug::{to_repr}

///|
pub fn CloudAgentJob::queued(id : String, prompt : String) -> CloudAgentJob {
  { id, prompt, status: Queued, created_at_ms: 0L, result_uri: None, }
}

///|
pub fn CloudAgentJob::is_terminal(self : CloudAgentJob) -> Bool {
  match self.status {
    Succeeded | Failed(_) | Cancelled => true
    Queued | Running => false
  }
}
