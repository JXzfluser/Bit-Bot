///|
/// CM-1303: Origin cloud tool surface aligned with cursor-origin MCP (CM-0909).
/// Does not alter OriginMcpSurface; documents and checks PR/checks tool names.

///|
/// Expected cursor-origin MCP tool names for PR/checks alignment.
pub fn cursor_origin_mcp_pr_checks_tools() -> Array[String] {
  [
    "list_repositories", "get_pull_request", "list_pull_requests", "checks_read",
    "compare_commits", "create_pull_request",
  ]
}

///|
/// Cloud Origin integration exposes the same namespace as cursor-origin MCP.
pub fn origin_cloud_namespace() -> String {
  OriginMcpSurface::namespace_id()
}

///|
/// CM-1303: surface aligns when namespace is cursor-origin, distinct from
/// cursor-github, and PR/checks entry points are callable on a native repo.
pub fn origin_cloud_aligns_cursor_origin_mcp(
  surface : OriginMcpSurface,
) -> Result[Unit, String] {
  if OriginMcpSurface::namespace_id() != "cursor-origin" {
    return Err("namespace must be cursor-origin")
  }
  if !OriginMcpSurface::is_distinct_from_github_mirror() {
    return Err("cursor-origin must be distinct from cursor-github")
  }
  let tools = cursor_origin_mcp_pr_checks_tools()
  let mut has_checks = false
  let mut has_pr = false
  for t in tools {
    if t == "checks_read" {
      has_checks = true
    }
    if t == "get_pull_request" || t == "list_pull_requests" {
      has_pr = true
    }
  }
  if !has_checks || !has_pr {
    return Err("PR/checks tools missing from aligned surface")
  }
  // Exercise native PR + checks path (same as CM-0909).
  let repos = surface.list_repos()
  if repos.length() == 0 {
    return Err("aligned surface needs at least one native repo")
  }
  let prs = surface.list_pull_requests()
  if prs.length() == 0 {
    return Err("aligned surface needs at least one PR for checks_read")
  }
  let pr_number = prs[0].number_
  let _ = surface.checks_read(pr_number~)
  match surface.get_pull_request(number_=pr_number) {
    Ok(_) => Ok(())
    Err(e) => Err(e)
  }
}
