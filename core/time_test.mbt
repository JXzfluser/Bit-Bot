///|
/// 时区换算的期望值由 Python `zoneinfo`（系统 tzdata）逐条核对过，
/// 不是手算的——手算夏令时边界正是上一版把 America/Los_Angeles 硬编码成 -7
/// 时犯的错。
///
/// 重点覆盖三类以前会错的场景：
///   1. 跨天/跨月/跨年：偏移后**日期本身**必须改，不能只贴个 "+1d" 标签
///   2. 夏令时：同一时区冬夏偏移不同（LA 冬 -8 / 夏 -7）
///   3. 非整小时偏移（印度 +05:30）与未知时区（必须显式说"偏移未知"）

///|
test "display_instant_rolls_over_the_date_not_just_the_hour" {
  let sh = @core.TimeZone::asia_shanghai()
  // 2026-10-31 23:30Z → +8 → **11-01** 07:30（日期必须跟着变）
  let d = @core.display_instant("2026-10-31T23:30:00Z", sh)
  assert_true(d.contains("2026-11-01T07:30:00"))
  assert_false(d.contains("2026-10-31T07:30:00"))
  // 往前跨天：纽约 -4 → 10-31 22:00
  let ny = @core.TimeZone::{ label: "America/New_York", }
  let d2 = @core.display_instant("2026-11-01T02:00:00Z", ny)
  assert_true(d2.contains("2026-10-31T22:00:00"))
  // 跨年
  let d3 = @core.display_instant("2026-12-31T23:30:00Z", sh)
  assert_true(d3.contains("2027-01-01T07:30:00"))
}

///|
test "display_instant_resolves_daylight_saving_per_date" {
  let la = @core.TimeZone::{ label: "America/Los_Angeles", }
  // 冬天 PST = UTC-8
  let winter = @core.display_instant("2026-01-15T12:00:00Z", la)
  assert_true(winter.contains("2026-01-15T04:00:00"))
  // 夏天 PDT = UTC-7（上一版硬编码 -7，冬天整整差一小时）
  let summer = @core.display_instant("2026-07-15T12:00:00Z", la)
  assert_true(summer.contains("2026-07-15T05:00:00"))
  // 切换点：2026-03-08 10:00Z = 02:00 PST → 已切 PDT
  let after = @core.display_instant("2026-03-08T10:00:00Z", la)
  assert_true(after.contains("2026-03-08T03:00:00"))
  let before = @core.display_instant("2026-03-07T10:00:00Z", la)
  assert_true(before.contains("2026-03-07T02:00:00"))
  // 纽约：冬 -5 / 夏 -4
  let ny = @core.TimeZone::{ label: "America/New_York", }
  assert_true(
    @core.display_instant("2026-01-15T12:00:00Z", ny).contains(
      "2026-01-15T07:00:00",
    ),
  )
  assert_true(
    @core.display_instant("2026-07-15T12:00:00Z", ny).contains(
      "2026-07-15T08:00:00",
    ),
  )
  // 欧盟规则：2026-03-29 01:00Z 切入 BST
  let london = @core.TimeZone::{ label: "Europe/London", }
  assert_true(
    @core.display_instant("2026-03-29T01:00:00Z", london).contains(
      "2026-03-29T02:00:00",
    ),
  )
  assert_true(
    @core.display_instant("2026-03-28T01:00:00Z", london).contains(
      "2026-03-28T01:00:00",
    ),
  )
}

///|
test "display_instant_handles_non_hour_offsets" {
  let india = @core.TimeZone::{ label: "Asia/Kolkata", }
  // +05:30 → 2026-10-31 18:30Z → 11-01 00:00
  let d = @core.display_instant("2026-10-31T18:30:00Z", india)
  assert_true(d.contains("2026-11-01T00:00:00"))
}

///|
test "display_instant_refuses_to_fake_an_unknown_zone" {
  let odd = @core.TimeZone::{ label: "Mars/Olympus_Mons", }
  let d = @core.display_instant("2026-10-17T03:18:00Z", odd)
  assert_false(@core.is_known_zone("Mars/Olympus_Mons"))
  assert_true(d.contains("UTC offset unknown"))
  // 仍然不允许裸 Z 出现。
  assert_false(d.has_suffix("Z"))
}

///|
test "civil_date_arithmetic_is_real_calendar_math" {
  // 闰年
  let leap = @core.CivilDate::new(2028, 2, 28).add_days(1)
  assert_eq(leap.month, 2)
  assert_eq(leap.day, 29)
  assert_eq(@core.CivilDate::new(2028, 2, 29).add_days(1).month, 3)
  // 平年 2 月只有 28 天
  assert_eq(@core.CivilDate::new(2026, 2, 28).add_days(1).month, 3)
  assert_eq(@core.CivilDate::new(2026, 2, 28).add_days(1).day, 1)
  // 跨年
  let ny = @core.CivilDate::new(2026, 12, 31).add_days(1)
  assert_eq(ny.year, 2027)
  assert_eq(ny.month, 1)
  assert_eq(ny.day, 1)
  // 星期几：0 = 周日
  assert_eq(@core.CivilDate::new(2026, 3, 8).day_of_week(), 0)
  assert_eq(@core.CivilDate::new(2026, 10, 25).day_of_week(), 0)
  assert_eq(@core.CivilDate::new(2026, 10, 31).day_of_week(), 6)
  assert_eq(@core.CivilDate::new(2026, 3, 29).day_of_week(), 0)
  // 每月天数
  assert_eq(@core.CivilDate::new(2026, 1, 1).days_in_month(), 31)
  assert_eq(@core.CivilDate::new(2026, 4, 1).days_in_month(), 30)
  assert_eq(@core.CivilDate::new(2026, 2, 1).days_in_month(), 28)
  assert_eq(@core.CivilDate::new(2028, 2, 1).days_in_month(), 29)
}

///|
test "legacy_format_with_zone_still_appends_the_label" {
  let z = @core.TimeZone::asia_shanghai()
  let inst = @core.Instant::{ rfc3339: "2026-10-17T03:18:00Z", }
  assert_eq(inst.format_with_zone(z), "2026-10-17T03:18:00Z (Asia/Shanghai)")
}
