///|
/// CM-2006: first-start claim inbox — ask local part when no inbox;
/// do NOT default-generate; no claim without selection.

///|
pub(all) enum ClaimGuidePhase {
  /// No inbox yet — must ask user for a local part.
  AskLocalPart
  /// User named a candidate; awaiting confirmation card.
  AwaitingSelection(local_part~ : String)
  /// Claimed successfully.
  Claimed(inbox~ : InboxId)
} derive(Eq, Debug)

///|
pub extend ClaimGuidePhase with Eq::{equal, not_equal}

///|
pub extend ClaimGuidePhase with Debug::{to_repr}

///|
pub fn ClaimGuidePhase::is_ask_local_part(self : ClaimGuidePhase) -> Bool {
  match self {
    AskLocalPart => true
    _ => false
  }
}

///|
/// First-start claim session over a MailService.
pub(all) struct FirstStartClaimGuide {
  service : MailService
  mut phase : ClaimGuidePhase
  /// Prompt shown when asking for local part (never a generated default).
  ask_prompt : String
}

///|
/// CM-2006: open first-start guide — if no inbox, enter AskLocalPart (no default).
pub fn FirstStartClaimGuide::open(
  service : MailService,
) -> FirstStartClaimGuide {
  let phase = if service.list_inboxes().length() == 0 {
    AskLocalPart
  } else {
    Claimed(inbox=service.list_inboxes()[0])
  }
  {
    service,
    phase,
    ask_prompt: "Choose a local part for your bot inbox (e.g. yourname). Do not leave blank; nothing is generated for you.",
  }
}

///|
/// Must not invent / UUID / random local part when asking.
pub fn FirstStartClaimGuide::suggested_default_local_part(
  self : FirstStartClaimGuide,
) -> String? {
  let _ = self
  // CM-2006: never default-generate.
  None
}

///|
/// Record user-chosen local part (still no claim until confirm).
pub fn FirstStartClaimGuide::select_local_part(
  self : FirstStartClaimGuide,
  local_part~ : String,
) -> Result[Unit, String] {
  match self.phase {
    AskLocalPart => {
      if local_part.length() == 0 {
        return Err("local part must be chosen by the user; empty not allowed")
      }
      if local_part == "random" ||
        local_part.has_prefix("rnd-") ||
        local_part.has_prefix("uuid-") {
        return Err("must not default-generate or invent local part")
      }
      self.phase = AwaitingSelection(local_part~)
      Ok(())
    }
    _ => Err("not in AskLocalPart phase")
  }
}

///|
/// Claim only after user selection + confirmation; no selection → refuse.
pub fn FirstStartClaimGuide::claim_after_selection(
  self : FirstStartClaimGuide,
  user_confirmed~ : Bool,
) -> Result[InboxId, String] {
  match self.phase {
    AskLocalPart => Err("no claim without selection: ask local part first")
    AwaitingSelection(local_part~) => {
      if !user_confirmed {
        return Err(
          "claim requires user confirmation; no claim without selection",
        )
      }
      match self.service.claim_inbox(local_part~, user_confirmed=true) {
        Err(e) => Err(e)
        Ok(id) => {
          self.phase = Claimed(inbox=id)
          Ok(id)
        }
      }
    }
    Claimed(_) => Err("inbox already claimed")
  }
}

///|
/// Attempt claim with no prior selection — always refused.
pub fn FirstStartClaimGuide::claim_without_selection(
  self : FirstStartClaimGuide,
) -> Result[InboxId, String] {
  let _ = self
  Err("no claim without selection")
}
