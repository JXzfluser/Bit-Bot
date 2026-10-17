///|
/// CM-0909: cursor-origin MCP — Origin native repo/PR/checks; distinct from GitHub mirror.
test "acceptance_CM-0909_cursor_origin_distinct_from_github_mirror" {
  assert_eq(@cloud.OriginMcpSurface::namespace_id(), "cursor-origin")
  assert_eq(
    @cloud.OriginMcpSurface::github_mirror_namespace_id(),
    "cursor-github",
  )
  assert_true(@cloud.OriginMcpSurface::is_distinct_from_github_mirror())
  let origin = @cloud.OriginMcpSurface::new()
  origin.seed_native_repo(id="orig-1", name="bitbot-native")
  match origin.seed_mirror_repo(id="gh-mirror", name="bitbot-mirror") {
    Err(m) => assert_true(m.contains("mirror") || m.contains("native"))
    Ok(_) => fail("GitHub mirror must be rejected on cursor-origin")
  }
  let repos = origin.list_repos()
  assert_eq(repos.length(), 1)
  assert_true(repos[0].native)
  assert_eq(repos[0].name, "bitbot-native")
  match
    origin.seed_pr(
      number_=11,
      title="origin-native-pr",
      state="open",
      repo_id="orig-1",
    ) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match origin.seed_pr(number_=12, title="nope", repo_id="missing") {
    Err(m) => assert_true(m.contains("native"))
    Ok(_) => fail("PR on non-native/missing repo must Err")
  }
  let prs = origin.list_pull_requests()
  assert_eq(prs.length(), 1)
  match origin.get_pull_request(number_=11) {
    Ok(pr) => {
      assert_eq(pr.title, "origin-native-pr")
      assert_eq(pr.repo_id, "orig-1")
    }
    Err(e) => fail(e)
  }
  origin.seed_check(name="ci", status="success", pr_number=11)
  let checks = origin.checks_read(pr_number=11)
  assert_eq(checks.length(), 1)
  assert_eq(checks[0].status, "success")
  assert_eq(origin.checks_read(pr_number=99).length(), 0)
  // Parallel github surface remains a separate namespace (mirror).
  let gh = @cloud.GithubMcpSurface::new()
  gh.seed_pr(number_=42, title="github-mirror-pr")
  assert_eq(gh.list_pull_requests().length(), 1)
  assert_true(@cloud.OriginMcpSurface::namespace_id() != "cursor-github")
}
