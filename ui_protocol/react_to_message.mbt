///|
/// CM-2101: ReactToMessage — emoji pill visible; toggle cancels.

///|
pub(all) struct MessageReactionPill {
  message_id : String
  emoji : String
  /// Pill is visible on the message in Host UI (kernel-contract flag).
  visible : Bool
  /// Active reaction (not cancelled).
  active : Bool
} derive(Eq, Debug)

///|
pub extend MessageReactionPill with Eq::{equal, not_equal}

///|
pub extend MessageReactionPill with Debug::{to_repr}

///|
pub fn MessageReactionPill::is_visible_pill(self : MessageReactionPill) -> Bool {
  self.visible && self.active && self.emoji.length() > 0
}

///|
/// Host-side reaction state for a message (mock).
pub(all) struct ReactToMessageHost {
  /// message_id → active pill
  pills : Map[String, MessageReactionPill]
}

///|
pub fn ReactToMessageHost::new() -> ReactToMessageHost {
  { pills: Map([]), }
}

///|
/// Apply or toggle ReactToMessage. Same emoji again → cancel (toggle off).
pub fn ReactToMessageHost::react_to_message(
  self : ReactToMessageHost,
  message_id~ : String,
  emoji~ : String,
) -> Result[MessageReactionPill, String] {
  if message_id.length() == 0 {
    return Err("ReactToMessage requires message_id")
  }
  if emoji.length() == 0 {
    return Err("ReactToMessage requires emoji")
  }
  match self.pills.get(message_id) {
    Some(existing) =>
      if existing.active && existing.emoji == emoji {
        // Toggle cancels.
        let cancelled = { message_id, emoji, visible: false, active: false, }
        self.pills.set(message_id, cancelled)
        Ok(cancelled)
      } else {
        let pill = { message_id, emoji, visible: true, active: true, }
        self.pills.set(message_id, pill)
        Ok(pill)
      }
    None => {
      let pill = { message_id, emoji, visible: true, active: true, }
      self.pills.set(message_id, pill)
      Ok(pill)
    }
  }
}

///|
pub fn ReactToMessageHost::get_pill(
  self : ReactToMessageHost,
  message_id~ : String,
) -> MessageReactionPill? {
  self.pills.get(message_id)
}

///|
/// CM-2128: ReactToMessage as whole outbound turn — pill visible; body may be omitted.
pub(all) struct ReactOutboundTurn {
  pill : MessageReactionPill
  /// When true, the turn has no Text body (pill-only end_turn).
  body_omitted : Bool
  /// Optional body when not omitted (usually empty for thank-you).
  body : String
  end_turn : Bool
  envelope : SendEnvelope
} derive(Eq, Debug)

///|
pub extend ReactOutboundTurn with Eq::{equal, not_equal}

///|
pub extend ReactOutboundTurn with Debug::{to_repr}

///|
pub fn ReactOutboundTurn::shows_pill(self : ReactOutboundTurn) -> Bool {
  self.pill.is_visible_pill()
}

///|
pub fn ReactOutboundTurn::may_omit_body(self : ReactOutboundTurn) -> Bool {
  self.body_omitted || self.body.length() == 0
}

///|
/// Detect thank-you / gratitude cues for React-only outbound.
pub fn is_thank_you_message(text : String) -> Bool {
  let lower = text.to_lower()
  let keys = [
    "thank you", "thanks", "thx", "ty!", "appreciate", "致谢", "谢谢",
  ]
  for k in keys {
    if lower.contains(k) {
      break true
    }
  } nobreak {
    false
  }
}

///|
/// CM-2128: Given thank-you → React end_turn shows pill, may omit body.
pub fn ReactToMessageHost::react_outbound_end_turn(
  self : ReactToMessageHost,
  turn_id~ : String,
  message_id~ : String,
  emoji~ : String,
  omit_body~ : Bool,
) -> Result[ReactOutboundTurn, String] {
  match self.react_to_message(message_id~, emoji~) {
    Err(e) => Err(e)
    Ok(pill) => {
      if !pill.is_visible_pill() {
        return Err("outbound react must show visible pill")
      }
      let parts : Array[MessageKind] = [
        Reaction(emoji~, target_message_id=message_id),
      ]
      // Body omitted: Reaction-only envelope (no Text part).
      let body = if omit_body { "" } else { "👍" }
      let env : SendEnvelope = { turn_id, parts, channel_hint: None, }
      Ok({ pill, body_omitted: omit_body, body, end_turn: true, envelope: env, })
    }
  }
}

///|
/// Plan thank-you → React end_turn (pill, no body).
pub fn plan_thank_you_react_end_turn(
  host : ReactToMessageHost,
  turn_id~ : String,
  user_message_id~ : String,
  user_text~ : String,
) -> Result[ReactOutboundTurn, String] {
  if !is_thank_you_message(user_text) {
    return Err("not a thank-you message")
  }
  host.react_outbound_end_turn(
    turn_id~,
    message_id=user_message_id,
    emoji="🙏",
    omit_body=true,
  )
}
