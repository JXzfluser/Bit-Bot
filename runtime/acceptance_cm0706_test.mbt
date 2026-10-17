///|
/// CM-0706: message carries source machineId; unspecified defaults to last-message machine.
test "acceptance_CM-0706_sent_from_machine_default" {
  let session = @runtime.MachineDefaultSession::new()
  assert_eq(session.default_machine(), None)
  // Message carries source machineId.
  let note1 = @runtime.InboundMachineNote::with_machine(
    "desk-1",
    text="[Sent from machine desk-1] run ls",
  )
  match session.ingest(note1) {
    Some(mid) => assert_eq(mid, "desk-1")
    None => fail("carried machineId must be selected")
  }
  assert_eq(session.default_machine(), Some("desk-1"))
  // Unspecified → defaults to last-message machine.
  let note2 = @runtime.InboundMachineNote::unspecified(text="run again")
  match session.ingest(note2) {
    Some(mid) => assert_eq(mid, "desk-1")
    None => fail("unspecified must default to last-message machine")
  }
  match session.resolve_machine_id(None) {
    Some(mid) => assert_eq(mid, "desk-1")
    None => fail("tool omit machineId must use last-message default")
  }
  match session.resolve_machine_id(Some("phone-ios")) {
    Some(mid) => assert_eq(mid, "phone-ios")
    None => fail("explicit machineId must win")
  }
  // New carried id updates default.
  let note3 = @runtime.InboundMachineNote::with_machine("phone-ios")
  let _ = session.ingest(note3)
  assert_eq(session.default_machine(), Some("phone-ios"))
  match session.resolve_machine_id(None) {
    Some(mid) => assert_eq(mid, "phone-ios")
    None => fail("default must follow latest message machine")
  }
}
