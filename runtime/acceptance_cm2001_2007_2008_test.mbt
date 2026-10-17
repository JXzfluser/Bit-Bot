///|
/// CM-2001: all times reported in user zone with short label; Z timestamps converted.
test "acceptance_CM-2001_user_timezone_report" {
  let zone = @runtime.user_timezone()
  assert_eq(zone.label, "Asia/Shanghai")
  let z_in = "2026-10-17T03:18:00Z"
  let display = @runtime.report_time(z_in)
  // Must not parrot bare Z as sole display.
  assert_false(@runtime.is_parroted_z(display))
  assert_false(display == z_in)
  // Must carry short zone label.
  assert_true(display.contains("Asia/Shanghai"))
  // Must show conversion (local form or explicit converted note); not sole Z.
  assert_true(
    display.contains("[converted from UTC]") || display.contains("T11:18:00"),
  )
  // Z must not remain as the only timestamp form without zone/conversion.
  assert_false(display.has_suffix("Z"))
  // Instant helper path.
  let inst = @core.Instant::{ rfc3339: z_in, }
  let via = inst.display_in(zone)
  assert_true(via.contains("Asia/Shanghai"))
  assert_true(via.contains("converted") || via.contains("T11:18:00"))
  assert_false(via == z_in)
}

///|
/// CM-2007: automation_status / timestamp — routine phase uses latest timestamp.
test "acceptance_CM-2007_automation_status_uses_latest_timestamp" {
  let tracker = @runtime.AutomationStatusTracker::new()
  tracker.update(
    routine_id="r-daily",
    phase=@runtime.Scheduled,
    timestamp="2026-10-17T01:00:00Z",
    summary="queued",
  )
  tracker.update(
    routine_id="r-daily",
    phase=@runtime.Running,
    timestamp="2026-10-17T02:30:00Z",
    summary="executing",
  )
  tracker.update(
    routine_id="r-daily",
    phase=@runtime.Completed,
    timestamp="2026-10-17T02:45:00Z",
    summary="done",
  )
  match tracker.latest_timestamp() {
    Some(ts) => assert_eq(ts, "2026-10-17T02:45:00Z")
    None => fail("expected latest timestamp")
  }
  let reminder = tracker.reminder_text()
  assert_true(reminder.contains("automation_status"))
  assert_true(reminder.contains("phase=completed"))
  assert_true(tracker.reminder_uses_timestamp("2026-10-17T02:45:00Z"))
  // Stale earlier stamps must not be the phase timestamp line.
  assert_false(reminder.contains("timestamp=2026-10-17T01:00:00Z"))
  assert_false(reminder.contains("timestamp=2026-10-17T02:30:00Z"))
}

///|
/// CM-2008: when asked what model — answer only product name "Bit Bot".
test "acceptance_CM-2008_identity_product_name_only" {
  assert_eq(@runtime.product_name(), "Bit Bot")
  let ans = @runtime.identity_reply("what model are you?")
  assert_eq(ans, "Bit Bot")
  assert_true(@runtime.refuses_provider_name(ans))
  let ans2 = @runtime.identity_reply(
    "which underlying model / powered by OpenAI?",
  )
  assert_eq(ans2, "Bit Bot")
  assert_false(ans2.contains("OpenAI"))
  assert_false(ans2.contains("Claude"))
  assert_false(ans2.contains("GPT"))
  assert_false(ans2.contains("xAI"))
  assert_false(ans2.contains("Grok"))
  let ans3 = @runtime.identity_reply("你是什么模型")
  assert_eq(ans3, "Bit Bot")
}
