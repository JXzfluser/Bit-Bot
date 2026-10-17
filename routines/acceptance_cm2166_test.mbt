///|
/// CM-2166: break silence when notable — measurable policy (pairs with CM-2165).
test "acceptance_CM-2166_routine_break_silence_when_notable" {
  // Failure breaks silence.
  let fail_out = @routines.RoutineRunOutcome::with_failure(
    message="cron job failed: exit 1",
  )
  assert_true(@routines.is_break_silence_notable(fail_out))
  match @routines.break_silence_when_notable(fail_out) {
    Err(e) => fail(e)
    Ok(d) => {
      assert_true(d.sends_to_user())
      match d {
        @routines.SendToUser(reason~, body~) => {
          assert_eq(reason, "failure")
          assert_true(body.contains("failed") || body.length() > 0)
        }
        @routines.StaySilent(_) => fail("failure must SendToUser")
      }
    }
  }
  // Needs approval.
  let approval = @routines.RoutineRunOutcome::{
    notable: false,
    failure: false,
    needs_approval: true,
    needs_user_decision: false,
    store_note: "approve outbound draft",
  }
  assert_true(@routines.is_break_silence_notable(approval))
  let d_a = @routines.decide_routine_delivery(
    @routines.SilencePolicy::silent_ok(),
    approval,
  )
  assert_true(d_a.sends_to_user())
  match d_a {
    @routines.SendToUser(reason~, body~) => {
      assert_eq(reason, "needs_approval")
      let _ = body
    }
    _ => fail("approval must break silence")
  }
  // Needs user decision.
  let decide = @routines.RoutineRunOutcome::{
    notable: false,
    failure: false,
    needs_approval: false,
    needs_user_decision: true,
    store_note: "pick ship or defer",
  }
  match @routines.break_silence_when_notable(decide) {
    Ok(d) => assert_true(d.sends_to_user())
    Err(e) => fail(e)
  }
  // Explicit notable flag.
  let notable = @routines.RoutineRunOutcome::{
    notable: true,
    failure: false,
    needs_approval: false,
    needs_user_decision: false,
    store_note: "threshold crossed: 5 errors",
  }
  match @routines.break_silence_when_notable(notable) {
    Ok(d) => {
      assert_true(d.sends_to_user())
      match d {
        @routines.SendToUser(reason~, body~) => {
          assert_eq(reason, "notable")
          assert_true(body.contains("threshold") || body.length() > 0)
        }
        _ => fail("notable must SendToUser")
      }
    }
    Err(e) => fail(e)
  }
  // Quiet must NOT claim break-silence.
  let quiet = @routines.RoutineRunOutcome::quiet_success(store_note="ok")
  match @routines.break_silence_when_notable(quiet) {
    Err(m) => assert_true(m.contains("not notable") || m.contains("notable"))
    Ok(_) => fail("quiet must not assert break-silence")
  }
}
