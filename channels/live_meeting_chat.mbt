///|
/// CM-2153: Live meeting chat outbound exception — live meeting chat may send
/// non-draft-card when skill allows. Kernel-contract (skills + channels).

///|
/// Outbound mode for channel send planning.
pub(all) enum OutboundSendMode {
  /// Default: show draft card; send only after user press.
  DraftCard
  /// Exception: direct send without draft card (skill-gated).
  DirectSend
} derive(Eq, Debug)

///|
pub extend OutboundSendMode with Eq::{equal, not_equal}

///|
pub extend OutboundSendMode with Debug::{to_repr}

///|
pub fn OutboundSendMode::is_draft_card(self : OutboundSendMode) -> Bool {
  match self {
    DraftCard => true
    DirectSend => false
  }
}

///|
pub fn OutboundSendMode::is_direct(self : OutboundSendMode) -> Bool {
  match self {
    DirectSend => true
    DraftCard => false
  }
}

///|
/// Context for a live meeting chat outbound attempt.
pub(all) struct LiveMeetingChatContext {
  /// True when the channel is live meeting chat (not ordinary DM/mail).
  is_live_meeting_chat : Bool
  /// True when the meetings / live-meeting skill explicitly allows direct send.
  skill_allows_direct_send : Bool
  body : String
} derive(Eq, Debug)

///|
pub extend LiveMeetingChatContext with Eq::{equal, not_equal}

///|
pub extend LiveMeetingChatContext with Debug::{to_repr}

///|
/// CM-2153: plan outbound — live meeting chat + skill allow → non-draft DirectSend;
/// otherwise DraftCard.
pub fn plan_live_meeting_chat_outbound(
  ctx : LiveMeetingChatContext,
) -> Result[OutboundSendMode, String] {
  if ctx.body.length() == 0 {
    return Err("live meeting chat outbound requires body")
  }
  if ctx.is_live_meeting_chat && ctx.skill_allows_direct_send {
    Ok(DirectSend)
  } else {
    Ok(DraftCard)
  }
}

///|
/// Execute planned mode: DirectSend returns sent body; DraftCard returns pending card.
pub(all) enum LiveMeetingChatOutboundResult {
  SentDirect(body~ : String)
  PendingDraftCard(body~ : String)
} derive(Eq, Debug)

///|
pub extend LiveMeetingChatOutboundResult with Eq::{equal, not_equal}

///|
pub extend LiveMeetingChatOutboundResult with Debug::{to_repr}

///|
pub fn LiveMeetingChatOutboundResult::used_draft_card(
  self : LiveMeetingChatOutboundResult,
) -> Bool {
  match self {
    PendingDraftCard(_) => true
    SentDirect(_) => false
  }
}

///|
pub fn execute_live_meeting_chat_outbound(
  ctx : LiveMeetingChatContext,
) -> Result[LiveMeetingChatOutboundResult, String] {
  match plan_live_meeting_chat_outbound(ctx) {
    Err(e) => Err(e)
    Ok(mode) =>
      match mode {
        DirectSend => Ok(SentDirect(body=ctx.body))
        DraftCard => Ok(PendingDraftCard(body=ctx.body))
      }
  }
}
