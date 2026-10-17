///|
test "hidden inbound skips user ack" {
  let user = @runtime.open_turn(turn_id="t1", text="hi", kind=@runtime.User)
  let hidden = @runtime.open_turn(
    turn_id="t2",
    text="[routine]",
    kind=@runtime.Hidden,
  )
  assert_true(user.should_ack_user())
  assert_false(hidden.should_ack_user())
}
