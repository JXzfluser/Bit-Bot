///|
/// 公历日期运算。内核没有可用的时区库，但"UTC 时间戳 + 固定偏移 → 本地时间"
/// 这件事绕不开跨天/跨月/跨年的日期加减，而加减必须按真实日历来做：
/// 2026-10-31T23:30:00Z 在 UTC+8 是 **11-01 07:30**，不是 10-31。
///
/// 这里实现 Howard Hinnant 的 `days_from_civil` / `civil_from_days`
/// （公历 → 天数 ↔ 天数 → 公历），对任意日期精确、闰年规则内置。

///|
pub(all) struct CivilDate {
  year : Int32
  /// 1..12
  month : Int32
  /// 1..31
  day : Int32
} derive(Eq, Debug)

///|
pub extend CivilDate with Eq::{equal, not_equal}

///|
pub extend CivilDate with Debug::{to_repr}

///|
pub fn CivilDate::new(year : Int32, month : Int32, day : Int32) -> CivilDate {
  { year, month, day, }
}

///|
/// 1970-01-01（epoch）为 0，返回该日期的天序号。
fn days_from_civil(y0 : Int32, m : Int32, d : Int32) -> Int64 {
  let y = if m <= 2 { y0 - 1 } else { y0 }
  let era = (if y >= 0 { y } else { y - 399 }) / 400
  let yoe = y - era * 400
  let mp = if m > 2 { m - 3 } else { m + 9 }
  let doy = (153 * mp + 2) / 5 + d - 1
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
  era.to_int64() * 146097L + doe.to_int64() - 719468L
}

///|
/// 天序号 → 公历日期（Hinnant `civil_from_days`）。
fn civil_from_days(z0 : Int64) -> (Int32, Int32, Int32) {
  let z = z0 + 719468L
  let era = (if z >= 0L { z } else { z - 146096L }) / 146097L
  let doe = z - era * 146097L
  let yoe = (doe - doe / 1460L + doe / 36524L - doe / 146096L) / 365L
  let y = yoe + era * 400L
  let doy = doe - (365L * yoe + yoe / 4L - yoe / 100L)
  let mp = (5L * doy + 2L) / 153L
  let d = doy - (153L * mp + 2L) / 5L + 1L
  let m = if mp < 10L { mp + 3L } else { mp - 9L }
  let y = if m <= 2L { y + 1L } else { y }
  (y.to_int(), m.to_int(), d.to_int())
}

///|
pub fn CivilDate::to_epoch_days(self : CivilDate) -> Int64 {
  days_from_civil(self.year, self.month, self.day)
}

///|
pub fn CivilDate::from_epoch_days(days : Int64) -> CivilDate {
  let (y, m, d) = civil_from_days(days)
  { year: y, month: m, day: d, }
}

///|
/// 日期加减天数（可跨月/跨年/跨闰日）。
pub fn CivilDate::add_days(self : CivilDate, n : Int32) -> CivilDate {
  CivilDate::from_epoch_days(self.to_epoch_days() + n.to_int64())
}

///|
pub fn CivilDate::is_leap_year(self : CivilDate) -> Bool {
  let y = self.year
  (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

///|
pub fn CivilDate::days_in_month(self : CivilDate) -> Int32 {
  match self.month {
    1 | 3 | 5 | 7 | 8 | 10 | 12 => 31
    4 | 6 | 9 | 11 => 30
    2 => if self.is_leap_year() { 29 } else { 28 }
    _ => 30
  }
}

///|
/// 星期几：0 = 周日，6 = 周六。
pub fn CivilDate::day_of_week(self : CivilDate) -> Int32 {
  let days = self.to_epoch_days()
  // 1970-01-01 是周四：以周日为 0 时它是 4。
  let rem = days % 7L
  let shifted = if rem < 0L { rem + 7L } else { rem }
  (shifted + 4L).to_int() % 7
}

///|
/// 当月第 n 个星期几（dow：0=周日）的日期，n 从 1 起。
pub fn nth_weekday_of_month(
  year : Int32,
  month : Int32,
  nth : Int32,
  dow : Int32,
) -> Int32 {
  let first = CivilDate::new(year, month, 1)
  let delta = (dow - first.day_of_week() + 7) % 7
  1 + delta + (nth - 1) * 7
}

///|
/// 当月最后一个星期几（dow：0=周日）的日期。
pub fn last_weekday_of_month(year : Int32, month : Int32, dow : Int32) -> Int32 {
  let last = CivilDate::new(year, month, 1).days_in_month()
  let last_date = CivilDate::new(year, month, last)
  let back = (last_date.day_of_week() - dow + 7) % 7
  last - back
}
