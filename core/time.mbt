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
/// Fixed UTC offset hours for known IANA labels (mock Host clock).
fn offset_hours_for(zone : TimeZone) -> Int32 {
  if zone.label == "Asia/Shanghai" || zone.label == "Asia/Hong_Kong" {
    8
  } else if zone.label == "America/Los_Angeles" {
    -7
  } else if zone.label == "UTC" || zone.label == "Etc/UTC" {
    0
  } else {
    // Unknown zone: still treat as +0 but label conversion note.
    0
  }
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
/// CM-2001: parse RFC3339 ending in Z, convert to local-looking form with zone label.
/// Never parrot a bare Z timestamp as the sole user-facing display.
pub fn display_instant(rfc3339_z : String, zone : TimeZone) -> String {
  let offset = offset_hours_for(zone)
  // Expect at least YYYY-MM-DDTHH:MM:SSZ
  if rfc3339_z.has_suffix("Z") && rfc3339_z.length() >= 20 {
    let base = rfc3339_z[0:rfc3339_z.length() - 1].to_owned()
    // Indices: 0..10 date, 11..13 hour, 13..19 :MM:SS
    if base.length() >= 19 && base[10:11].to_owned() == "T" {
      let date = base[0:10].to_owned()
      let hour_s = base[11:13].to_owned()
      let rest = base[13:19].to_owned() // :MM:SS
      match parse_u_int_core(hour_s) {
        Some(hour) => {
          let mut h = hour + offset
          let mut day_note = ""
          if h >= 24 {
            h = h - 24
            day_note = " +1d"
          } else if h < 0 {
            h = h + 24
            day_note = " -1d"
          }
          let local_form = date + "T" + two_digit(h) + rest
          return local_form +
            " (" +
            zone.label +
            ")" +
            day_note +
            " [converted from UTC]"
        }
        None => ()
      }
    }
    // Fallback: strip Z and label conversion (never parrot Z alone).
    return base + " (" + zone.label + ") [converted from UTC]"
  }
  // Non-Z: still attach short zone label.
  rfc3339_z + " (" + zone.label + ")"
}

///|
/// Instance wrapper for `display_instant` (CM-2001).
pub fn Instant::display_in(self : Instant, zone : TimeZone) -> String {
  display_instant(self.rfc3339, zone)
}
