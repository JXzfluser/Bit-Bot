///|
test "ids roundtrip" {
  let t = @core.TurnId::new("t1")
  assert_eq(t.value, "t1")
  let z = @core.TimeZone::asia_shanghai()
  assert_eq(z.label, "Asia/Shanghai")
  let inst = @core.Instant::{ rfc3339: "2026-10-17T03:18:00Z", }
  assert_eq(inst.format_with_zone(z), "2026-10-17T03:18:00Z (Asia/Shanghai)")
}
