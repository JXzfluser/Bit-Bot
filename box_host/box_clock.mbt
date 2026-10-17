///|
/// CM-2175: box clock aligns with user IANA timezone (kernel-contract).
/// Host-integration (`date` on real box) remains GAP.

///|
pub fn default_user_iana_timezone() -> String {
  "Asia/Shanghai"
}

///|
/// Simulated `date` output consistent with user zone (mock — no real OS clock).
pub(all) struct BoxDateOutput {
  raw : String
  user_iana : String
  zone_label : String
} derive(Eq, Debug)

///|
pub extend BoxDateOutput with Eq::{equal, not_equal}

///|
pub extend BoxDateOutput with Debug::{to_repr}

///|
pub fn BoxDateOutput::aligns_with_user_tz(self : BoxDateOutput) -> Bool {
  self.user_iana.length() > 0 &&
  self.zone_label.length() > 0 &&
  self.raw.contains(self.zone_label) &&
  (
    self.raw.contains(self.user_iana) ||
    self.zone_label == "CST" ||
    self.zone_label == "UTC+8"
  )
}

///|
/// CM-2175: mock host `date` — output consistent with configured user TZ.
pub fn HostAbi::date_aligned_with_user_tz(
  self : HostAbi,
  user_iana~ : String = default_user_iana_timezone(),
  mock_stamp~ : String = "Sat Oct 17 13:44:00",
) -> BoxDateOutput {
  let zone_label = if user_iana == "Asia/Shanghai" ||
    user_iana == "Asia/Chongqing" {
    "CST"
  } else if user_iana.has_prefix("UTC") {
    user_iana
  } else {
    user_iana
  }
  let raw = mock_stamp +
    " " +
    zone_label +
    " " +
    user_iana +
    " (box clock aligned)"
  self.effects.push("date:" + user_iana)
  { raw, user_iana, zone_label, }
}

///|
/// Assert local command time reporting matches user zone (CM-2175).
pub fn assert_box_clock_matches_user_tz(
  out : BoxDateOutput,
  expected_iana : String,
) -> Result[Unit, String] {
  if out.user_iana != expected_iana {
    return Err("user_iana mismatch: " + out.user_iana + " != " + expected_iana)
  }
  if !out.aligns_with_user_tz() {
    return Err("date output not consistent with user TZ: " + out.raw)
  }
  Ok(())
}
