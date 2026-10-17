///|
test "desktop_turn_ack_and_json_shape" {
  let r = run_desktop_turn("hello from desktop", turn_id="dt-test")
  assert_true(r.ok)
  assert_eq(r.turn_id, "dt-test")
  assert_true(r.messages.length() >= 2)
  assert_eq(r.messages[0].role, "user")
  assert_eq(r.messages[0].text, "hello from desktop")
  assert_eq(r.messages[1].role, "assistant")
  let json = r.to_json_line()
  assert_true(json.contains("\"ok\":true"))
  assert_true(json.contains("\"turn_id\":\"dt-test\""))
  assert_true(json.contains("hello from desktop"))
  assert_true(json.contains("\"modules\":["))
  assert_true(json.contains("runtime"))
}

///|
test "desktop_turn_empty_text_fails" {
  let r = run_desktop_turn("   ")
  assert_false(r.ok)
  assert_true(r.error is Some(_))
}
