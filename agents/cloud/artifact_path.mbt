///|
/// CM-2148: cloud artifact path constraint — never attach /opt/cursor/artifacts
/// directly; deliver a workspace copy under /workspace/cloud-agent-artifacts/
/// or an official URL.

///|
pub const OPT_CURSOR_ARTIFACTS_PREFIX : String = "/opt/cursor/artifacts"

///|
pub const CLOUD_AGENT_ARTIFACTS_ROOT : String = "/workspace/cloud-agent-artifacts"

///|
/// Delivery target after path policy.
pub(all) enum CloudArtifactDelivery {
  WorkspaceCopy(path~ : String)
  OfficialUrl(url~ : String)
} derive(Eq, Debug)

///|
pub extend CloudArtifactDelivery with Eq::{equal, not_equal}

///|
pub extend CloudArtifactDelivery with Debug::{to_repr}

///|
pub fn CloudArtifactDelivery::is_workspace_copy(
  self : CloudArtifactDelivery,
) -> Bool {
  match self {
    WorkspaceCopy(_) => true
    OfficialUrl(_) => false
  }
}

///|
pub fn CloudArtifactDelivery::path_or_url(
  self : CloudArtifactDelivery,
) -> String {
  match self {
    WorkspaceCopy(path~) => path
    OfficialUrl(url~) => url
  }
}

///|
/// True when path is under the forbidden direct-attach root.
pub fn is_forbidden_opt_cursor_artifacts(path : String) -> Bool {
  path == OPT_CURSOR_ARTIFACTS_PREFIX ||
  path.has_prefix(OPT_CURSOR_ARTIFACTS_PREFIX + "/")
}

///|
/// Workspace copy path for a cloud agent artifact.
pub fn cloud_artifact_workspace_copy_path(
  bc_id : String,
  filename : String,
) -> String {
  CLOUD_AGENT_ARTIFACTS_ROOT + "/" + bc_id + "/" + filename
}

///|
fn is_official_cloud_url(url : String) -> Bool {
  url.has_prefix("https://cursor.com/agents/") ||
  url.has_prefix("https://www.cursor.com/agents/")
}

///|
/// Given a cloud artifact source When deliver Then workspace copy or official URL.
/// Direct /opt/cursor/artifacts paths are rejected.
pub fn deliver_cloud_artifact(
  bc_id : String,
  source_path : String,
  official_url~ : String? = None,
) -> Result[CloudArtifactDelivery, String] {
  if bc_id.length() == 0 {
    return Err("bc_id must not be empty")
  }
  if is_forbidden_opt_cursor_artifacts(source_path) {
    // May still deliver via official URL when provided; never attach opt path.
    match official_url {
      Some(u) =>
        if is_official_cloud_url(u) {
          return Ok(OfficialUrl(url=u))
        } else {
          return Err(
            "do not attach /opt/cursor/artifacts directly; use workspace copy or official URL",
          )
        }
      None =>
        return Err(
          "do not attach /opt/cursor/artifacts directly; use workspace copy or official URL",
        )
    }
  }
  match official_url {
    Some(u) =>
      if is_official_cloud_url(u) {
        return Ok(OfficialUrl(url=u))
      } else {
        ()
      }
    None => ()
  }
  // Prefer workspace copy under cloud-agent-artifacts.
  let name = filename_of(source_path)
  let dest = cloud_artifact_workspace_copy_path(bc_id, name)
  if !dest.has_prefix(CLOUD_AGENT_ARTIFACTS_ROOT + "/") {
    return Err("workspace copy must be under cloud-agent-artifacts")
  }
  Ok(WorkspaceCopy(path=dest))
}

///|
fn filename_of(path : String) -> String {
  let mut last_slash = -1
  let mut i = 0
  while i < path.length() {
    if path[i] == '/' {
      last_slash = i
    }
    i = i + 1
  }
  if last_slash < 0 {
    if path.length() == 0 {
      "artifact.bin"
    } else {
      path
    }
  } else {
    let rest = path[last_slash + 1:].to_owned()
    if rest.length() == 0 {
      "artifact.bin"
    } else {
      rest
    }
  }
}

///|
/// Reject attaching a raw /opt/cursor/artifacts path as an attachment.
pub fn reject_direct_opt_cursor_attach(path : String) -> Result[Unit, String] {
  if is_forbidden_opt_cursor_artifacts(path) {
    Err("forbidden: do not attach /opt/cursor/artifacts directly")
  } else {
    Ok(())
  }
}
