///|
/// CM-2132: built-in x namespace public-read rate limit — 30/min and 1000/day (UTC windows).

///|
pub const X_RATE_LIMIT_PER_MINUTE : Int32 = 30

///|
pub const X_RATE_LIMIT_PER_DAY : Int32 = 1000

///|
/// UTC window identity: minute bucket and day bucket (ISO date).
pub(all) struct UtcRateWindow {
  /// UTC minute key, e.g. "2026-10-17T05:27"
  minute_key : String
  /// UTC day key, e.g. "2026-10-17"
  day_key : String
} derive(Eq, Debug)

///|
pub extend UtcRateWindow with Eq::{equal, not_equal}

///|
pub extend UtcRateWindow with Debug::{to_repr}

///|
pub fn UtcRateWindow::of(
  minute_key~ : String,
  day_key~ : String,
) -> UtcRateWindow {
  { minute_key, day_key, }
}

///|
/// Remaining quota after a call (or refuse).
pub(all) struct XRateRemaining {
  per_minute : Int32
  per_day : Int32
} derive(Eq, Debug)

///|
pub extend XRateRemaining with Eq::{equal, not_equal}

///|
pub extend XRateRemaining with Debug::{to_repr}

///|
pub(all) enum XRateLimitOutcome {
  Allowed(remaining~ : XRateRemaining)
  Refused(reason~ : String, remaining~ : XRateRemaining)
} derive(Eq, Debug)

///|
pub extend XRateLimitOutcome with Eq::{equal, not_equal}

///|
pub extend XRateLimitOutcome with Debug::{to_repr}

///|
pub fn XRateLimitOutcome::is_refused(self : XRateLimitOutcome) -> Bool {
  match self {
    Refused(_) => true
    Allowed(_) => false
  }
}

///|
/// Built-in x public namespace rate limiter (kernel-contract counters).
pub(all) struct XPublicRateLimiter {
  mut minute_key : String
  mut day_key : String
  mut minute_count : Int32
  mut day_count : Int32
  namespace_ : String
}

///|
pub fn XPublicRateLimiter::new() -> XPublicRateLimiter {
  {
    minute_key: "",
    day_key: "",
    minute_count: 0,
    day_count: 0,
    namespace_: "x",
  }
}

///|
pub fn XPublicRateLimiter::namespace_id(self : XPublicRateLimiter) -> String {
  self.namespace_
}

///|
fn x_roll_windows(lim : XPublicRateLimiter, window : UtcRateWindow) -> Unit {
  if lim.minute_key != window.minute_key {
    lim.minute_key = window.minute_key
    lim.minute_count = 0
  }
  if lim.day_key != window.day_key {
    lim.day_key = window.day_key
    lim.day_count = 0
  }
}

///|
pub fn XPublicRateLimiter::remaining(
  self : XPublicRateLimiter,
) -> XRateRemaining {
  {
    per_minute: X_RATE_LIMIT_PER_MINUTE - self.minute_count,
    per_day: X_RATE_LIMIT_PER_DAY - self.day_count,
  }
}

///|
/// Attempt a public-read call under UTC windows. Over quota → refuse or report remaining.
pub fn XPublicRateLimiter::call(
  self : XPublicRateLimiter,
  window~ : UtcRateWindow,
) -> XRateLimitOutcome {
  x_roll_windows(self, window)
  let rem_before = self.remaining()
  if self.minute_count >= X_RATE_LIMIT_PER_MINUTE {
    return Refused(
      reason="x public rate limit: over 30/min UTC window",
      remaining=rem_before,
    )
  }
  if self.day_count >= X_RATE_LIMIT_PER_DAY {
    return Refused(
      reason="x public rate limit: over 1000/day UTC window",
      remaining=rem_before,
    )
  }
  self.minute_count = self.minute_count + 1
  self.day_count = self.day_count + 1
  Allowed(remaining=self.remaining())
}

///|
/// Force counters to quota edge (test / mock).
pub fn XPublicRateLimiter::set_counts(
  self : XPublicRateLimiter,
  minute~ : Int32,
  day~ : Int32,
  window~ : UtcRateWindow,
) -> Unit {
  self.minute_key = window.minute_key
  self.day_key = window.day_key
  self.minute_count = minute
  self.day_count = day
}
