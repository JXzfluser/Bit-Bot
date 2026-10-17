///|
/// K-batch P0: CM-2162 approval bubble, CM-2169 agent inbox, CM-2170 safer path ≠ bypass.

///|
test "acceptance_CM-2162_child_approval_bubbles_to_parent" {
  let report = @security.NeedApprovalReport::make(
    child_id="ex-child-k2162",
    request_id="shell-elevated-1",
    summary="run elevated shell on user machine",
    class_label="Shell",
  )
  let parent = @security.ParentApprovalView::new()
  let card = @security.bubble_need_approval_to_parent(parent, report)
  assert_true(card.is_visible_to_parent())
  assert_eq(card.child_id, "ex-child-k2162")
  assert_true(
    card.summary.contains("elevated") || card.summary.contains("shell"),
  )
  assert_true(parent.has_visible_for_child("ex-child-k2162"))
  let visible = parent.visible_cards()
  assert_eq(visible.length(), 1)
  assert_eq(visible[0].id, "appr-shell-elevated-1")
  // Second child report also bubbles.
  let r2 = @security.NeedApprovalReport::make(
    child_id="ex-child-k2162b",
    request_id="mcp-mut-2",
    summary="MCP mutation needs approval",
  )
  let _ = parent.observe_child_need_approval(r2)
  assert_eq(parent.visible_cards().length(), 2)
  assert_true(parent.has_visible_for_child("ex-child-k2162b"))
}

///|
test "acceptance_CM-2169_agent_inbox_no_unauthorized_send" {
  let inbox_guard = @security.AgentInboxGuard::executor()
  assert_false(inbox_guard.may_send_from_inbox)
  let draft = @security.AgentInboxDraft::{
    to_: "bob@example.test",
    subject: "Draft only",
    body: "Executor must report this to parent — not send.",
  }
  let outcome = inbox_guard.try_send(draft)
  assert_true(outcome.reported_draft_only())
  assert_false(outcome.sent_unauthorized())
  match outcome {
    @security.ReportDraftToParent(draft~, reason~) => {
      assert_eq(draft.to_, "bob@example.test")
      assert_eq(draft.subject, "Draft only")
      assert_eq(draft.body, "Executor must report this to parent — not send.")
      assert_true(
        reason.contains("report draft") || reason.contains("must not send"),
      )
    }
    @security.Sent(_) => fail("executor must not send from agent inbox")
  }
  match inbox_guard.last_draft_for_parent() {
    Some(d) => assert_eq(d.subject, "Draft only")
    None => fail("draft must be reported to parent")
  }
  assert_eq(inbox_guard.unauthorized_send_attempts, 1)
}

///|
test "acceptance_CM-2170_safer_path_not_bypass_rewrite" {
  let original = "{\"tool\":\"Shell\",\"cmd\":\"cat /workspace/fixture.txt\"}"
  // Legitimate safer path: read-only sanctioned tool, lower privilege.
  let safer = "{\"tool\":\"Read\",\"path\":\"/workspace/notes.txt\"}"
  let kind = @security.classify_adaptation(
    original_action=original,
    adapted_action=safer,
    lowers_privilege=true,
    uses_sanctioned_tool=true,
  )
  assert_true(kind.is_safer_path())
  assert_false(kind.is_bypass())
  match kind {
    @security.SaferLowerPrivilege(note~) => assert_true(note.length() > 0)
    @security.BypassRewrite(_) =>
      fail("lower-privilege Read must be safer path")
  }
  assert_true(
    @security.is_legitimate_safer_path(
      original_action=original,
      adapted_action=safer,
      lowers_privilege=true,
      uses_sanctioned_tool=true,
    ),
  )
  // Bypass: base64 encode same intent.
  let bypass = @security.classify_adaptation(
    original_action=original,
    adapted_action="base64:eyJ0b29sIjoiU2hlbGwifQ==",
    lowers_privilege=false,
  )
  assert_true(bypass.is_bypass())
  assert_false(bypass.is_safer_path())
  match bypass {
    @security.BypassRewrite(reason~) =>
      assert_true(
        reason.contains("bypass") ||
        reason.contains("encode") ||
        reason.contains("rewrite"),
      )
    @security.SaferLowerPrivilege(_) => fail("base64 wrap is bypass, not safer")
  }
  // Bypass: rewrite without lowering privilege.
  let rewritten = @security.classify_adaptation(
    original_action=original,
    adapted_action="{\"tool\":\"Shell\",\"cmd\":\"cat /workspace/fixture.txt; # renamed\"}",
    lowers_privilege=false,
  )
  assert_true(rewritten.is_bypass())
}
