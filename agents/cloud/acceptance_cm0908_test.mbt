///|
/// CM-0908: cursor-github MCP — list/get PR + comments (mock-testable).
test "acceptance_CM-0908_github_mcp_pr_list_get_comment" {
  let gh = @cloud.GithubMcpSurface::new()
  gh.seed_pr(number_=42, title="G-batch acceptance", state="open", body="wip")
  gh.seed_pr(number_=7, title="other", state="closed")
  let listed = gh.list_pull_requests()
  assert_eq(listed.length(), 2)
  match gh.get_pull_request(number_=42) {
    Ok(pr) => {
      assert_eq(pr.title, "G-batch acceptance")
      assert_eq(pr.state, "open")
    }
    Err(e) => fail(e)
  }
  match gh.get_pull_request(number_=999) {
    Err(m) => assert_true(m.contains("not found"))
    Ok(_) => fail("missing PR must Err")
  }
  match gh.create_pr_comment(number_=42, body="LGTM after G-batch") {
    Ok(c) => {
      assert_eq(c.pr, "42")
      assert_eq(c.body, "LGTM after G-batch")
    }
    Err(e) => fail(e)
  }
  let comments = gh.list_pr_comments(number_=42)
  assert_eq(comments.length(), 1)
  assert_eq(comments[0].body, "LGTM after G-batch")
  assert_eq(gh.list_pr_comments(number_=7).length(), 0)
}
