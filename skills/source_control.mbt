///|
/// CM-1305: source-control skill — GitHub vs Origin routing discipline.
/// Mirror repos must NOT use Origin triggers.

///|
/// Repo classification for source-control routing.
pub(all) enum ScRepoKind {
  /// Native Origin repository.
  NativeOrigin
  /// GitHub repo mirrored into Origin (must not use origin triggers).
  GithubMirror
  /// Plain GitHub (non-Origin) repository.
  GithubNative
} derive(Eq, Debug)

///|
pub extend ScRepoKind with Eq::{equal, not_equal}

///|
pub extend ScRepoKind with Debug::{to_repr}

///|
/// Backend / MCP namespace the skill should route to.
pub(all) enum ScBackend {
  Origin
  Github
} derive(Eq, Debug)

///|
pub extend ScBackend with Eq::{equal, not_equal}

///|
pub extend ScBackend with Debug::{to_repr}

///|
pub fn ScBackend::mcp_namespace(self : ScBackend) -> String {
  match self {
    Origin => "cursor-origin"
    Github => "cursor-github"
  }
}

///|
/// Route source-control operations: native Origin → Origin; else GitHub.
pub fn route_source_control(kind : ScRepoKind) -> ScBackend {
  match kind {
    NativeOrigin => Origin
    GithubMirror | GithubNative => Github
  }
}

///|
/// CM-1305: Origin triggers are allowed only on native Origin repos.
pub fn allows_origin_trigger(kind : ScRepoKind) -> Bool {
  match kind {
    NativeOrigin => true
    GithubMirror | GithubNative => false
  }
}

///|
/// Attempt to register an Origin event trigger for a repo.
/// Mirror (and plain GitHub) must be rejected.
pub fn register_origin_trigger(
  kind : ScRepoKind,
  repo~ : String,
  event~ : String,
) -> Result[String, String] {
  let _ = event
  if !allows_origin_trigger(kind) {
    return Err(
      "source-control: mirror/GitHub repos must not use origin triggers: " +
      repo,
    )
  }
  Ok("origin-trigger:" + repo)
}

///|
/// Skill name in managed catalog.
pub fn source_control_skill_name() -> String {
  "source-control"
}
