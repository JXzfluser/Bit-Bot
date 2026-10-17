///|
test "user turn gets ack; hidden does not" {
  let u = @runtime.open_turn(turn_id="t-u", text="hi")
  let u2 = u.acknowledge(body="收到")
  assert_eq(u2.phase, @runtime.Acknowledged)
  assert_eq(u2.outbound.length(), 1)
  let h = @runtime.open_turn(
    turn_id="t-h",
    text="[agent] ping",
    kind=@runtime.Hidden,
  )
  let h2 = h.acknowledge(body="should not send")
  assert_eq(h2.outbound.length(), 0)
  assert_eq(h2.end_turn().phase, @runtime.Ended)
}
