///|
/// J-batch P0: CM-2134 — NeedsGrant refuse then grant-flow recovery.

///|
test "acceptance_CM-2134_needs_grant_refuse_then_grant_flow" {
  let cat = @tools.DynamicCatalog::seed_example()
  let _ = cat.discover(ns=Some("user-Gmail"))
  let call = @tools.DynamicCall::{
    namespace_: "user-Gmail",
    name: "search_threads",
    arguments_json: "{}",
    write_to_file: false,
  }
  let session = @tools.GrantSession::new(
    namespace_="user-Gmail",
    status=@connectors.NeedsGrant,
  )
  // Call while NeedsGrant → refuse + grant card.
  match session.call(cat, call) {
    @tools.Blocked(reason~) => {
      assert_true(
        reason.contains("grant_flow") || reason.contains("needsGrant"),
      )
      assert_true(session.refused_before_grant)
      assert_true(session.grant_card_shown)
    }
    _ => fail("NeedsGrant must refuse call")
  }
  match session.current_step() {
    @tools.GrantCardPending(_) | @tools.RefusedNeedsGrant(_) => ()
    _ => fail("expected grant pending / refused step")
  }
  // User grants → Ready → call proceeds.
  let step = session.user_grants()
  assert_true(step is @tools.GrantedReady(_))
  match session.call(cat, call) {
    @tools.Ok(_) => ()
    @tools.Blocked(reason~) => fail("after grant must proceed: " + reason)
    @tools.Err(message~) => fail("after grant must proceed: " + message)
    @tools.PendingApproval(_) => fail("after grant must not pending")
  }
}
