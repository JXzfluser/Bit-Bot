///|
/// IANA-style timezone label used when reporting times to the user.
pub(all) struct TimeZone {
  label : String
} derive(Eq, Debug)

///|
pub extend TimeZone with Eq::{equal, not_equal}

///|
pub extend TimeZone with Debug::{to_repr}

///|
pub fn TimeZone::asia_shanghai() -> TimeZone {
  { label: "Asia/Shanghai", }
}

///|
/// Opaque instant as RFC3339 string until HostAbi provides real clocks.
pub(all) struct Instant {
  rfc3339 : String
} derive(Eq, Debug)

///|
pub extend Instant with Eq::{equal, not_equal}

///|
pub extend Instant with Debug::{to_repr}

///|
/// Legacy helper: appends zone label without converting (kept for callers).
/// Prefer `display_instant` / `Instant::display_in` for user-facing times (CM-2001).
pub fn Instant::format_with_zone(self : Instant, zone : TimeZone) -> String {
  "\{self.rfc3339} (\{zone.label})"
}

///|
fn parse_u_int_core(s : String) -> Int32? {
  if s.length() == 0 {
    return None
  }
  let mut n = 0
  for i = 0; i < s.length(); i = i + 1 {
    let c = s[i]
    if c < '0' || c > '9' {
      return None
    }
    n = n * 10 + (c.to_int() - '0'.to_int())
  }
  Some(n)
}

///|
fn two_digit(n : Int32) -> String {
  if n < 10 {
    "0" + n.to_string()
  } else {
    n.to_string()
  }
}

///|
fn four_digit(n : Int32) -> String {
  if n < 0 {
    "-" + (-n).to_string()
  } else if n < 10 {
    "000" + n.to_string()
  } else if n < 100 {
    "00" + n.to_string()
  } else if n < 1000 {
    "0" + n.to_string()
  } else {
    n.to_string()
  }
}

///|
/// 解析 `YYYY-MM-DDTHH:MM:SS`（已经去掉结尾 Z）→ (日期, 当日分钟数, 秒文本)。
fn parse_utc_body(base : String) -> (CivilDate, Int32, String)? {
  if base.length() < 19 {
    return None
  }
  if base[10:11].to_owned() != "T" {
    return None
  }
  let parts = (
    parse_u_int_core(base[0:4].to_owned()),
    parse_u_int_core(base[5:7].to_owned()),
    parse_u_int_core(base[8:10].to_owned()),
    parse_u_int_core(base[11:13].to_owned()),
    parse_u_int_core(base[14:16].to_owned()),
  )
  match parts {
    (Some(year), Some(month), Some(day), Some(hour), Some(minute)) => {
      if month < 1 || month > 12 || day < 1 || day > 31 {
        return None
      }
      if hour > 23 || minute > 59 {
        return None
      }
      let date = CivilDate::new(year, month, day)
      Some((date, hour * 60 + minute, base[17:19].to_owned()))
    }
    _ => None
  }
}

///|
/// CM-2001: parse RFC3339 ending in Z, convert to local form with zone label.
/// Never parrot a bare Z timestamp as the sole user-facing display.
///
/// 跨天/跨月/跨年用真实日历运算（`core/calendar.mbt`）：上一版只是给小时加上
/// 偏移、然后在末尾贴一个 `" +1d"` 标签，**日期本身没改**——于是
/// `2026-10-31T23:30:00Z` 在 UTC+8 会显示成 `2026-10-31 07:30`，日期整整差一天。
pub fn display_instant(rfc3339_z : String, zone : TimeZone) -> String {
  // Expect at least YYYY-MM-DDTHH:MM:SSZ
  if rfc3339_z.has_suffix("Z") && rfc3339_z.length() >= 20 {
    let base = rfc3339_z[0:rfc3339_z.length() - 1].to_owned()
    match parse_utc_body(base) {
      None =>
        // Fallback: strip Z and label conversion (never parrot Z alone).
        base + " (" + zone.label + ") [converted from UTC]"
      Some((date, minute_of_day, second)) =>
        match zone_offset_minutes(zone.label, date, minute_of_day) {
          None =>
            // 未知时区：不假装换算成功，明说偏移未知。
            base +
            " (" +
            zone.label +
            ") [UTC offset unknown for " +
            zone.label +
            "]"
          Some(offset) => {
            let total = minute_of_day + offset
            let shift = if total < 0 {
              -1
            } else if total >= 1440 {
              1
            } else {
              0
            }
            let local_date = date.add_days(shift)
            let local_min = if total < 0 {
              total + 1440
            } else if total >= 1440 {
              total - 1440
            } else {
              total
            }
            let lh = local_min / 60
            let lm = local_min % 60
            let local_form = four_digit(local_date.year) +
              "-" +
              two_digit(local_date.month) +
              "-" +
              two_digit(local_date.day) +
              "T" +
              two_digit(lh) +
              ":" +
              two_digit(lm) +
              ":" +
              second
            local_form + " (" + zone.label + ") [converted from UTC]"
          }
        }
    }
  } else {
    // Non-Z: still attach short zone label.
    rfc3339_z + " (" + zone.label + ")"
  }
}

///|
/// Instance wrapper for `display_instant` (CM-2001).
pub fn Instant::display_in(self : Instant, zone : TimeZone) -> String {
  display_instant(self.rfc3339, zone)
}
