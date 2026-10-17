///|
/// CM-0110: [inbound] reaction wake — lightweight ack default no reply;
/// act only when useful.

///|
/// Inbound reaction event (emoji on a prior message).
pub(all) struct InboundReaction {
  emoji : String
  target_message_id : String
  channel_hint : String?
  useful : Bool
} derive(Eq, Debug)

///|
pub extend InboundReaction with Eq::{equal, not_equal}

///|
pub extend InboundReaction with Debug::{to_repr}

///|
pub fn InboundReaction::new(
  emoji~ : String,
  target_message_id~ : String,
  useful~ : Bool = false,
  channel_hint~ : String? = None,
) -> InboundReaction {
  { emoji, target_message_id, channel_hint, useful, }
}

///|
/// Disposition after a reaction wake.
pub(all) enum ReactionWakeDisposition {
  /// Lightweight ack: wake only, do not reply to the channel.
  WakeNoReply
  /// Useful signal — agent may act (tool / follow-up), still no forced reply.
  ActWhenUseful(reason~ : String)
} derive(Eq, Debug)

///|
pub extend ReactionWakeDisposition with Eq::{equal, not_equal}

///|
pub extend ReactionWakeDisposition with Debug::{to_repr}

///|
pub fn ReactionWakeDisposition::should_reply(
  _self : ReactionWakeDisposition,
) -> Bool {
  // CM-0110: default is no forced reply in either case.
  false
}

///|
pub fn ReactionWakeDisposition::is_wake_only(
  self : ReactionWakeDisposition,
) -> Bool {
  match self {
    WakeNoReply => true
    ActWhenUseful(_) => false
  }
}

///|
pub fn ReactionWakeDisposition::acts(self : ReactionWakeDisposition) -> Bool {
  match self {
    WakeNoReply => false
    ActWhenUseful(_) => true
  }
}

///|
/// Detect `[inbound]` reaction cue prefix (acceptance / protocol cue).
pub fn has_inbound_reaction_cue(text : String) -> Bool {
  let mut i = 0
  while i < text.length() {
    let c = text[i]
    if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
      i = i + 1
    } else {
      break
    }
  }
  let t = text[i:].to_owned()
  t.has_prefix("[inbound]") || t.has_prefix("[inbound ")
}

///|
/// CM-0110: classify reaction wake — lightweight ack, no forced reply;
/// act only when useful=true.
pub fn handle_inbound_reaction(
  reaction : InboundReaction,
) -> ReactionWakeDisposition {
  if reaction.useful {
    ActWhenUseful(reason="reaction useful; act without forced reply")
  } else {
    WakeNoReply
  }
}

///|
/// Plan outbound for a reaction wake: never force a reply envelope.
pub(all) struct ReactionOutboundPlan {
  disposition : ReactionWakeDisposition
  reply_forced : Bool
  outbound_count : Int32
} derive(Eq, Debug)

///|
pub extend ReactionOutboundPlan with Eq::{equal, not_equal}

///|
pub extend ReactionOutboundPlan with Debug::{to_repr}

///|
pub fn plan_reaction_outbound(
  reaction : InboundReaction,
) -> ReactionOutboundPlan {
  let disposition = handle_inbound_reaction(reaction)
  { disposition, reply_forced: false, outbound_count: 0, }
}
