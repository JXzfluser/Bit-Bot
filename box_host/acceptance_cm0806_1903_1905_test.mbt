///|
/// L-batch P0: CM-0806 login persist, CM-1903 two-step Update, CM-1905 local-execution off.

///|
/// CM-0806: After Update Computer, cookie/logins still present (software may need reinstall).
test "acceptance_CM-0806_login_persist_after_update" {
  let host = @box_host.HostAbi::mock()
  host.seed_session_login(domain="example.test", cookie="sess-cookie-mock-0806")
  host.mark_software_installed()
  host.fs.set("/workspace/notes.txt", "keep-me")
  assert_true(host.has_session_login(domain="example.test"))
  assert_true(host.software_installed)
  let flow = @box_host.UpdateComputerFlow::prefer_guide()
  let _ = flow.confirm_step()
  let _ = flow.confirm_step()
  match host.update_computer(flow=Some(flow)) {
    Ok(ev) => {
      assert_true(ev.session_jar_intact)
      assert_true(ev.software_needs_reinstall)
      assert_true(ev.files_preserved)
      assert_true(ev.two_step_confirmed)
    }
    Err(e) => fail(e)
  }
  assert_true(
    host.session_jar_intact(
      domain="example.test",
      expected_cookie="sess-cookie-mock-0806",
    ),
  )
  assert_false(host.software_installed)
  match host.fs.get("/workspace/notes.txt") {
    Some(c) => assert_eq(c, "keep-me")
    None => fail("workspace files must persist across Update")
  }
}

///|
/// CM-1903: Update Bot's Computer — two-step confirm; guide preferred over Reset.
test "acceptance_CM-1903_update_computer_two_step_prefer_guide" {
  let host = @box_host.HostAbi::mock()
  host.seed_session_login(domain="box.local", cookie="login-1903")
  let flow = @box_host.UpdateComputerFlow::prefer_guide()
  assert_true(flow.guide_before_reset())
  // One step insufficient.
  let _ = flow.confirm_step()
  assert_false(flow.two_step_ready())
  match host.update_computer(flow=Some(flow)) {
    Err(msg) => assert_true(msg.contains("two-step") || msg.contains("confirm"))
    Ok(_) => fail("Update must require two confirmation steps")
  }
  // Second step unlocks Update.
  let _ = flow.confirm_step()
  assert_true(flow.two_step_ready())
  match host.update_computer(flow=Some(flow)) {
    Ok(ev) => {
      assert_true(ev.two_step_confirmed)
      assert_true(ev.guide_before_reset)
      assert_true(ev.session_jar_intact)
    }
    Err(e) => fail(e)
  }
  // Reset-first preference refused.
  let reset_flow = @box_host.UpdateComputerFlow::prefer_reset()
  let _ = reset_flow.confirm_step()
  let _ = reset_flow.confirm_step()
  assert_false(reset_flow.guide_before_reset())
  match host.update_computer(flow=Some(reset_flow)) {
    Err(msg) =>
      assert_true(
        msg.contains("guide") ||
        msg.contains("Reset") ||
        msg.contains("preferred"),
      )
    Ok(_) => fail("Reset-first path must be refused; guide preferred")
  }
}

///|
/// CM-1905: local-execution setting off → machine-targeted calls rejected.
test "acceptance_CM-1905_local_execution_off_rejects_machine" {
  let reg = @box_host.MachineRegistry::seed()
  assert_true(reg.local_execution_on())
  // On: approved call works.
  match reg.run_on_machine("desk-1", "echo on", approved=true) {
    Ok(out) => assert_true(out.contains("desk-1"))
    Err(e) => fail(e)
  }
  reg.set_local_execution(enabled=false)
  assert_false(reg.local_execution_on())
  match reg.run_on_machine("desk-1", "echo off", approved=true) {
    Err(msg) =>
      assert_true(msg.contains("local-execution") || msg.contains("rejected"))
    Ok(_) => fail("machine shell must reject when local-execution off")
  }
  let mut saw_rejected = false
  let mut saw_execute_off = false
  for e in reg.effects {
    if e.has_prefix("rejected_local_off:") {
      saw_rejected = true
    }
    if e.contains("executed:desk-1:echo off") {
      saw_execute_off = true
    }
  }
  assert_true(saw_rejected)
  assert_false(saw_execute_off)
  match reg.read_on_machine("desk-1", "/tmp/x", approved=true) {
    Err(msg) =>
      assert_true(msg.contains("local-execution") || msg.contains("rejected"))
    Ok(_) => fail("machine read must reject when local-execution off")
  }
  // Re-enable restores machine targeting.
  reg.set_local_execution(enabled=true)
  match reg.run_on_machine("desk-1", "echo again", approved=true) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
}
