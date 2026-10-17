///|
/// CM-1301 / CM-1302: launch returns bcId + link; Succeeded vs Failed distinguishable.
test "acceptance_CM-1301_1302_cloud_agent_lifecycle" {
  let svc = @cloud.CloudAgentService::new()
  let launch = svc.launch("fix the flaky test")
  assert_true(launch.bc_id.has_prefix("bc-"))
  assert_eq(launch.url, "https://cursor.com/agents/" + launch.bc_id)
  match svc.get(launch.bc_id) {
    Some(j) => {
      assert_eq(j.status, @cloud.Running)
      assert_eq(j.result_uri, Some(launch.url))
    }
    None => fail("job missing after launch")
  }
  let ok = match svc.mark_succeeded(launch.bc_id) {
    Ok(j) => j
    Err(e) => fail(e)
  }
  assert_true(ok.status.is_succeeded())
  assert_false(ok.status.is_failed())
  assert_true(ok.is_terminal())

  let launch2 = svc.launch("will fail")
  let bad = match svc.mark_failed(launch2.bc_id, message="boom") {
    Ok(j) => j
    Err(e) => fail(e)
  }
  assert_true(bad.status.is_failed())
  assert_false(bad.status.is_succeeded())
  match bad.status {
    @cloud.Failed(message~) => assert_eq(message, "boom")
    _ => fail("expected Failed")
  }
  // Succeeded and Failed are distinguishable
  assert_false(ok.status == bad.status)
}

///|
/// CM-1304: mock create_comment + read_diff callable/testable.
test "acceptance_CM-1304_pr_comment_and_diff_mock" {
  let gh = @cloud.MockGithub::new()
  gh.seed_diff("42", "diff --git a/x b/x\n+hello")
  let c = match gh.create_pr_comment("42", "LGTM from cloud agent") {
    Ok(x) => x
    Err(e) => fail(e)
  }
  assert_eq(c.pr, "42")
  assert_true(c.body.contains("LGTM"))
  assert_eq(gh.comment_count(), 1)
  let diff = match gh.read_pr_diff("42") {
    Ok(d) => d
    Err(e) => fail(e)
  }
  assert_true(diff.contains("+hello"))
  match gh.read_pr_diff("999") {
    Err(_) => ()
    Ok(_) => fail("missing pr must Err")
  }
}
