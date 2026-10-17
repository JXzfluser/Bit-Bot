///|
/// CM-2155: Origin trigger — only pr-opened / pushed / merged / comment allowed.
test "acceptance_CM-2155_origin_trigger_event_subset_only" {
  let allowed = @routines.allowed_origin_trigger_events()
  assert_eq(allowed.length(), 4)
  assert_true(@routines.is_canonical_origin_trigger_event("pr-opened"))
  assert_true(@routines.is_canonical_origin_trigger_event("pushed"))
  assert_true(@routines.is_canonical_origin_trigger_event("merged"))
  assert_true(@routines.is_canonical_origin_trigger_event("comment"))
  assert_false(@routines.is_canonical_origin_trigger_event("ci"))
  assert_false(@routines.is_canonical_origin_trigger_event("review"))
  assert_false(@routines.is_canonical_origin_trigger_event("issue-opened"))
  for e in allowed {
    match @routines.validate_origin_trigger_event(e) {
      Ok(_) => ()
      Err(err) => fail(err)
    }
  }
  match
    @routines.register_origin_trigger_event(
      repo="org/native",
      event="pr-opened",
    ) {
    Ok(ev) => assert_eq(ev.label(), "pr-opened")
    Err(e) => fail(e)
  }
  match
    @routines.register_origin_trigger_event(repo="org/native", event="pushed") {
    Ok(ev) => assert_eq(ev, @routines.Pushed)
    Err(e) => fail(e)
  }
  match
    @routines.register_origin_trigger_event(repo="org/native", event="merged") {
    Ok(ev) => assert_eq(ev.label(), "merged")
    Err(e) => fail(e)
  }
  match
    @routines.register_origin_trigger_event(repo="org/native", event="comment") {
    Ok(ev) => assert_eq(ev.label(), "comment")
    Err(e) => fail(e)
  }
  // Outside subset → Err.
  match @routines.validate_origin_trigger_event("ci") {
    Err(m) => assert_true(m.contains("subset") || m.contains("pr-opened"))
    Ok(_) => fail("ci must be rejected")
  }
  match @routines.validate_origin_trigger_event("review") {
    Err(_) => ()
    Ok(_) => fail("review must be rejected")
  }
  match @routines.validate_origin_trigger_event("issue-opened") {
    Err(_) => ()
    Ok(_) => fail("issue-opened must be rejected")
  }
  match
    @routines.register_origin_trigger_event(
      repo="org/native",
      event="workflow_run",
    ) {
    Err(m) => assert_true(m.contains("subset") || m.contains("not in"))
    Ok(_) => fail("workflow_run must be rejected")
  }
}
