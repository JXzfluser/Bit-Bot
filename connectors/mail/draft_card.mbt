///|
/// CM-1005: DraftExternalMessage card — editable; send only after user presses Send.
pub(all) struct DraftEmailCard {
  to_ : String
  subject : String
  body : String
  mut user_pressed_send : Bool
} derive(Eq, Debug)

///|
pub extend DraftEmailCard with Eq::{equal, not_equal}

///|
pub extend DraftEmailCard with Debug::{to_repr}

///|
pub fn DraftEmailCard::new(
  to_~ : String,
  subject~ : String,
  body~ : String,
) -> DraftEmailCard {
  { to_, subject, body, user_pressed_send: false, }
}

///|
pub fn DraftEmailCard::edit(
  self : DraftEmailCard,
  to_~ : String? = None,
  subject~ : String? = None,
  body~ : String? = None,
) -> DraftEmailCard {
  {
    to_: match to_ {
      Some(v) => v
      None => self.to_
    },
    subject: match subject {
      Some(v) => v
      None => self.subject
    },
    body: match body {
      Some(v) => v
      None => self.body
    },
    user_pressed_send: false,
  }
}

///|
pub fn DraftEmailCard::press_send(self : DraftEmailCard) -> Unit {
  self.user_pressed_send = true
}

///|
/// Outbound only after user pressed Send on the card.
pub fn DraftEmailCard::try_send(
  self : DraftEmailCard,
) -> Result[String, String] {
  if !self.user_pressed_send {
    Err("card not sent: user must press Send")
  } else {
    Ok("sent to " + self.to_ + " subject=" + self.subject)
  }
}

///|
/// CM-1005 + CM-1501: planning mail without explicit send → DraftOutbound only.
pub fn plan_email_without_explicit_send(
  to_~ : String,
  subject~ : String,
  body~ : String,
) -> @security.ConsequentialOutcome {
  let gate = @security.ApprovalGate::default()
  let req = @security.ApprovalRequest::{
    id: "mail-draft",
    class_: @security.ExternalSend,
    summary: subject,
    payload_json: "{\"to\":\"" + to_ + "\"}",
    irreversible: true,
  }
  gate.plan_consequential(
    req,
    explicit_user_request=false,
    draft_body="To: " + to_ + "\nSubject: " + subject + "\n\n" + body,
  )
}
