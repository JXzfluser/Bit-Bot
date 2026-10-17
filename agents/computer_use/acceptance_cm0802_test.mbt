///|
/// CM-0802: browser via box-chrome not bare chrome; documented launch path; lockfile diagnosable.
test "acceptance_CM-0802_box_chrome_launcher_not_bare" {
  let host = @box_host.HostAbi::mock()
  let documented = @computer_use.computer_use_browser_launch_path()
  assert_true(documented.contains("box-chrome"))
  assert_false(documented == "chrome")
  assert_eq(documented, @box_host.documented_box_chrome_path())
  // Bare chrome rejected at Host.
  match host.launch_browser(@box_host.BareChrome) {
    Err(msg) =>
      assert_true(
        msg.contains("box-chrome") ||
        msg.contains("bare") ||
        msg.contains("forbidden"),
      )
    Ok(_) => fail("bare chrome must be rejected")
  }
  match @computer_use.computer_use_launch_browser(host) {
    Err(e) => fail(e)
    Ok(launch) => {
      assert_true(launch.via_box_chrome)
      assert_true(launch.rejected_bare)
      assert_true(launch.launch_path.contains("box-chrome"))
      assert_true(launch.lockfile_diagnosable)
    }
  }
  match host.diagnose_box_chrome_lockfile() {
    Ok(body) => {
      assert_true(body.contains("pid="))
      assert_true(body.contains("status="))
    }
    Err(e) => fail(e)
  }
}
