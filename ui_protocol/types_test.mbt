///|
test "message kinds and envelope" {
  let parts : Array[@ui_protocol.MessageKind] = [
    @ui_protocol.Text(body="hello"),
    @ui_protocol.Widget(widget_id="w1", payload_json="{}"),
    @ui_protocol.Attachment(name="a.txt", mime="text/plain", path="/tmp/a.txt"),
    @ui_protocol.Voice(audio_path="/tmp/v.ogg", transcript=Some("hi")),
    @ui_protocol.Reaction(emoji="👍", target_message_id="m1"),
  ]
  let env = @ui_protocol.SendEnvelope::{
    turn_id: "t1",
    parts,
    channel_hint: (None : String?),
  }
  assert_eq(env.part_count(), 5)
  assert_eq(parts[0].label(), "text")
  let end = @ui_protocol.EndTurn::{
    turn_id: "t1",
    reason: @ui_protocol.EndTurnReason::Completed,
  }
  assert_eq(end.turn_id, "t1")
}
