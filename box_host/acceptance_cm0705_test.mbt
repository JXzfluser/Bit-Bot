///|
/// CM-0705: phone deviceLocalTools + permission states; needs_permission → approval card.
test "acceptance_CM-0705_device_local_tools_needs_permission_card" {
  let machines = @box_host.MachineRegistry::seed()
  let devices = @box_host.DeviceLocalToolsRegistry::seed_phones()

  // Desktop → no deviceLocalTools
  let desk_tools = machines.device_local_tools_for(devices, "desk-1")
  assert_eq(desk_tools.length(), 0)

  // iOS lists tools with permission states
  let ios_tools = machines.device_local_tools_for(devices, "phone-ios")
  assert_true(ios_tools.length() >= 2)
  let mut saw_needs = false
  let mut saw_ready = false
  for t in ios_tools {
    match t.permission {
      @box_host.NeedsPermission => {
        saw_needs = true
        assert_eq(t.permission.label(), "needs_permission")
      }
      @box_host.Ready => {
        saw_ready = true
        assert_eq(t.permission.label(), "ready")
      }
      @box_host.Denied => assert_eq(t.permission.label(), "denied")
      @box_host.Unavailable => assert_eq(t.permission.label(), "unavailable")
    }
  }
  assert_true(saw_needs)
  assert_true(saw_ready)

  // Android also listed
  let and_tools = machines.device_local_tools_for(devices, "phone-android")
  assert_true(and_tools.length() >= 1)

  // needs_permission → approval card
  match devices.invoke("phone-ios", "camera") {
    Err(card) => {
      assert_true(card.is_approval_card())
      assert_true(card.shown)
      assert_eq(card.tool_name, "camera")
      assert_eq(card.permission_label, "needs_permission")
      assert_eq(card.machine_id, "phone-ios")
    }
    Ok(_) => fail("needs_permission must show approval card")
  }
  match devices.last_card() {
    Some(c) => assert_true(c.is_approval_card())
    None => fail("card must be recorded")
  }

  // ready → Ok, no card
  match devices.invoke("phone-ios", "photos") {
    Ok(out) => assert_true(out.contains("photos"))
    Err(_) => fail("ready tool must succeed")
  }

  // denied → Err without approval card shown
  match devices.invoke("phone-ios", "location") {
    Err(card) => {
      assert_false(card.is_approval_card())
      assert_eq(card.permission_label, "denied")
    }
    Ok(_) => fail("denied must Err")
  }
}
