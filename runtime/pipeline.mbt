///|
pub fn demo_ack_envelope(
  turn_id : String,
  body : String,
) -> @ui_protocol.SendEnvelope {
  {
    turn_id,
    parts: [@ui_protocol.Text(body~)],
    channel_hint: (None : String?),
  }
}

///|
pub fn demo_review_send() -> @security.ApprovalDecision {
  let gate = @security.ApprovalGate::default()
  let req = @security.ApprovalRequest::{
    id: "demo",
    class_: @security.ExternalSend,
    summary: "email",
    payload_json: "{}",
    irreversible: true,
  }
  gate.evaluate(req)
}

///|
pub fn demo_zone_label() -> String {
  @core.TimeZone::asia_shanghai().label
}
