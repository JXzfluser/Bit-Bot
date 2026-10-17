///|
/// CM-1301: launch result carrying bcId + agent URL.
pub(all) struct CloudAgentLaunch {
  bc_id : String
  url : String
} derive(Eq, Debug)

///|
pub extend CloudAgentLaunch with Eq::{equal, not_equal}

///|
pub extend CloudAgentLaunch with Debug::{to_repr}

///|
pub fn CloudAgentLaunch::make(bc_id : String) -> CloudAgentLaunch {
  { bc_id, url: "https://cursor.com/agents/" + bc_id, }
}

///|
/// In-memory Cloud Agent service (CM-1301 / CM-1302).
pub(all) struct CloudAgentService {
  mut seq : Int32
  jobs : Array[CloudAgentJob]
}

///|
pub fn CloudAgentService::new() -> CloudAgentService {
  { seq: 0, jobs: [], }
}

///|
/// Launch a cloud agent: returns bcId + link; job starts Running.
pub fn CloudAgentService::launch(
  self : CloudAgentService,
  prompt : String,
) -> CloudAgentLaunch {
  self.seq = self.seq + 1
  let bc_id = "bc-" + self.seq.to_string()
  let launch = CloudAgentLaunch::make(bc_id)
  self.jobs.push({
    id: bc_id,
    prompt,
    status: Running,
    created_at_ms: 0L,
    result_uri: Some(launch.url),
  })
  launch
}

///|
pub fn CloudAgentService::get(
  self : CloudAgentService,
  bc_id : String,
) -> CloudAgentJob? {
  for j in self.jobs {
    if j.id == bc_id {
      break Some(j)
    }
  } nobreak {
    None
  }
}

///|
fn replace_job(jobs : Array[CloudAgentJob], updated : CloudAgentJob) -> Unit {
  let mut i = 0
  while i < jobs.length() {
    if jobs[i].id == updated.id {
      jobs[i] = updated
      return
    }
    i = i + 1
  }
}

///|
/// Mark job Succeeded (terminal success).
pub fn CloudAgentService::mark_succeeded(
  self : CloudAgentService,
  bc_id : String,
) -> Result[CloudAgentJob, String] {
  match self.get(bc_id) {
    None => Err("unknown bcId")
    Some(j) => {
      let updated = {
        id: j.id,
        prompt: j.prompt,
        status: Succeeded,
        created_at_ms: j.created_at_ms,
        result_uri: j.result_uri,
      }
      replace_job(self.jobs, updated)
      Ok(updated)
    }
  }
}

///|
/// Mark job Failed with message (terminal failure; distinguishable from Succeeded).
pub fn CloudAgentService::mark_failed(
  self : CloudAgentService,
  bc_id : String,
  message~ : String,
) -> Result[CloudAgentJob, String] {
  match self.get(bc_id) {
    None => Err("unknown bcId")
    Some(j) => {
      let updated = {
        id: j.id,
        prompt: j.prompt,
        status: Failed(message~),
        created_at_ms: j.created_at_ms,
        result_uri: j.result_uri,
      }
      replace_job(self.jobs, updated)
      Ok(updated)
    }
  }
}

///|
pub fn CloudJobStatus::is_succeeded(self : CloudJobStatus) -> Bool {
  match self {
    Succeeded => true
    _ => false
  }
}

///|
pub fn CloudJobStatus::is_failed(self : CloudJobStatus) -> Bool {
  match self {
    Failed(_) => true
    _ => false
  }
}

///|
/// CM-1302: Completed ≡ Succeeded for acceptance wording.
pub fn CloudJobStatus::is_completed(self : CloudJobStatus) -> Bool {
  self.is_succeeded()
}
