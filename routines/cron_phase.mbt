///|
/// CM-0403: flexible timing — named hour lands in ±15min phase; ban blind */N.
pub(all) struct CronPlan {
  expr : String
  timezone : String
  summary : String
  early_minutes : Int32
  late_minutes : Int32
} derive(Eq, Debug)

///|
pub extend CronPlan with Eq::{equal, not_equal}

///|
pub extend CronPlan with Debug::{to_repr}

///|
/// 「每天 8 点」→ flexible 0 8 * * * with ±15 phase; exact minute reported in summary.
pub fn plan_daily_at_hour(
  hour~ : Int32,
  timezone~ : String = "Asia/Shanghai",
  flexible~ : Bool = true,
) -> Result[CronPlan, String] {
  if hour < 0 || hour > 23 {
    return Err("hour out of range")
  }
  let expr = "0 " + hour.to_string() + " * * *"
  if flexible {
    let summary = "每天 " +
      hour.to_string() +
      ":00 " +
      timezone +
      " ±15min 相位"
    Ok({ expr, timezone, summary, early_minutes: 15, late_minutes: 15, })
  } else {
    let summary = "每天 " + hour.to_string() + ":00 " + timezone + " exact"
    Ok({ expr, timezone, summary, early_minutes: 0, late_minutes: 0, })
  }
}

///|
/// Reject blind step schedules like */3 (too dense / banned pattern).
pub fn reject_blind_step(expr : String) -> Result[Unit, String] {
  if expr.contains("*/") {
    Err(
      "blind */N step schedules are rejected; use named times or @every ≥5m",
    )
  } else {
    validate_cron(expr)
  }
}

///|
/// CM-0404 schedule kind: default weekdays daytime; weekend/overnight need explicit exception.
pub(all) enum LooseDailyKind {
  WeekdaysDaytime
  IncludeWeekend
  Overnight
} derive(Eq, Debug)

///|
pub extend LooseDailyKind with Eq::{equal, not_equal}

///|
pub extend LooseDailyKind with Debug::{to_repr}

///|
/// CM-0404: loose「每天」→ weekdays daytime by default.
/// Weekend or overnight requires explicit_exception=true; otherwise Err.
pub fn plan_loose_daily(
  timezone~ : String = "Asia/Shanghai",
  kind~ : LooseDailyKind = WeekdaysDaytime,
  explicit_exception~ : Bool = false,
) -> Result[CronPlan, String] {
  match kind {
    WeekdaysDaytime =>
      Ok({
        expr: "0 9 * * 1-5",
        timezone,
        summary: "工作日白天 09:00 " +
        timezone +
        "（松散每天不扩周末通宵）",
        early_minutes: 15,
        late_minutes: 15,
      })
    IncludeWeekend | Overnight =>
      if !explicit_exception {
        Err(
          "weekend/overnight schedule requires explicit_exception=true (例外需明示)",
        )
      } else {
        let (expr, label) = match kind {
          IncludeWeekend => ("0 9 * * *", "含周末白天")
          Overnight => ("0 2 * * *", "通宵 02:00")
          WeekdaysDaytime => ("0 9 * * 1-5", "工作日")
        }
        Ok({
          expr,
          timezone,
          summary: label + " " + timezone + "（explicit_exception）",
          early_minutes: 15,
          late_minutes: 15,
        })
      }
  }
}

///|
/// CM-0405: denser than 5 minutes rejected (delegates validate_cron).
pub fn assert_min_interval_5m(expr : String) -> Result[Unit, String] {
  validate_cron(expr)
}

///|
/// CM-0404: loose daily with explicit exception for weekends / overnight.
/// Without explicit_exception=true, want_weekends or want_overnights → Err.
pub fn plan_loose_daily_with_exception(
  timezone~ : String = "Asia/Shanghai",
  want_weekends~ : Bool = false,
  want_overnights~ : Bool = false,
  explicit_exception~ : Bool = false,
) -> Result[CronPlan, String] {
  if (want_weekends || want_overnights) && !explicit_exception {
    return Err("exception requires explicit")
  }
  if !want_weekends && !want_overnights {
    return plan_loose_daily(timezone~)
  }
  // Broader cron only when exception is explicit.
  let (expr, summary) = if want_weekends && want_overnights {
    (
      "0 2 * * *",
      "例外：含周末通宵 02:00 " + timezone + "（explicit_exception）",
    )
  } else if want_weekends {
    (
      "0 9 * * *",
      "例外：含周末白天 09:00 " + timezone + "（explicit_exception）",
    )
  } else {
    (
      "0 2 * * 1-5",
      "例外：工作日通宵 02:00 " + timezone + "（explicit_exception）",
    )
  }
  Ok({ expr, timezone, summary, early_minutes: 15, late_minutes: 15, })
}

///|
/// CM-2105: whether a start offset (minutes relative to named minute 0) falls
/// inside the flexible early/late window.
/// `offset_minutes` is signed: negative = early, positive = late.
pub fn CronPlan::start_falls_in_window(
  self : CronPlan,
  offset_minutes~ : Int32,
) -> Bool {
  if offset_minutes < 0 {
    let early = 0 - offset_minutes
    early <= self.early_minutes
  } else {
    offset_minutes <= self.late_minutes
  }
}

///|
/// CM-2105: plan flexible cron with explicit earlyMinutes / lateMinutes.
pub fn plan_flexible_with_window(
  expr~ : String,
  timezone~ : String = "Asia/Shanghai",
  early_minutes~ : Int32,
  late_minutes~ : Int32,
) -> Result[CronPlan, String] {
  if early_minutes < 0 || late_minutes < 0 {
    return Err("earlyMinutes/lateMinutes must be >= 0")
  }
  match validate_cron(expr) {
    Err(e) => Err(e)
    Ok(_) =>
      Ok({
        expr,
        timezone,
        summary: "flexible window early=" +
        early_minutes.to_string() +
        " late=" +
        late_minutes.to_string() +
        " " +
        timezone,
        early_minutes,
        late_minutes,
      })
  }
}
