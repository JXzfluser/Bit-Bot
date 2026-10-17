///|
/// CM-2142: draft card shown → user says send → send exactly as drafted once (no agent edits).
pub(all) struct FrozenDraft {
  to_ : String
  subject : String
  body : String
} derive(Eq, Debug)

///|
pub extend FrozenDraft with Eq::{equal, not_equal}

///|
pub extend FrozenDraft with Debug::{to_repr}

///|
pub(all) struct VerbatimSendReceipt {
  to_ : String
  subject : String
  body : String
  send_count : Int32
} derive(Eq, Debug)

///|
pub extend VerbatimSendReceipt with Eq::{equal, not_equal}

///|
pub extend VerbatimSendReceipt with Debug::{to_repr}

///|
/// Session: freeze draft at show time; user "send" emits frozen content once.
pub(all) struct VerbatimSendSession {
  frozen : FrozenDraft
  mut card_shown : Bool
  mut send_count : Int32
  mut last_receipt : VerbatimSendReceipt?
}

///|
/// Show draft card — freezes to/subject/body for verbatim send.
pub fn VerbatimSendSession::show_draft_card(
  to_~ : String,
  subject~ : String,
  body~ : String,
) -> VerbatimSendSession {
  {
    frozen: { to_, subject, body, },
    card_shown: true,
    send_count: 0,
    last_receipt: None,
  }
}

///|
/// Agent attempts to mutate after card is shown — rejected (CM-2142: no edits at send).
pub fn VerbatimSendSession::agent_try_edit(
  self : VerbatimSendSession,
  body~ : String,
) -> Result[Unit, String] {
  let _ = body
  if self.card_shown {
    Err("verbatim: agent must not edit draft after card shown")
  } else {
    Ok(())
  }
}

///|
/// User says "send" → emit frozen draft exactly once.
pub fn VerbatimSendSession::user_says_send(
  self : VerbatimSendSession,
) -> Result[VerbatimSendReceipt, String] {
  if !self.card_shown {
    return Err("verbatim: card not shown")
  }
  if self.send_count >= 1 {
    return Err("verbatim: already sent once; refuse second send")
  }
  self.send_count = self.send_count + 1
  let receipt : VerbatimSendReceipt = {
    to_: self.frozen.to_,
    subject: self.frozen.subject,
    body: self.frozen.body,
    send_count: self.send_count,
  }
  self.last_receipt = Some(receipt)
  Ok(receipt)
}

///|
pub fn VerbatimSendReceipt::matches_frozen(
  self : VerbatimSendReceipt,
  frozen : FrozenDraft,
) -> Bool {
  self.to_ == frozen.to_ &&
  self.subject == frozen.subject &&
  self.body == frozen.body
}
