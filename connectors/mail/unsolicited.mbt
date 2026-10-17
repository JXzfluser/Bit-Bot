///|
/// CM-1009: unsolicited / cold outreach — single recipient + unsubscribe;
/// card send does not support cold outreach; multi-recipient violation rejected.

///|
/// Kind of outbound mail outreach.
pub(all) enum OutreachKind {
  /// Known prior relationship / reply / explicit user ask.
  Solicited
  /// Cold / unsolicited outreach (requires single To + unsubscribe).
  UnsolicitedCold
} derive(Eq, Debug)

///|
pub extend OutreachKind with Eq::{equal, not_equal}

///|
pub extend OutreachKind with Debug::{to_repr}

///|
/// Planned cold / unsolicited mail payload.
pub(all) struct UnsolicitedMailPlan {
  recipients : Array[String]
  subject : String
  body : String
  /// Unsubscribe URL or mailto; required for cold.
  unsubscribe : String?
  kind : OutreachKind
} derive(Eq, Debug)

///|
pub extend UnsolicitedMailPlan with Eq::{equal, not_equal}

///|
pub extend UnsolicitedMailPlan with Debug::{to_repr}

///|
pub fn UnsolicitedMailPlan::cold(
  to_ : String,
  subject~ : String,
  body~ : String,
  unsubscribe~ : String,
) -> UnsolicitedMailPlan {
  {
    recipients: [to_],
    subject,
    body,
    unsubscribe: Some(unsubscribe),
    kind: UnsolicitedCold,
  }
}

///|
/// Validation outcome for unsolicited / cold mail.
pub(all) enum UnsolicitedMailVerdict {
  Allowed
  Rejected(reason~ : String)
} derive(Eq, Debug)

///|
pub extend UnsolicitedMailVerdict with Eq::{equal, not_equal}

///|
pub extend UnsolicitedMailVerdict with Debug::{to_repr}

///|
pub fn UnsolicitedMailVerdict::is_rejected(
  self : UnsolicitedMailVerdict,
) -> Bool {
  match self {
    Rejected(_) => true
    Allowed => false
  }
}

///|
/// CM-1009: cold mail must be single recipient + non-empty unsubscribe.
pub fn validate_unsolicited_mail(
  plan : UnsolicitedMailPlan,
) -> UnsolicitedMailVerdict {
  match plan.kind {
    Solicited => Allowed
    UnsolicitedCold => {
      if plan.recipients.length() == 0 {
        return Rejected(reason="cold outreach requires exactly one recipient")
      }
      if plan.recipients.length() > 1 {
        return Rejected(
          reason="multi-recipient cold outreach is a violation; rejected",
        )
      }
      match plan.unsubscribe {
        None =>
          Rejected(reason="cold outreach requires unsubscribe link or mailto")
        Some(u) =>
          if u.trim().length() == 0 {
            Rejected(reason="cold outreach requires unsubscribe link or mailto")
          } else {
            Allowed
          }
      }
    }
  }
}

///|
/// CM-1009: DraftExternalMessage / card send does NOT support cold outreach.
pub fn card_send_supports_cold_outreach() -> Bool {
  false
}

///|
/// Attempt to send via card path for a cold plan → always refuse.
pub fn try_card_send_cold(plan : UnsolicitedMailPlan) -> Result[String, String] {
  let _ = plan
  if !card_send_supports_cold_outreach() {
    Err("card send does not support cold / unsolicited outreach")
  } else {
    Ok("unreachable")
  }
}

///|
/// Validate then (mock) accept only when Allowed; card path still blocked for cold.
pub fn plan_unsolicited_send(
  plan : UnsolicitedMailPlan,
  via_card~ : Bool,
) -> Result[String, String] {
  match validate_unsolicited_mail(plan) {
    Rejected(reason~) => Err(reason)
    Allowed =>
      if via_card && plan.kind == UnsolicitedCold {
        try_card_send_cold(plan)
      } else {
        Ok("planned cold to " + plan.recipients[0] + " with unsubscribe")
      }
  }
}
