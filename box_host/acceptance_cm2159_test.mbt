///|
/// K-batch P0: CM-2159 — working_directory param takes effect as cwd.

///|
test "acceptance_CM-2159_working_directory_param_effective" {
  let host = @box_host.HostAbi::mock()
  let custom = "/workspace/project-k/subdir"
  let req = @box_host.ShellRequest::{
    command: "pwd",
    working_directory: Some(custom),
    block_until_ms: 1000,
    machine_id: None,
  }
  assert_eq(req.effective_cwd(), custom)
  let r = host.shell(req)
  assert_eq(r.cwd, custom)
  assert_true(r.stdout.contains("cwd=" + custom))
  match host.job_cwd(r.job_id) {
    Some(cwd) => assert_eq(cwd, custom)
    None => fail("job cwd must be recorded")
  }
  // Default when omitted → box workspace.
  let r2 = host.shell(@box_host.ShellRequest::on_box("echo default"))
  assert_eq(r2.cwd, "/workspace")
  assert_eq(@box_host.ShellRequest::on_box("x").effective_cwd(), "/workspace")
}
