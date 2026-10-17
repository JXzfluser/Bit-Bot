///|
/// CM-0909: cursor-origin MCP surface — Origin native repo/PR/checks.
/// Distinct from cursor-github (GitHub mirror) MCP.
pub(all) struct OriginRepo {
  id : String
  name : String
  /// Native Origin only — never a GitHub mirror clone.
  native : Bool
} derive(Eq, Debug)

///|
pub extend OriginRepo with Eq::{equal, not_equal}

///|
pub extend OriginRepo with Debug::{to_repr}

///|
pub(all) struct OriginPullRequest {
  number_ : Int32
  title : String
  state : String
  repo_id : String
} derive(Eq, Debug)

///|
pub extend OriginPullRequest with Eq::{equal, not_equal}

///|
pub extend OriginPullRequest with Debug::{to_repr}

///|
pub(all) struct OriginCheck {
  name : String
  status : String
  pr_number : Int32
} derive(Eq, Debug)

///|
pub extend OriginCheck with Eq::{equal, not_equal}

///|
pub extend OriginCheck with Debug::{to_repr}

///|
/// MCP-facing Origin surface (namespace cursor-origin).
pub(all) struct OriginMcpSurface {
  repos : Array[OriginRepo]
  prs : Array[OriginPullRequest]
  checks : Array[OriginCheck]
}

///|
pub fn OriginMcpSurface::new() -> OriginMcpSurface {
  { repos: [], prs: [], checks: [], }
}

///|
/// Canonical MCP namespace id — must stay distinct from cursor-github.
pub fn OriginMcpSurface::namespace_id() -> String {
  "cursor-origin"
}

///|
pub fn OriginMcpSurface::github_mirror_namespace_id() -> String {
  "cursor-github"
}

///|
pub fn OriginMcpSurface::is_distinct_from_github_mirror() -> Bool {
  OriginMcpSurface::namespace_id() !=
  OriginMcpSurface::github_mirror_namespace_id()
}

///|
pub fn OriginMcpSurface::seed_native_repo(
  self : OriginMcpSurface,
  id~ : String,
  name~ : String,
) -> Unit {
  self.repos.push({ id, name, native: true, })
}

///|
/// Reject seeding a GitHub-mirror repo into Origin surface.
pub fn OriginMcpSurface::seed_mirror_repo(
  self : OriginMcpSurface,
  id~ : String,
  name~ : String,
) -> Result[Unit, String] {
  let _ = self
  let _ = id
  let _ = name
  Err("cursor-origin rejects GitHub mirror repos; native Origin only")
}

///|
pub fn OriginMcpSurface::list_repos(
  self : OriginMcpSurface,
) -> Array[OriginRepo] {
  let out : Array[OriginRepo] = []
  for r in self.repos {
    if r.native {
      out.push(r)
    }
  }
  out
}

///|
pub fn OriginMcpSurface::seed_pr(
  self : OriginMcpSurface,
  number_~ : Int32,
  title~ : String,
  state~ : String = "open",
  repo_id~ : String,
) -> Result[Unit, String] {
  let mut found = false
  for r in self.repos {
    if r.id == repo_id && r.native {
      found = true
      break
    }
  }
  if !found {
    return Err("origin PR requires native repo: " + repo_id)
  }
  self.prs.push({ number_, title, state, repo_id, })
  Ok(())
}

///|
pub fn OriginMcpSurface::list_pull_requests(
  self : OriginMcpSurface,
) -> Array[OriginPullRequest] {
  let out : Array[OriginPullRequest] = []
  for p in self.prs {
    out.push(p)
  }
  out
}

///|
pub fn OriginMcpSurface::get_pull_request(
  self : OriginMcpSurface,
  number_~ : Int32,
) -> Result[OriginPullRequest, String] {
  for p in self.prs {
    if p.number_ == number_ {
      return Ok(p)
    }
  }
  Err("origin pull request not found: " + number_.to_string())
}

///|
/// MCP: checks_read for a PR on a native Origin repo.
pub fn OriginMcpSurface::checks_read(
  self : OriginMcpSurface,
  pr_number~ : Int32,
) -> Array[OriginCheck] {
  let out : Array[OriginCheck] = []
  for c in self.checks {
    if c.pr_number == pr_number {
      out.push(c)
    }
  }
  out
}

///|
pub fn OriginMcpSurface::seed_check(
  self : OriginMcpSurface,
  name~ : String,
  status~ : String,
  pr_number~ : Int32,
) -> Unit {
  self.checks.push({ name, status, pr_number, })
}
