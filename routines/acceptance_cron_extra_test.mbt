///|
/// CM-0403: daily 8am flexible phase; blind */N rejected.
test "acceptance_CM-0403_flexible_phase_and_no_blind_step" {
  match @routines.plan_daily_at_hour(hour=8) {
    Ok(p) => {
      assert_eq(p.expr, "0 8 * * *")
      assert_eq(p.early_minutes, 15)
      assert_eq(p.late_minutes, 15)
      assert_true(p.summary.contains("8"))
      assert_true(p.summary.contains("相位") || p.summary.contains("15"))
    }
    Err(e) => fail(e)
  }
  match @routines.reject_blind_step("*/3 * * * *") {
    Err(m) =>
      assert_true(
        m.contains("*/") || m.contains("blind") || m.contains("rejected"),
      )
    Ok(_) => fail("blind step must reject")
  }
}

///|
/// CM-0404: loose daily → weekdays daytime; weekend/overnight need explicit_exception.
test "acceptance_CM-0404_loose_daily_weekdays_daytime" {
  match @routines.plan_loose_daily() {
    Ok(p) => {
      assert_eq(p.expr, "0 9 * * 1-5")
      assert_true(p.summary.contains("工作日") || p.summary.contains("1-5"))
    }
    Err(e) => fail(e)
  }
}

///|
/// CM-0404: 例外需明示 — weekend/overnight without flag → Err; with flag → Ok.
test "acceptance_CM-0404_explicit_exception_required" {
  match
    @routines.plan_loose_daily(
      kind=@routines.IncludeWeekend,
      explicit_exception=false,
    ) {
    Err(m) =>
      assert_true(m.contains("explicit_exception") || m.contains("例外"))
    Ok(_) => fail("weekend without explicit_exception must Err")
  }
  match
    @routines.plan_loose_daily(
      kind=@routines.Overnight,
      explicit_exception=false,
    ) {
    Err(_) => ()
    Ok(_) => fail("overnight without explicit_exception must Err")
  }
  match
    @routines.plan_loose_daily(
      kind=@routines.IncludeWeekend,
      explicit_exception=true,
    ) {
    Ok(p) => assert_eq(p.expr, "0 9 * * *")
    Err(e) => fail(e)
  }
  match
    @routines.plan_loose_daily(
      kind=@routines.Overnight,
      explicit_exception=true,
    ) {
    Ok(p) => assert_eq(p.expr, "0 2 * * *")
    Err(e) => fail(e)
  }
}

///|
/// CM-0405: @every denser than 5m rejected; 5m ok.
test "acceptance_CM-0405_min_interval_5_minutes" {
  match @routines.assert_min_interval_5m("@every 5m") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match @routines.assert_min_interval_5m("@every 1m") {
    Err(m) => assert_true(m.contains("5"))
    Ok(_) => fail("1m must reject")
  }
}

///|
/// CM-0404: weekends/overnight without explicit_exception → Err; with flag → broader cron.
test "acceptance_CM-0404_exception_requires_explicit" {
  match
    @routines.plan_loose_daily_with_exception(
      want_weekends=true,
      explicit_exception=false,
    ) {
    Err(m) => assert_true(m.contains("exception requires explicit"))
    Ok(_) => fail("weekends without explicit must err")
  }
  match
    @routines.plan_loose_daily_with_exception(
      want_overnights=true,
      explicit_exception=false,
    ) {
    Err(m) => assert_true(m.contains("exception requires explicit"))
    Ok(_) => fail("overnights without explicit must err")
  }
  match
    @routines.plan_loose_daily_with_exception(
      want_weekends=true,
      explicit_exception=true,
    ) {
    Ok(p) => {
      assert_eq(p.expr, "0 9 * * *")
      assert_true(p.summary.contains("例外") || p.summary.contains("周末"))
    }
    Err(e) => fail(e)
  }
  match @routines.plan_loose_daily_with_exception() {
    Ok(p) => assert_eq(p.expr, "0 9 * * 1-5")
    Err(e) => fail(e)
  }
}
