///|
/// CM-1802: no payment without explicit ask; payment requires user present;
/// credentials not in transcript.
test "acceptance_CM-1802_purchases_require_explicit_user" {
  let gate = @commerce.PurchaseGate::new()
  let req = @commerce.PurchaseRequest::{
    item: "concert-ticket",
    amount_cents: 12000,
    payment_credential: "CARD-TOKEN-SECRET-XYZ",
  }
  // No explicit ask → no payment.
  match gate.attempt_purchase(req, explicit_user_ask=false, user_present=true) {
    @commerce.DraftOnly(_) => ()
    @commerce.Paid(_) => fail("must not pay without explicit ask")
    @commerce.NeedUserPresent(_) =>
      fail("expected DraftOnly without explicit ask")
    @commerce.Blocked(_) => fail("expected DraftOnly without explicit ask")
  }
  // Explicit but user not present → NeedUserPresent, not Paid.
  match gate.attempt_purchase(req, explicit_user_ask=true, user_present=false) {
    @commerce.NeedUserPresent(reason~) =>
      assert_true(reason.contains("present"))
    @commerce.Paid(_) => fail("must not pay without user present")
    @commerce.DraftOnly(_) => fail("expected NeedUserPresent")
    @commerce.Blocked(_) => fail("expected NeedUserPresent")
  }
  // Explicit + user present → Paid.
  match gate.attempt_purchase(req, explicit_user_ask=true, user_present=true) {
    @commerce.Paid(receipt~) => assert_true(receipt.contains("concert-ticket"))
    @commerce.DraftOnly(_) => fail("expected Paid when explicit+present")
    @commerce.NeedUserPresent(_) => fail("expected Paid when explicit+present")
    @commerce.Blocked(_) => fail("expected Paid when explicit+present")
  }
  // Credentials never in transcript.
  assert_false(gate.transcript_contains_credential("CARD-TOKEN-SECRET-XYZ"))
  for line in gate.transcript_log {
    assert_false(line.contains("CARD-TOKEN-SECRET-XYZ"))
  }
}
