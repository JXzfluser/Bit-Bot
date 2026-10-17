///|
/// Top-level content kinds the UI can render or the agent can emit.
/// Extend with new constructors; do not collapse variants.
pub(all) enum MessageKind {
  Text(body~ : String)
  Widget(widget_id~ : String, payload_json~ : String)
  Attachment(name~ : String, mime~ : String, path~ : String)
  Voice(audio_path~ : String, transcript~ : String?)
  Reaction(emoji~ : String, target_message_id~ : String)
} derive(Eq, Debug)

///|
pub extend MessageKind with Eq::{not_equal, equal}

///|
pub extend MessageKind with Debug::{to_repr}

///|
/// Outbound message envelope wrapping one or more content parts.
pub(all) struct SendEnvelope {
  turn_id : String
  parts : Array[MessageKind]
  channel_hint : String?
} derive(Eq, Debug)

///|
pub extend SendEnvelope with Eq::{not_equal, equal}

///|
pub extend SendEnvelope with Debug::{to_repr}

///|
/// Signals that the current agent turn is complete and the UI may unlock.
pub(all) struct EndTurn {
  turn_id : String
  reason : EndTurnReason
} derive(Eq, Debug)

///|
pub extend EndTurn with Eq::{not_equal, equal}

///|
pub extend EndTurn with Debug::{to_repr}

///|
pub(all) enum EndTurnReason {
  Completed
  Cancelled
  Error(message~ : String)
  AwaitingApproval
} derive(Eq, Debug)

///|
pub extend EndTurnReason with Eq::{not_equal, equal}

///|
pub extend EndTurnReason with Debug::{to_repr}

///|
pub fn SendEnvelope::part_count(self : SendEnvelope) -> Int32 {
  self.parts.length()
}

///|
pub fn MessageKind::label(self : MessageKind) -> String {
  match self {
    Text(_) => "text"
    Widget(_) => "widget"
    Attachment(_) => "attachment"
    Voice(_) => "voice"
    Reaction(_) => "reaction"
  }
}
