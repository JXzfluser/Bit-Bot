///|
/// CM-0101 / CM-0111: construct a text SendToUser envelope; bare URLs rejected.
pub fn TurnContext::deliver_text(
  self : TurnContext,
  body~ : String,
  channel_hint~ : String? = None,
) -> Result[TurnContext, String] {
  guard !(self.phase is Ended) else { Ok(self) }
  match @ui_protocol.ensure_markdown_links(body) {
    Err(e) => Err(e)
    Ok(_) => {
      let env = @ui_protocol.SendEnvelope::{
        turn_id: self.turn_id.value,
        parts: [@ui_protocol.Text(body~)],
        channel_hint,
      }
      Ok({ ..self, phase: Working, outbound: self.outbound + [env], })
    }
  }
}

///|
/// CM-0103 / CM-0111: milestone progress update; bare URLs rejected.
pub fn TurnContext::milestone(
  self : TurnContext,
  body~ : String,
) -> Result[TurnContext, String] {
  guard !(self.phase is Ended) else { Ok(self) }
  match @ui_protocol.ensure_markdown_links(body) {
    Err(e) => Err(e)
    Ok(_) => {
      let env = @ui_protocol.SendEnvelope::{
        turn_id: self.turn_id.value,
        parts: [@ui_protocol.Text(body~)],
        channel_hint: None,
      }
      Ok({ ..self, phase: Milestone, outbound: self.outbound + [env], })
    }
  }
}

///|
/// CM-0104: after end_turn, tools must not run on this turn.
pub fn TurnContext::allows_tools(self : TurnContext) -> Bool {
  match self.phase {
    Ended | Finalizing => false
    Opened | Acknowledged | Working | Milestone => true
  }
}

///|
pub fn TurnContext::finalize_text(
  self : TurnContext,
  body~ : String,
) -> Result[TurnContext, String] {
  match self.deliver_text(body~) {
    Err(e) => Err(e)
    Ok(with_msg) => Ok(with_msg.end_turn())
  }
}

///|
/// CM-0105: deliver a decision widget; never combine with attachment.
pub fn TurnContext::deliver_widget(
  self : TurnContext,
  widget_id~ : String,
  spec~ : @ui_protocol.WidgetSpec,
) -> Result[TurnContext, String] {
  guard !(self.phase is Ended) else { Err("turn ended") }
  match spec.validate() {
    Err(e) => Err(e)
    Ok(_) => {
      let env = @ui_protocol.SendEnvelope::{
        turn_id: self.turn_id.value,
        parts: [
          @ui_protocol.Widget(widget_id~, payload_json=widget_payload(spec)),
        ],
        channel_hint: None,
      }
      match @ui_protocol.validate_envelope_no_widget_attachment(env) {
        Err(e) => Err(e)
        Ok(_) =>
          Ok({ ..self, phase: Working, outbound: self.outbound + [env], })
      }
    }
  }
}

///|
fn widget_payload(spec : @ui_protocol.WidgetSpec) -> String {
  // Minimal stable JSON-ish payload for Host; Host renders from TypedSpec too.
  "{\"prompt\":\"" +
  spec.prompt +
  "\",\"options\":" +
  spec.options.length().to_string() +
  ",\"multi\":" +
  (if spec.multi_select { "true" } else { "false" }) +
  "}"
}

///|
/// CM-0106: attachment delivery with path shape validation (no inventing paths).
pub fn TurnContext::deliver_attachment(
  self : TurnContext,
  name~ : String,
  mime~ : String,
  path~ : String,
) -> Result[TurnContext, String] {
  guard !(self.phase is Ended) else { Err("turn ended") }
  let ref_ = @ui_protocol.AttachmentRef::{ name, mime, path, }
  match ref_.validate() {
    Err(e) => Err(e)
    Ok(_) => {
      let env = @ui_protocol.SendEnvelope::{
        turn_id: self.turn_id.value,
        parts: [@ui_protocol.Attachment(name~, mime~, path~)],
        channel_hint: None,
      }
      match @ui_protocol.validate_envelope_no_widget_attachment(env) {
        Err(e) => Err(e)
        Ok(_) =>
          Ok({ ..self, phase: Working, outbound: self.outbound + [env], })
      }
    }
  }
}

///|
/// CM-0104: tool-result alone is NOT end_turn; phase stays open for further work.
pub fn TurnContext::ingest_tool_result(
  self : TurnContext,
  tool_id~ : String,
  body~ : String,
) -> TurnContext {
  // Tool payloads are internal; they must not append user-visible outbound
  // and must not flip the turn to Ended by themselves.
  let _ = tool_id
  let _ = body
  guard !(self.phase is Ended) else { self }
  match self.phase {
    Opened | Acknowledged => { ..self, phase: Working, }
    Working | Milestone | Finalizing => self
    Ended => self
  }
}

///|
/// Extract first text body from an outbound envelope (acceptance helpers).
pub fn envelope_text_body(env : @ui_protocol.SendEnvelope) -> String? {
  for p in env.parts {
    match p {
      @ui_protocol.Text(body~) => return Some(body)
      _ => ()
    }
  }
  None
}

///|
/// CM-0102: short ack heuristic — not a final essay answer.
pub fn is_short_ack(body : String) -> Bool {
  body.length() > 0 && body.length() <= 40
}

///|
/// CM-0101: host-visible delivery record — Text part required.
pub(all) struct DeliveredMessage {
  turn_id : String
  text : String
  channel_hint : String?
} derive(Eq, Debug)

///|
pub extend DeliveredMessage with Eq::{not_equal, equal}

///|
pub extend DeliveredMessage with Debug::{to_repr}

///|
/// CM-0101: first outbound envelope as DeliveredMessage when it has a Text part.
pub fn TurnContext::first_delivered(self : TurnContext) -> DeliveredMessage? {
  if self.outbound.length() == 0 {
    return None
  }
  let env = self.outbound[0]
  match envelope_text_body(env) {
    None => None
    Some(text) =>
      Some({ turn_id: env.turn_id, text, channel_hint: env.channel_hint, })
  }
}

///|
/// CM-0101: confirm/clarify style — non-empty text, not a long essay.
pub fn is_confirm_or_clarify(body : String) -> Bool {
  body.length() > 0 && body.length() <= 80
}

///|
/// CM-0101: deliver confirm/clarify then optional follow-up; returns updated turn.
pub fn TurnContext::deliver_confirm_then(
  self : TurnContext,
  confirm~ : String,
  follow_up~ : String,
) -> Result[TurnContext, String] {
  guard is_confirm_or_clarify(confirm) else {
    Err("confirm/clarify text must be non-empty and short")
  }
  let t1 = self.acknowledge(body=confirm)
  match t1.first_delivered() {
    None => Err("first outbound must be a Text DeliveredMessage")
    Some(dm) => {
      guard dm.text.length() > 0 else { Err("Text part must be non-empty") }
      t1.deliver_text(body=follow_up)
    }
  }
}
