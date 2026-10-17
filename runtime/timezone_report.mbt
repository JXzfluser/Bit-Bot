///|
/// CM-2001: report times in the user zone with a short IANA label.
/// UTC/Z timestamps are converted before display (never parroted alone).

///|
pub fn user_timezone() -> @core.TimeZone {
  @core.TimeZone::asia_shanghai()
}

///|
/// Format an RFC3339 instant for user-facing report text.
pub fn report_time(
  rfc3339 : String,
  zone~ : @core.TimeZone = user_timezone(),
) -> String {
  @core.display_instant(rfc3339, zone)
}

///|
/// True when display still contains a bare trailing Z without conversion note.
pub fn is_parroted_z(display : String) -> Bool {
  display.has_suffix("Z") &&
  !display.contains("(") &&
  !display.contains("converted")
}
