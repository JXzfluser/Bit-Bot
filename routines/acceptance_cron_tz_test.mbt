///|
/// CM-0402: user IANA timezone applies; CRON_TZ= prefix overrides.
test "acceptance_CM-0402_iana_timezone_and_CRON_TZ_override" {
  let user = @routines.CronContext::new(
    user_tz="Asia/Shanghai",
    expr="0 8 * * 1-5",
  )
  assert_eq(user.resolved_tz(), "Asia/Shanghai")
  assert_eq(user.cron_body(), "0 8 * * 1-5")
  assert_true(user.validate() is Ok(_))

  let override_ = @routines.CronContext::new(
    user_tz="Asia/Shanghai",
    expr="CRON_TZ=America/New_York 0 9 * * *",
  )
  assert_eq(override_.resolved_tz(), "America/New_York")
  assert_eq(override_.cron_body(), "0 9 * * *")
  assert_true(override_.validate() is Ok(_))
  assert_false(override_.resolved_tz() == "Asia/Shanghai")

  let (tz_opt, body) = @routines.parse_cron_tz_prefix(
    "CRON_TZ=Europe/Berlin @hourly",
  )
  assert_eq(tz_opt, Some("Europe/Berlin"))
  assert_eq(body, "@hourly")

  let (none_tz, plain) = @routines.parse_cron_tz_prefix("@daily")
  assert_eq(none_tz, None)
  assert_eq(plain, "@daily")
}
