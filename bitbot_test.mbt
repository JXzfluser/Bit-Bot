///|
test "registered module count" {
  assert_eq(@bitbot.module_count(), 17)
  assert_eq(@bitbot.scaffold_ping(), 17)
  assert_eq(@bitbot.boot_banner().has_prefix("Bit Bot runtime boot"), true)
}
