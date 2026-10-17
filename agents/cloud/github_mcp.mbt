///|
/// CM-0908: cursor-github MCP surface — list/get PR + comments (mock-testable).
pub(all) struct MockPullRequest {
  number_ : Int32
  title : String
  state : String
  body : String
} derive(Eq, Debug)

///|
pub extend MockPullRequest with Eq::{equal, not_equal}

///|
pub extend MockPullRequest with Debug::{to_repr}

///|
/// MCP-facing GitHub mock wrapping MockGithub comments + PR list/get.
pub(all) struct GithubMcpSurface {
  github : MockGithub
  prs : Array[MockPullRequest]
}

///|
pub fn GithubMcpSurface::new() -> GithubMcpSurface {
  { github: MockGithub::new(), prs: [], }
}

///|
pub fn GithubMcpSurface::seed_pr(
  self : GithubMcpSurface,
  number_~ : Int32,
  title~ : String,
  state~ : String = "open",
  body~ : String = "",
) -> Unit {
  self.prs.push({ number_, title, state, body, })
}

///|
/// MCP: list_pull_requests
pub fn GithubMcpSurface::list_pull_requests(
  self : GithubMcpSurface,
) -> Array[MockPullRequest] {
  let out : Array[MockPullRequest] = []
  for p in self.prs {
    out.push(p)
  }
  out
}

///|
/// MCP: get_pull_request
pub fn GithubMcpSurface::get_pull_request(
  self : GithubMcpSurface,
  number_~ : Int32,
) -> Result[MockPullRequest, String] {
  for p in self.prs {
    if p.number_ == number_ {
      return Ok(p)
    }
  }
  Err("pull request not found: " + number_.to_string())
}

///|
/// MCP: list / add PR comments via MockGithub.
pub fn GithubMcpSurface::create_pr_comment(
  self : GithubMcpSurface,
  number_~ : Int32,
  body~ : String,
) -> Result[MockPrComment, String] {
  self.github.create_comment(pr_number=number_, body~)
}

///|
pub fn GithubMcpSurface::list_pr_comments(
  self : GithubMcpSurface,
  number_~ : Int32,
) -> Array[MockPrComment] {
  let key = number_.to_string()
  let out : Array[MockPrComment] = []
  for c in self.github.comments {
    if c.pr == key {
      out.push(c)
    }
  }
  out
}
