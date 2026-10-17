///|
/// CM-2174: same box shared FS across agents; CHARTER consistent (kernel-contract).
test "acceptance_CM-2174_cross_agent_shared_box_fs_charter" {
  assert_true(@box_host.charter_shared_box_fs())
  assert_true(@box_host.charter_distinct_desktops())
  let host = @box_host.HostAbi::mock()
  let check = host.check_cross_agent_shared_box_charter()
  assert_true(check.is_charter_consistent())
  assert_true(check.shared_fs)
  assert_true(check.distinct_desktops)
  assert_true(check.agent_a_sees_agent_b_write)
  assert_true(check.desktop_a_display != check.desktop_b_display)
  // Second host instance is a different machine mock — still internally shared.
  let host2 = @box_host.HostAbi::mock()
  host2.write("/workspace/only-host2.txt", "solo")
  match host.read("/workspace/only-host2.txt") {
    Err(_) => ()
    Ok(_) => fail("distinct HostAbi mocks must not share FS across instances")
  }
  match host2.read("/workspace/only-host2.txt") {
    Ok(r) => assert_true(r.text.contains("solo"))
    Err(e) => fail(e)
  }
}
