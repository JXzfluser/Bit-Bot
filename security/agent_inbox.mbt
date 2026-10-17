///|
/// CM-2169: executor Agent Inbox limits — may not send; only report draft to parent.
pub(all) struct AgentInboxDraft {
  to_ : String
  subject : String
  body : String
} derive(Eq, Debug)

///|
pub extend AgentInboxDraft with Eq::{equal, not_equal}

///|
pub extend AgentInboxDraft with Debug::{to_repr}

///|
pub(all) enum AgentInboxSendOutcome {
  /// Unauthorized send attempted — blocked; draft reported to parent instead.
  ReportDraftToParent(draft~ : AgentInboxDraft, reason~ : String)
  /// Should never succeed for executor without parent authorization.
  Sent(receipt~ : String)
} derive(Eq, Debug)

///|
pub extend AgentInboxSendOutcome with Eq::{equal, not_equal}

///|
pub extend AgentInboxSendOutcome with Debug::{to_repr}

///|
pub fn AgentInboxSendOutcome::sent_unauthorized(
  self : AgentInboxSendOutcome,
) -> Bool {
  match self {
    Sent(_) => true
    ReportDraftToParent(_) => false
  }
}

///|
pub fn AgentInboxSendOutcome::reported_draft_only(
  self : AgentInboxSendOutcome,
) -> Bool {
  match self {
    ReportDraftToParent(_) => true
    Sent(_) => false
  }
}

///|
/// Executor-facing Agent Inbox guard (no unauthorized send).
pub(all) struct AgentInboxGuard {
  /// Executor must always be false for outbound from agent inbox.
  may_send_from_inbox : Bool
  mut unauthorized_send_attempts : Int32
  mut last_report : AgentInboxDraft?
}

///|
pub fn AgentInboxGuard::executor() -> AgentInboxGuard {
  {
    may_send_from_inbox: false,
    unauthorized_send_attempts: 0,
    last_report: None,
  }
}

///|
/// CM-2169: would-send from agent inbox → report draft to parent only.
pub fn AgentInboxGuard::try_send(
  self : AgentInboxGuard,
  draft : AgentInboxDraft,
) -> AgentInboxSendOutcome {
  if self.may_send_from_inbox {
    Sent(receipt="sent:" + draft.to_ + ":" + draft.subject)
  } else {
    self.unauthorized_send_attempts = self.unauthorized_send_attempts + 1
    self.last_report = Some(draft)
    ReportDraftToParent(
      draft~,
      reason="agent inbox: executor must not send; report draft to parent",
    )
  }
}

///|
pub fn AgentInboxGuard::last_draft_for_parent(
  self : AgentInboxGuard,
) -> AgentInboxDraft? {
  self.last_report
}
