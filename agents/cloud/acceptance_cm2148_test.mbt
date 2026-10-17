///|
/// CM-2148: Cloud artifact path — do NOT attach /opt/cursor/artifacts directly;
/// deliver workspace copy or official URL.
test "acceptance_CM-2148_cloud_artifact_path_no_opt_cursor_direct" {
  assert_true(
    @cloud.is_forbidden_opt_cursor_artifacts(
      "/opt/cursor/artifacts/run-1/out.bin",
    ),
  )
  assert_true(@cloud.is_forbidden_opt_cursor_artifacts("/opt/cursor/artifacts"))
  assert_false(
    @cloud.is_forbidden_opt_cursor_artifacts(
      "/workspace/cloud-agent-artifacts/bc-1/out.bin",
    ),
  )
  match @cloud.reject_direct_opt_cursor_attach("/opt/cursor/artifacts/x") {
    Err(m) =>
      assert_true(m.contains("opt/cursor/artifacts") || m.contains("forbidden"))
    Ok(_) => fail("direct opt attach must Err")
  }
  // Source under opt without official URL → Err (no direct attach).
  match
    @cloud.deliver_cloud_artifact(
      "bc-2148", "/opt/cursor/artifacts/bc-2148/report.pdf",
    ) {
    Err(m) =>
      assert_true(
        m.contains("opt/cursor/artifacts") || m.contains("workspace copy"),
      )
    Ok(_) => fail("opt source without URL must not deliver as attach")
  }
  // Official URL escape hatch when source was under opt.
  match
    @cloud.deliver_cloud_artifact(
      "bc-2148",
      "/opt/cursor/artifacts/bc-2148/report.pdf",
      official_url=Some("https://cursor.com/agents/bc-2148"),
    ) {
    Err(e) => fail(e)
    Ok(d) => {
      assert_false(d.is_workspace_copy())
      assert_eq(d.path_or_url(), "https://cursor.com/agents/bc-2148")
    }
  }
  // Non-opt source → workspace copy under cloud-agent-artifacts.
  match
    @cloud.deliver_cloud_artifact("bc-2148", "/tmp/host-staging/report.pdf") {
    Err(e) => fail(e)
    Ok(d) => {
      assert_true(d.is_workspace_copy())
      let p = d.path_or_url()
      assert_true(p.has_prefix(@cloud.CLOUD_AGENT_ARTIFACTS_ROOT + "/"))
      assert_true(p.contains("bc-2148"))
      assert_true(p.has_suffix("report.pdf"))
      assert_false(p.has_prefix("/opt/cursor/artifacts"))
    }
  }
  assert_eq(
    @cloud.cloud_artifact_workspace_copy_path("bc-9", "a.bin"),
    "/workspace/cloud-agent-artifacts/bc-9/a.bin",
  )
}
