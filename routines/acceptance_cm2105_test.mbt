///|
/// CM-2105: flexible cron earlyMinutes/lateMinutes — start falls in window.
test "acceptance_CM-2105_flexible_cron_early_late_window" {
  match
    @routines.plan_flexible_with_window(
      expr="0 8 * * *",
      early_minutes=15,
      late_minutes=20,
    ) {
    Err(e) => fail(e)
    Ok(plan) => {
      assert_eq(plan.early_minutes, 15)
      assert_eq(plan.late_minutes, 20)
      assert_true(plan.start_falls_in_window(offset_minutes=0))
      assert_true(plan.start_falls_in_window(offset_minutes=-10))
      assert_true(plan.start_falls_in_window(offset_minutes=-15))
      assert_true(plan.start_falls_in_window(offset_minutes=20))
      assert_true(plan.start_falls_in_window(offset_minutes=5))
      assert_false(plan.start_falls_in_window(offset_minutes=-16))
      assert_false(plan.start_falls_in_window(offset_minutes=21))
    }
  }
  match @routines.plan_daily_at_hour(hour=9, flexible=true) {
    Err(e) => fail(e)
    Ok(p) => {
      assert_eq(p.early_minutes, 15)
      assert_eq(p.late_minutes, 15)
      assert_true(p.start_falls_in_window(offset_minutes=-15))
      assert_true(p.start_falls_in_window(offset_minutes=15))
      assert_false(p.start_falls_in_window(offset_minutes=-16))
      assert_false(p.start_falls_in_window(offset_minutes=16))
    }
  }
}
