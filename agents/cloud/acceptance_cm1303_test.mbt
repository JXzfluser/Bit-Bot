///|
/// CM-1303: Origin integration — PR/checks tool surface aligns with cursor-origin MCP.
test "acceptance_CM-1303_origin_cloud_aligns_cursor_origin_mcp" {
  assert_eq(@cloud.origin_cloud_namespace(), "cursor-origin")
  assert_true(@cloud.OriginMcpSurface::namespace_id() != "cursor-github")
  let tools = @cloud.cursor_origin_mcp_pr_checks_tools()
  assert_true(tools.length() >= 4)
  let mut saw_checks = false
  let mut saw_pr = false
  for t in tools {
    if t == "checks_read" {
      saw_checks = true
    }
    if t == "get_pull_request" {
      saw_pr = true
    }
  }
  assert_true(saw_checks)
  assert_true(saw_pr)
  let origin = @cloud.OriginMcpSurface::new()
  origin.seed_native_repo(id="orig-align", name="native-align")
  match
    origin.seed_pr(
      number_=7,
      title="align-pr",
      state="open",
      repo_id="orig-align",
    ) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  origin.seed_check(name="ci", status="success", pr_number=7)
  match @cloud.origin_cloud_aligns_cursor_origin_mcp(origin) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  let checks = origin.checks_read(pr_number=7)
  assert_eq(checks.length(), 1)
  match origin.get_pull_request(number_=7) {
    Ok(pr) => assert_eq(pr.title, "align-pr")
    Err(e) => fail(e)
  }
}
