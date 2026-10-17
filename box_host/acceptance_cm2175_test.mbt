///|
/// CM-2175: box `date` output consistent with user IANA timezone (kernel-contract).
test "acceptance_CM-2175_box_clock_aligns_user_timezone" {
  let host = @box_host.HostAbi::mock()
  let out = host.date_aligned_with_user_tz(user_iana="Asia/Shanghai")
  assert_eq(out.user_iana, "Asia/Shanghai")
  assert_eq(@box_host.default_user_iana_timezone(), "Asia/Shanghai")
  assert_true(out.aligns_with_user_tz())
  assert_true(out.raw.contains("Asia/Shanghai") || out.raw.contains("CST"))
  match @box_host.assert_box_clock_matches_user_tz(out, "Asia/Shanghai") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  // Wrong expected zone → Err
  match @box_host.assert_box_clock_matches_user_tz(out, "America/New_York") {
    Err(m) => assert_true(m.contains("mismatch") || m.contains("New_York"))
    Ok(_) => fail("mismatched expected zone must Err")
  }
  // Effect recorded
  let mut saw_date = false
  for e in host.effects {
    if e.has_prefix("date:") {
      saw_date = true
    }
  }
  assert_true(saw_date)
}
