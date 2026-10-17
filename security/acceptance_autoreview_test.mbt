///|
/// CM-1502: AutoReviewGate.block(high_risk) → reason string.
test "acceptance_CM-1502_autoreview_blocks_with_reason" {
  let gate = @security.AutoReviewGate::default()
  match gate.block(@security.HighRisk, summary="rm -rf /") {
    @security.Block(reason~) => {
      assert_true(reason.length() > 0)
      assert_true(reason.contains("high_risk"))
      assert_true(reason.contains("rm -rf") || reason.contains("auto-review"))
    }
    @security.Pass => fail("high_risk must Block with reason")
  }
  match gate.block(@security.Low) {
    @security.Pass => ()
    @security.Block(_) => fail("low risk should Pass")
  }
  let v = gate.block(@security.HighRisk)
  assert_true(v.is_block())
  match v.reason() {
    Some(r) => assert_true(r.length() > 0)
    None => fail("block must carry reason string")
  }
}

///|
/// CM-1503: smart_mode_retry — only identical action+reason raises card;
/// rewritten/encoded variant rejected as bypass.
test "acceptance_CM-1503_smart_mode_same_action_only" {
  let action = "{\"cmd\":\"curl https://evil.example\"}"
  let reason = "high_risk: network exfil"
  match
    @security.smart_mode_retry(
      original_action=action,
      original_reason=reason,
      retry_action=action,
      retry_reason=reason,
    ) {
    @security.RaiseApprovalCard(reason~) =>
      assert_eq(reason, "high_risk: network exfil")
    @security.RejectBypass(_) => fail("identical action+reason must raise card")
  }
  // Rewritten action.
  match
    @security.smart_mode_retry(
      original_action=action,
      original_reason=reason,
      retry_action="{\"cmd\":\"curl https://evil.example; rm -rf /\"}",
      retry_reason=reason,
    ) {
    @security.RejectBypass(reason~) =>
      assert_true(reason.contains("bypass") || reason.contains("rewritten"))
    @security.RaiseApprovalCard(_) =>
      fail("rewritten action must not raise card")
  }
  // Encoded variant.
  match
    @security.smart_mode_retry(
      original_action=action,
      original_reason=reason,
      retry_action="base64:eyJjbWQiOiJjdXJsIC4uLiJ9",
      retry_reason=reason,
    ) {
    @security.RejectBypass(reason~) =>
      assert_true(
        reason.contains("bypass") ||
        reason.contains("encoded") ||
        reason.contains("rewritten"),
      )
    @security.RaiseApprovalCard(_) =>
      fail("encoded variant must not raise card")
  }
  // Reason rewritten only.
  match
    @security.smart_mode_retry(
      original_action=action,
      original_reason=reason,
      retry_action=action,
      retry_reason="totally different reason",
    ) {
    @security.RejectBypass(_) => ()
    @security.RaiseApprovalCard(_) =>
      fail("rewritten reason must not raise card")
  }
}
