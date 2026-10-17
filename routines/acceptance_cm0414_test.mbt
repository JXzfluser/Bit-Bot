///|
/// CM-0414: self-expire / terminal delete after PR merged/closed or timed watch ends.
test "acceptance_CM-0414_terminal_state_auto_delete" {
  let store = @routines.RoutineStore::empty()
  match
    store.create(
      @routines.pr_babysit_default_package(
        routine_id="watch-pr-9",
        pr_ref="org/app#9",
      ),
    ) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_true(store.get("watch-pr-9") is Some(_))
  // Open → still present.
  match store.on_pr_terminal_wake("watch-pr-9", @routines.Open) {
    Ok(false) => assert_true(store.get("watch-pr-9") is Some(_))
    Ok(true) => fail("Open must not delete")
    Err(e) => fail(e)
  }
  // Merged → terminal wake → routine gone.
  match store.on_pr_terminal_wake("watch-pr-9", @routines.Merged) {
    Ok(true) => assert_true(store.get("watch-pr-9") is None)
    Ok(false) => fail("Merged must delete")
    Err(e) => fail(e)
  }
  // Recreate; Closed → gone.
  match
    store.create(
      @routines.pr_babysit_default_package(
        routine_id="watch-pr-10",
        pr_ref="org/app#10",
      ),
    ) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match store.on_terminal_wake("watch-pr-10", @routines.PrClosed) {
    Ok(_) => assert_true(store.get("watch-pr-10") is None)
    Err(e) => fail(e)
  }
  // Timed watch end → gone after expiry.
  match
    store.create(@routines.RoutineSpec::{
      id: "timed-watch-1",
      name: "timed",
      prompt: "watch for 1h",
      trigger: @routines.Event(name="watch:timed"),
      timing: @routines.Exact,
      enabled: true,
      early_minutes: 0,
      late_minutes: 0,
    }) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  let watch = @routines.TimedWatch::{
    routine_id: "timed-watch-1",
    expires_at_ms: 1000,
  }
  match store.apply_timed_watch_end(watch, 500) {
    Ok(false) => assert_true(store.get("timed-watch-1") is Some(_))
    Ok(true) => fail("not yet expired")
    Err(e) => fail(e)
  }
  match store.apply_timed_watch_end(watch, 1000) {
    Ok(true) => assert_true(store.get("timed-watch-1") is None)
    Ok(false) => fail("expired watch must delete")
    Err(e) => fail(e)
  }
}
