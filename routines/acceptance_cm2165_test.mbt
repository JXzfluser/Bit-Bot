///|
/// CM-2165: silent_ok — when nothing notable, do not SendToUser.
test "acceptance_CM-2165_routine_silent_ok_no_send_to_user" {
  let quiet = @routines.RoutineRunOutcome::quiet_success(
    store_note="cron tick wrote store/memory",
  )
  assert_false(@routines.is_break_silence_notable(quiet))
  let d = @routines.decide_routine_delivery(
    @routines.SilencePolicy::silent_ok(),
    quiet,
  )
  assert_false(d.sends_to_user())
  match d {
    @routines.StaySilent(store_note~) =>
      assert_true(store_note.contains("store") || store_note.length() > 0)
    @routines.SendToUser(_) => fail("quiet silent_ok must StaySilent")
  }
  match @routines.silent_ok_no_send_when_quiet(quiet) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  // silent_ok=false still notifies even when quiet.
  let d2 = @routines.decide_routine_delivery(
    @routines.SilencePolicy::always_notify(),
    quiet,
  )
  assert_true(d2.sends_to_user())
}
