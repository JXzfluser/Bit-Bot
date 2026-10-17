///|
/// CM-2177: executor stops at draft; parent-facing message contains full draft text.
/// Extends Agent Inbox draft reporting without changing CM-2169 send guard.

///|
pub(all) struct ExecutorParentDraftMessage {
  /// Full draft text embedded for the parent (to / subject / body).
  text : String
  draft : AgentInboxDraft
  /// Executor must not have sent.
  sent : Bool
  stopped_at_draft : Bool
} derive(Eq, Debug)

///|
pub extend ExecutorParentDraftMessage with Eq::{equal, not_equal}

///|
pub extend ExecutorParentDraftMessage with Debug::{to_repr}

///|
fn format_full_draft(draft : AgentInboxDraft) -> String {
  "DRAFT_TO_PARENT\nto: " +
  draft.to_ +
  "\nsubject: " +
  draft.subject +
  "\nbody:\n" +
  draft.body
}

///|
/// CM-2177: executor finishes by reporting the full draft to parent (no send).
pub fn executor_report_draft_to_parent(
  draft : AgentInboxDraft,
) -> ExecutorParentDraftMessage {
  let inbox_guard = AgentInboxGuard::executor()
  let outcome = inbox_guard.try_send(draft)
  let _ = outcome
  let text = format_full_draft(draft)
  { text, draft, sent: false, stopped_at_draft: true, }
}

///|
pub fn ExecutorParentDraftMessage::contains_full_draft(
  self : ExecutorParentDraftMessage,
) -> Bool {
  self.text.contains(self.draft.to_) &&
  self.text.contains(self.draft.subject) &&
  self.text.contains(self.draft.body) &&
  self.stopped_at_draft &&
  !self.sent
}
