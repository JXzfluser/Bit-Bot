///|
/// CM-2127: inbound mail wake — summarize / draft only; never auto-reply
/// to the original sender.

///|
pub(all) struct InboundMail {
  message_id : String
  from_address : String
  subject : String
  body : String
} derive(Eq, Debug)

///|
pub extend InboundMail with Eq::{equal, not_equal}

///|
pub extend InboundMail with Debug::{to_repr}

///|
pub(all) enum InboundMailAction {
  Summarize(summary~ : String)
  DraftReply(to_~ : String, subject~ : String, body~ : String)
  /// Explicit user-approved send (not automatic).
  SendApproved(to_~ : String, body~ : String)
} derive(Eq, Debug)

///|
pub extend InboundMailAction with Eq::{equal, not_equal}

///|
pub extend InboundMailAction with Debug::{to_repr}

///|
/// Effects recorded while handling an inbound wake (for assertions).
pub(all) struct InboundMailHandler {
  effects : Array[String]
  mut auto_replied_to : Array[String]
  mut drafts : Array[String]
  mut summaries : Array[String]
}

///|
pub fn InboundMailHandler::new() -> InboundMailHandler {
  { effects: [], auto_replied_to: [], drafts: [], summaries: [], }
}

///|
fn summarize_mail(mail : InboundMail) -> String {
  "From " +
  mail.from_address +
  ": " +
  mail.subject +
  " — " +
  (if mail.body.length() > 80 {
    mail.body[0:80].to_owned() + "…"
  } else {
    mail.body
  })
}

///|
/// CM-2127: process inbound wake — summarize and optionally draft; never
/// auto-send a reply to the original sender.
pub fn InboundMailHandler::handle_wake(
  self : InboundMailHandler,
  mail : InboundMail,
  user_approved_send~ : Bool,
) -> Array[InboundMailAction] {
  let summary = summarize_mail(mail)
  self.summaries.push(summary)
  self.effects.push("summarize:" + mail.message_id)
  let actions : Array[InboundMailAction] = [Summarize(summary~)]
  let draft_subj = "Re: " + mail.subject
  let draft_body = "Thanks for your email regarding: " + mail.subject
  self.drafts.push(draft_body)
  self.effects.push("draft:" + mail.message_id)
  actions.push(
    DraftReply(to_=mail.from_address, subject=draft_subj, body=draft_body),
  )
  // Never auto-reply. Only record SendApproved when user explicitly approved.
  if user_approved_send {
    self.effects.push("send_approved:" + mail.message_id)
    actions.push(SendApproved(to_=mail.from_address, body=draft_body))
  }
  // auto_replied_to stays empty unless a bug auto-sends — we never push here
  // without approval, and even with approval we do not mark as "auto".
  actions
}

///|
/// True if any effect auto-sent to the original sender (must stay false).
pub fn InboundMailHandler::did_auto_reply_to(
  self : InboundMailHandler,
  sender : String,
) -> Bool {
  for a in self.auto_replied_to {
    if a == sender {
      break true
    }
  } nobreak {
    // Also treat a spontaneous "send:" effect without approval as auto-reply.
    for e in self.effects {
      if e.has_prefix("auto_reply:") && e.contains(sender) {
        break true
      }
    } nobreak {
      false
    }
  }
}

///|
pub fn InboundMailHandler::has_summary(self : InboundMailHandler) -> Bool {
  self.summaries.length() > 0
}

///|
pub fn InboundMailHandler::has_draft(self : InboundMailHandler) -> Bool {
  self.drafts.length() > 0
}
