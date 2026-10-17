///|
test "smart mode allows same fingerprint only" {
  let gate = @security.ApprovalGate::strict()
  let req = @security.ApprovalRequest::{
    id: "shell-1",
    class_: @security.Shell,
    summary: "ls",
    payload_json: "{\"cmd\":\"ls\"}",
    irreversible: false,
  }
  let pending = @runtime.capture_need_user(gate, req).unwrap()
  assert_true(pending.block_reason.has_prefix("shell"))
  match
    @runtime.smart_mode_resume(pending, "shell-1", "{\"cmd\":\"ls\"}", true) {
    @security.Allow => ()
    _ => fail("same fingerprint should allow")
  }
  match
    @runtime.smart_mode_resume(pending, "shell-1", "{\"cmd\":\"rm -rf\"}", true) {
    @security.Deny(_) => ()
    _ => fail("rewritten payload must deny")
  }
}
