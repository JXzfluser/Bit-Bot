///|
/// CM-0415: creating/updating routine may need confirm card;
/// user deny → do not rewrite-retry same write; tool result reflects denial.
test "acceptance_CM-0415_routine_create_confirm_card_no_retry_on_deny" {
  let store = @routines.RoutineStore::empty()
  let gate = @routines.ConfirmCardGate::new()
  let spec = @routines.RoutineSpec::{
    id: "r-confirm",
    name: "needs confirm",
    prompt: "Do the thing\nDestination: in-app; stay silent if empty.",
    trigger: @routines.Cron(expr="@daily"),
    timing: @routines.Exact,
    enabled: true,
    early_minutes: 0,
    late_minutes: 0,
  }
  // Deny → tool result denied; routine not created.
  let denied = store.create_with_confirm(gate, spec, @routines.Deny)
  assert_false(denied.ok)
  assert_true(denied.denied)
  assert_true(
    denied.message.contains("denied") || denied.message.contains("confirm"),
  )
  assert_true(store.get("r-confirm") is None)
  // Rewrite-retry same write → refused.
  let retry = store.create_with_confirm(gate, spec, @routines.Approve)
  assert_false(retry.ok)
  assert_true(retry.denied)
  assert_true(
    retry.message.contains("rewrite-retry") ||
    retry.message.contains("refused") ||
    retry.message.contains("denied"),
  )
  assert_true(store.get("r-confirm") is None)
  // Fresh gate + Approve → created; tool result ok.
  let gate2 = @routines.ConfirmCardGate::new()
  let ok = store.create_with_confirm(gate2, spec, @routines.Approve)
  assert_true(ok.ok)
  assert_false(ok.denied)
  assert_true(store.get("r-confirm") is Some(_))
}
