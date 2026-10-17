///|
/// CM-2172: Teammate permission boundary — no unauthorized outbound; Given no overreach When acceptance Then reuse approval/gate.
test "acceptance_CM-2172_teammate_outbound_permission_gate_reuse" {
  let gate = @security.ApprovalGate::default()
  let no_auth = @security.TeammateOutboundRequest::{
    teammate_id: "helper-bot",
    channel: "slack",
    summary: "post standup summary",
    draft_body: "Standup: all green.",
    explicit_user_authorization: false,
  }
  // Without overreach → gate reuse → DraftOnly (not Allow / not silent send).
  match @security.plan_teammate_outbound(gate, no_auth) {
    @security.Gated(outcome~) => {
      assert_true(outcome.is_draft_only())
      assert_false(outcome.is_allow())
    }
    @security.UnauthorizedBypass(_) => fail("must reuse ApprovalGate")
  }
  match @security.assert_teammate_no_unauthorized_outbound(gate, no_auth) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  // Bypass path is forbidden.
  match @security.teammate_try_outbound_bypass(no_auth) {
    @security.UnauthorizedBypass(reason~) => {
      assert_true(reason.contains("ApprovalGate") || reason.contains("bypass"))
      assert_false(
        @security.TeammateOutboundVerdict::UnauthorizedBypass(reason~).reused_approval_gate(),
      )
    }
    @security.Gated(_) => fail("bypass must not look like gate reuse")
  }
  // Explicit authorization still goes through the same gate (Escalate, not auto-Allow).
  let with_auth = @security.TeammateOutboundRequest::{
    teammate_id: "helper-bot",
    channel: "email",
    summary: "send invoice",
    draft_body: "Please find the invoice.",
    explicit_user_authorization: true,
  }
  match @security.plan_teammate_outbound(gate, with_auth) {
    @security.Gated(outcome~) => {
      assert_true(
        @security.TeammateOutboundVerdict::Gated(outcome~).reused_approval_gate(),
      )
      assert_false(outcome.is_allow())
      match outcome {
        @security.Escalate => ()
        @security.DraftOnly(_) => fail("explicit auth should leave DraftOnly")
        @security.NeedUser(_) => ()
        @security.Allow =>
          fail("must not auto-Allow irreversible teammate send")
      }
    }
    @security.UnauthorizedBypass(_) => fail("must reuse gate")
  }
}
