///|
/// CM-2149: Cross-assistant no verbatim complaint relay — only actionable points;
/// Given user complains about another When SendToAgent Then diplomatic paraphrase.
/// Align carefully with CM-2141 fanout (do not weaken ask-first).

///|
/// Result of paraphrasing a user complaint about another assistant.
pub(all) struct DiplomaticParaphrase {
  /// Original user text (kept locally; must NOT be relayed verbatim).
  original : String
  /// Actionable points only — diplomatic wording for SendToAgent.
  actionable_body : String
  /// True when original looked like a complaint / vent.
  was_complaint : Bool
} derive(Eq, Debug)

///|
pub extend DiplomaticParaphrase with Eq::{equal, not_equal}

///|
pub extend DiplomaticParaphrase with Debug::{to_repr}

///|
fn looks_like_complaint(text : String) -> Bool {
  let lower = text.to_lower()
  lower.contains("complain") ||
  lower.contains("awful") ||
  lower.contains("terrible") ||
  lower.contains("hate") ||
  lower.contains("stupid") ||
  lower.contains("useless") ||
  lower.contains("抱怨") ||
  lower.contains("垃圾") ||
  lower.contains("差劲") ||
  lower.contains("always wrong") ||
  lower.contains("never works") ||
  lower.contains("sucks")
}

///|
fn extract_actionable_hint(text : String) -> String {
  let lower = text.to_lower()
  // Prefer concrete asks if present; otherwise a neutral actionable summary.
  if lower.contains("late") || lower.contains("迟到") || lower.contains("slow") {
    "Please prioritize timely responses on the pending items."
  } else if lower.contains("wrong") ||
    lower.contains("error") ||
    lower.contains("mistake") ||
    lower.contains("错") {
    "Please double-check accuracy on the recent deliverables."
  } else if lower.contains("ignore") ||
    lower.contains("missed") ||
    lower.contains("没回") {
    "Please acknowledge and follow up on the unanswered user request."
  } else if lower.contains("permission") || lower.contains("权限") {
    "Please review permission handling before the next outbound."
  } else {
    "Please address the user's concerns with concrete next steps only."
  }
}

///|
/// CM-2149: paraphrase complaint → diplomatic actionable body (never verbatim).
pub fn paraphrase_complaint_for_agent(
  user_text : String,
) -> Result[DiplomaticParaphrase, String] {
  if user_text.length() == 0 {
    return Err("complaint paraphrase requires user text")
  }
  let complaint = looks_like_complaint(user_text)
  let actionable = if complaint {
    extract_actionable_hint(user_text)
  } else {
    // Non-complaint: still strip fluff; keep concise actionable relay.
    "Relay: " + user_text
  }
  // Never copy verbatim complaint wording into actionable body.
  if complaint && actionable == user_text {
    return Err("diplomatic paraphrase must not equal verbatim complaint")
  }
  Ok({
    original: user_text,
    actionable_body: actionable,
    was_complaint: complaint,
  })
}

///|
/// True when body does not contain raw complaint/vent phrasing from original.
pub fn DiplomaticParaphrase::is_diplomatic(self : DiplomaticParaphrase) -> Bool {
  if !self.was_complaint {
    return true
  }
  // Actionable must differ from original and avoid common insult tokens.
  self.actionable_body != self.original &&
  !self.actionable_body.to_lower().contains("hate") &&
  !self.actionable_body.to_lower().contains("stupid") &&
  !self.actionable_body.to_lower().contains("useless") &&
  !self.actionable_body.to_lower().contains("awful") &&
  !self.actionable_body.contains("抱怨") &&
  !self.actionable_body.contains("垃圾")
}

///|
/// CM-2149: SendToAgent with diplomatic paraphrase (not verbatim complaint).
pub fn SendToAgentBus::send_diplomatic(
  self : SendToAgentBus,
  from_id~ : String,
  to_id~ : String,
  user_complaint~ : String,
) -> Result[(AgentMessage, DiplomaticParaphrase), String] {
  match paraphrase_complaint_for_agent(user_complaint) {
    Err(e) => Err(e)
    Ok(para) => {
      if !para.is_diplomatic() {
        return Err("refusing non-diplomatic relay of complaint")
      }
      // Never put original complaint body on the wire.
      if para.was_complaint && para.actionable_body == user_complaint {
        return Err("verbatim complaint relay forbidden")
      }
      match self.send(
        from_id~,
        to_id~,
        body=para.actionable_body,
        user_visible=false,
      ) {
        Err(e) => Err(e)
        Ok(msg) => Ok((msg, para))
      }
    }
  }
}
