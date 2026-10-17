///|
/// CM-1301/1302: start returns bc_id+url; Completed vs Failed distinguishable.
test "acceptance_CM-1301_1302_cloud_start_status" {
  let svc = @cloud.CloudAgentService::new()
  let launch = svc.launch("fix the flaky test")
  assert_true(launch.bc_id.length() > 0)
  assert_true(launch.bc_id.has_prefix("bc-"))
  assert_true(launch.url.has_prefix("https://"))
  assert_true(launch.url.contains(launch.bc_id))
  match svc.get(launch.bc_id) {
    Some(j) => assert_eq(j.status, @cloud.Running)
    None => fail("job missing after start")
  }
  let done = match svc.mark_succeeded(launch.bc_id) {
    Ok(j) => j
    Err(e) => fail(e)
  }
  // Completed ≡ Succeeded
  assert_true(done.status.is_completed())
  assert_true(done.status.is_succeeded())
  assert_false(done.status.is_failed())

  let launch2 = svc.launch("will fail")
  let bad = match svc.mark_failed(launch2.bc_id, message="compile error") {
    Ok(j) => j
    Err(e) => fail(e)
  }
  assert_true(bad.status.is_failed())
  assert_false(bad.status.is_completed())
  match bad.status {
    @cloud.Failed(message~) => assert_true(message.contains("compile"))
    _ => fail("expected Failed")
  }
  assert_false(done.status == bad.status)
}

///|
/// CM-1304: mock github create_comment + read_diff.
test "acceptance_CM-1304_github_comment_and_diff" {
  let gh = @cloud.MockGithub::new()
  gh.seed_diff("42", "diff --git a/x.mbt b/x.mbt\n+ok\n")
  match gh.read_diff(pr_number=42) {
    Ok(d) => {
      assert_true(d.contains("diff --git"))
      assert_true(d.contains("+ok"))
    }
    Err(e) => fail(e)
  }
  match gh.create_comment(pr_number=42, body="LGTM after fix") {
    Ok(c) => {
      assert_eq(c.pr, "42")
      assert_eq(c.body, "LGTM after fix")
    }
    Err(e) => fail(e)
  }
  assert_eq(gh.comment_count(), 1)
  match gh.read_diff(pr_number=99) {
    Err(m) => assert_true(m.contains("99") || m.contains("no diff"))
    Ok(_) => fail("missing PR diff must Err")
  }
}
