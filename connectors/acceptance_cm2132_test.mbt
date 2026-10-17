///|
/// CM-2132: built-in x namespace rate limit 30/min 1000/day UTC windows.
test "acceptance_CM-2132_x_public_rate_limit_window" {
  let lim = @connectors.XPublicRateLimiter::new()
  assert_eq(lim.namespace_id(), "x")
  assert_eq(@connectors.X_RATE_LIMIT_PER_MINUTE, 30)
  assert_eq(@connectors.X_RATE_LIMIT_PER_DAY, 1000)
  let win = @connectors.UtcRateWindow::of(
    minute_key="2026-10-17T05:27",
    day_key="2026-10-17",
  )
  // Under quota → Allowed with remaining.
  match lim.call(window=win) {
    @connectors.Allowed(remaining~) => {
      assert_eq(remaining.per_minute, 29)
      assert_eq(remaining.per_day, 999)
    }
    @connectors.Refused(_) => fail("first call must be Allowed")
  }
  // Over minute quota → refuse and report remaining.
  lim.set_counts(minute=30, day=30, window=win)
  match lim.call(window=win) {
    @connectors.Refused(reason~, remaining~) => {
      assert_true(reason.contains("30/min") || reason.contains("rate limit"))
      assert_eq(remaining.per_minute, 0)
      assert_true(lim.call(window=win).is_refused())
    }
    @connectors.Allowed(_) => fail("over 30/min must refuse")
  }
  // Over day quota (new minute, same day) → refuse.
  let win2 = @connectors.UtcRateWindow::of(
    minute_key="2026-10-17T05:28",
    day_key="2026-10-17",
  )
  lim.set_counts(minute=0, day=1000, window=win2)
  // After set_counts day=1000; roll keeps day. Call refuses.
  match lim.call(window=win2) {
    @connectors.Refused(reason~, remaining~) => {
      assert_true(reason.contains("1000/day") || reason.contains("rate limit"))
      assert_eq(remaining.per_day, 0)
    }
    @connectors.Allowed(_) => fail("over 1000/day must refuse")
  }
  // New UTC day resets day counter.
  let win3 = @connectors.UtcRateWindow::of(
    minute_key="2026-10-18T00:00",
    day_key="2026-10-18",
  )
  match lim.call(window=win3) {
    @connectors.Allowed(remaining~) => {
      assert_eq(remaining.per_day, 999)
      assert_eq(remaining.per_minute, 29)
    }
    @connectors.Refused(_) => fail("new UTC day must reset")
  }
}
