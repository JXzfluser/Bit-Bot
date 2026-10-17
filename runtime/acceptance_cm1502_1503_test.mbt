///|
/// CM-1502: high-risk Destructive / irreversible Shell / CloudAgent → Deny|NeedUser
/// with non-empty reason mentioning high-risk/blocked/class.
test "acceptance_CM-1502_autoreview_blocks_high_risk" {
  let gate = @security.ApprovalGate::strict()
  let dest = @security.ApprovalRequest::{
    id: "rm-rf",
    class_: @security.Destructive,
    summary: "rm -rf /",
    payload_json: "{\"cmd\":\"rm -rf /\"}",
    irreversible: true,
  }
  match gate.review(dest) {
    @security.Deny(reason~) => {
      assert_true(reason.length() > 0)
      assert_true(
        reason.contains("high-risk") ||
        reason.contains("blocked") ||
        reason.contains("Destructive"),
      )
    }
    @security.NeedUser(reason~) => {
      assert_true(reason.length() > 0)
      assert_true(
        reason.contains("high-risk") ||
        reason.contains("blocked") ||
        reason.contains("Destructive"),
      )
    }
    _ => fail("Destructive must Deny or NeedUser with reason")
  }

  let irr_shell = @security.ApprovalRequest::{
    id: "shell-irr",
    class_: @security.Shell,
    summary: "drop table",
    payload_json: "{\"cmd\":\"drop\"}",
    irreversible: true,
  }
  match gate.review(irr_shell) {
    @security.Deny(reason~) => {
      assert_true(reason.length() > 0)
      assert_true(
        reason.contains("high-risk") ||
        reason.contains("blocked") ||
        reason.contains("Shell"),
      )
    }
    @security.NeedUser(reason~) => assert_true(reason.length() > 0)
    _ => fail("irreversible Shell must Deny or NeedUser")
  }

  let danger_cloud = @security.ApprovalRequest::{
    id: "cloud-danger",
    class_: @security.CloudAgent,
    summary: "force push main",
    payload_json: "{\"action\":\"force-push\"}",
    irreversible: true,
  }
  match gate.review(danger_cloud) {
    @security.Deny(reason~) => {
      assert_true(reason.length() > 0)
      assert_true(
        reason.contains("high-risk") ||
        reason.contains("blocked") ||
        reason.contains("CloudAgent"),
      )
    }
    @security.NeedUser(reason~) => assert_true(reason.length() > 0)
    _ => fail("dangerous CloudAgent must Deny or NeedUser")
  }
}

///|
/// CM-1503: same fingerprint → Allow after user_approved; rewrite/bypass → Deny.
test "acceptance_CM-1503_smart_mode_same_action_only" {
  let gate = @security.ApprovalGate::strict()
  let req = @security.ApprovalRequest::{
    id: "shell-sm",
    class_: @security.Shell,
    summary: "ls",
    payload_json: "{\"cmd\":\"ls /workspace\"}",
    irreversible: false,
  }
  let pending = match @runtime.capture_need_user(gate, req) {
    Some(p) => p
    None => fail("strict shell should NeedUser")
  }
  match
    @runtime.smart_mode_resume(
      pending, "shell-sm", "{\"cmd\":\"ls /workspace\"}", true,
    ) {
    @security.Allow => ()
    _ => fail("same fingerprint must Allow after user_approved")
  }
  // Rewritten payload / encoded bypass → Deny with rewrite/bypass mention.
  let b64ish = "{\"cmd\":\"bHM=\"}" // different payload (base64-ish rewrite of intent)
  match @runtime.smart_mode_resume(pending, "shell-sm", b64ish, true) {
    @security.Deny(reason~) =>
      assert_true(
        reason.contains("rewrite") ||
        reason.contains("bypass") ||
        reason.contains("rewritten"),
      )
    _ => fail("rewritten/encoded bypass must Deny")
  }
  match
    @runtime.smart_mode_resume(
      pending, "shell-sm", "{\"cmd\":\"rm -rf /\"}", true,
    ) {
    @security.Deny(reason~) =>
      assert_true(reason.contains("rewrite") || reason.contains("bypass"))
    _ => fail("different cmd must Deny")
  }
}
