///|
/// CM-2158: box package install (apt/npm/…) via Shell only (kernel-contract).
test "acceptance_CM-2158_box_package_install_via_shell" {
  match @box_host.reject_non_shell_package_install("direct-apt-api") {
    Err(m) => assert_true(m.contains("Shell") || m.contains("shell"))
    Ok(_) => fail("non-Shell install must be refused")
  }
  match @box_host.reject_non_shell_package_install("Shell") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match @box_host.plan_box_package_install(@box_host.Apt, ["ripgrep", "jq"]) {
    Err(e) => fail(e)
    Ok(req) => {
      assert_true(req.command.contains("apt-get install"))
      assert_true(req.command.contains("ripgrep"))
      assert_eq(req.machine_id, None)
    }
  }
  match @box_host.plan_box_package_install(@box_host.Npm, ["typescript"]) {
    Ok(req) => assert_true(req.command.contains("npm install"))
    Err(e) => fail(e)
  }
  let host = @box_host.HostAbi::mock()
  match @box_host.install_box_package_via_shell(host, @box_host.Apt, ["curl"]) {
    Err(e) => fail(e)
    Ok(r) => {
      assert_true(r.completed)
      assert_true(r.stdout.contains("apt-get") || r.stdout.contains("curl"))
      assert_eq(r.cwd, "/workspace")
      // Went through Shell effect log.
      let mut saw_shell = false
      for e in host.effects {
        if e.has_prefix("shell:") {
          saw_shell = true
        }
      }
      assert_true(saw_shell)
    }
  }
  match
    @box_host.install_box_package_via_shell(host, @box_host.Npm, ["eslint"]) {
    Ok(r) =>
      assert_true(r.stdout.contains("npm") || r.stdout.contains("eslint"))
    Err(e) => fail(e)
  }
  match @box_host.plan_box_package_install(@box_host.Pip, []) {
    Err(m) => assert_true(m.contains("empty"))
    Ok(_) => fail("empty package list must Err")
  }
}
