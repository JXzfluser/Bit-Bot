///|
/// CM-0804: RequestUserForm targets from snapshot; failed submit no blind same-form retry.
test "acceptance_CM-0804_user_form_snapshot_no_blind_retry" {
  let snap = @ui_protocol.UserFormSnapshot::{
    form_id: "login-form",
    page_url: "https://example.com/login",
    snapshot_rev: "rev-1",
    targets: [
      { field_id: "user", snapshot_node_id: "n-12", label: "Username", },
      { field_id: "pass", snapshot_node_id: "n-13", label: "Password", },
    ],
  }
  match @ui_protocol.request_user_form_from_snapshot(snap) {
    Ok(targets) => {
      assert_eq(targets.length(), 2)
      assert_eq(targets[0].snapshot_node_id, "n-12")
    }
    Err(e) => fail(e)
  }
  let empty = @ui_protocol.UserFormSnapshot::{
    form_id: "empty",
    page_url: "https://example.com",
    snapshot_rev: "r0",
    targets: [],
  }
  assert_true(@ui_protocol.request_user_form_from_snapshot(empty) is Err(_))

  let gate = @ui_protocol.UserFormGate::new()
  match gate.submit(snap, @ui_protocol.Failed(reason="otp invalid")) {
    Err(m) => assert_true(m.contains("failed"))
    Ok(_) => fail("failed submit must Err")
  }
  // Blind retry of the same form fingerprint must be refused.
  match gate.submit(snap, @ui_protocol.Submitted) {
    Err(m) => assert_true(m.contains("blind-retry") || m.contains("same form"))
    Ok(_) => fail("blind retry of same form must be refused")
  }
  // A new snapshot revision may be attempted.
  let snap2 = @ui_protocol.UserFormSnapshot::{
    form_id: "login-form",
    page_url: "https://example.com/login",
    snapshot_rev: "rev-2",
    targets: [
      { field_id: "user", snapshot_node_id: "n-20", label: "Username", },
    ],
  }
  match gate.submit(snap2, @ui_protocol.Submitted) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
}
