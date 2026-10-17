///|
/// L-batch P0: CM-2176 task description ≠ permission; CM-2177 executor draft → parent.

///|
test "acceptance_CM-2176_task_description_not_permission" {
  // Negative: task description / memory / decomposition must NOT grant.
  let weak = [
    @security.TaskDescription,
    @security.MemoryRecall,
    @security.TaskDecomposition,
  ]
  for src in weak {
    assert_false(src.is_valid_approval_source())
    let verdict = @security.evaluate_permission_claim(
      src,
      action_summary="send the invoice email",
    )
    assert_false(verdict.grants_permission())
    match verdict {
      @security.NotPermission(reason~) =>
        assert_true(
          reason.contains("not approval") || reason.contains("explicit"),
        )
      @security.MaySeekApproval =>
        fail(src.label() + " must not count as permission")
    }
    match
      @security.plan_irreversible_from_claim(
        src,
        @security.ExternalSend,
        summary="send invoice",
        draft_body="Please find the invoice attached.",
      ) {
      @security.DraftOnly(_) => ()
      @security.Allow => fail("weak source must not Allow")
      @security.Escalate => fail("weak source must not Escalate as approved")
      @security.NeedUser(_) => fail("weak source should stay DraftOnly")
    }
  }
  // Positive control: explicit user ask may seek approval / escalate path.
  assert_true(@security.ExplicitUserAsk.is_valid_approval_source())
  match
    @security.evaluate_permission_claim(
      @security.ExplicitUserAsk,
      action_summary="send the invoice email",
    ) {
    @security.MaySeekApproval => ()
    @security.NotPermission(_) => fail("explicit ask is valid approval source")
  }
}

///|
test "acceptance_CM-2177_executor_draft_reported_to_parent" {
  let draft = @security.AgentInboxDraft::{
    to_: "alice@example.test",
    subject: "Quarterly report draft",
    body: "Full draft body for parent review — do not send yet. Line2.",
  }
  let msg = @security.executor_report_draft_to_parent(draft)
  assert_true(msg.stopped_at_draft)
  assert_false(msg.sent)
  assert_true(msg.contains_full_draft())
  assert_true(msg.text.contains("alice@example.test"))
  assert_true(msg.text.contains("Quarterly report draft"))
  assert_true(msg.text.contains("Full draft body for parent review"))
  assert_true(msg.text.contains("Line2."))
  // CM-2169 guard still holds when try_send used inside reporter path.
  let inbox_guard = @security.AgentInboxGuard::executor()
  let outcome = inbox_guard.try_send(draft)
  assert_true(outcome.reported_draft_only())
  assert_false(outcome.sent_unauthorized())
}
