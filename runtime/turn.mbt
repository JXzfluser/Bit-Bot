///|
pub(all) enum TurnPhase {
  Opened
  Acknowledged
  Working
  Milestone
  Finalizing
  Ended
} derive(Eq, Debug)

///|
pub extend TurnPhase with Eq::{not_equal, equal}

///|
pub extend TurnPhase with Debug::{to_repr}

///|
pub(all) enum InboundKind {
  User
  Hidden
  Agent
  Routine
} derive(Eq, Debug)

///|
pub extend InboundKind with Eq::{not_equal, equal}

///|
pub extend InboundKind with Debug::{to_repr}

///|
pub fn InboundKind::should_user_ack(self : InboundKind) -> Bool {
  match self {
    User => true
    Hidden | Agent | Routine => false
  }
}

///|
pub(all) struct TodoItem {
  id : String
  content : String
  status : String
} derive(Eq, Debug)

///|
pub extend TodoItem with Eq::{not_equal, equal}

///|
pub extend TodoItem with Debug::{to_repr}

///|
pub(all) struct TurnContext {
  turn_id : @core.TurnId
  session_id : @core.SessionId
  user_id : @core.UserId
  phase : TurnPhase
  timezone : @core.TimeZone
  inbound_kind : InboundKind
  inbound_text : String
  todos : Array[TodoItem]
  outbound : Array[@ui_protocol.SendEnvelope]
} derive(Eq, Debug)

///|
pub extend TurnContext with Eq::{not_equal, equal}

///|
pub extend TurnContext with Debug::{to_repr}

///|
pub fn open_turn(
  turn_id~ : String,
  text~ : String,
  kind~ : InboundKind = User,
) -> TurnContext {
  {
    turn_id: @core.TurnId::new(turn_id),
    session_id: @core.SessionId::new("s0"),
    user_id: @core.UserId::new("u0"),
    phase: Opened,
    timezone: @core.TimeZone::asia_shanghai(),
    inbound_kind: kind,
    inbound_text: text,
    todos: [],
    outbound: [],
  }
}

///|
pub fn TurnContext::new(turn_id : String, user_id : String) -> TurnContext {
  {
    turn_id: @core.TurnId::new(turn_id),
    session_id: @core.SessionId::new("s0"),
    user_id: @core.UserId::new(user_id),
    phase: Opened,
    timezone: @core.TimeZone::asia_shanghai(),
    inbound_kind: User,
    inbound_text: "",
    todos: [],
    outbound: [],
  }
}

///|
/// Hidden cues must not be answered as user chat.
pub fn TurnContext::should_ack_user(self : TurnContext) -> Bool {
  self.inbound_kind.should_user_ack()
}

///|
pub fn TurnContext::acknowledge(
  self : TurnContext,
  body~ : String,
) -> TurnContext {
  guard self.should_ack_user() else { self }
  let env = @ui_protocol.SendEnvelope::{
    turn_id: self.turn_id.value,
    parts: [@ui_protocol.Text(body~)],
    channel_hint: None,
  }
  { ..self, phase: Acknowledged, outbound: self.outbound + [env], }
}

///|
pub fn TurnContext::end_turn(self : TurnContext) -> TurnContext {
  { ..self, phase: Ended, }
}
