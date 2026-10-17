///|
/// CM-2162: child NeedApproval report bubbles so parent sees ApprovalCard.
pub(all) struct ApprovalCard {
  id : String
  child_id : String
  summary : String
  visible_to_parent : Bool
} derive(Eq, Debug)

///|
pub extend ApprovalCard with Eq::{equal, not_equal}

///|
pub extend ApprovalCard with Debug::{to_repr}

///|
pub fn ApprovalCard::is_visible_to_parent(self : ApprovalCard) -> Bool {
  self.visible_to_parent
}

///|
/// Child-side NeedApproval report (abstract — no real secrets).
pub(all) struct NeedApprovalReport {
  child_id : String
  request_id : String
  summary : String
  class_label : String
} derive(Eq, Debug)

///|
pub extend NeedApprovalReport with Eq::{equal, not_equal}

///|
pub extend NeedApprovalReport with Debug::{to_repr}

///|
pub fn NeedApprovalReport::make(
  child_id~ : String,
  request_id~ : String,
  summary~ : String,
  class_label~ : String = "Shell",
) -> NeedApprovalReport {
  { child_id, request_id, summary, class_label, }
}

///|
/// Parent view of bubbled approval cards.
pub(all) struct ParentApprovalView {
  mut cards : Array[ApprovalCard]
}

///|
pub fn ParentApprovalView::new() -> ParentApprovalView {
  { cards: [], }
}

///|
/// CM-2162: observe child NeedApproval → ApprovalCard visible to parent.
pub fn ParentApprovalView::observe_child_need_approval(
  self : ParentApprovalView,
  report : NeedApprovalReport,
) -> ApprovalCard {
  let card : ApprovalCard = {
    id: "appr-" + report.request_id,
    child_id: report.child_id,
    summary: report.summary,
    visible_to_parent: true,
  }
  self.cards.push(card)
  card
}

///|
pub fn ParentApprovalView::visible_cards(
  self : ParentApprovalView,
) -> Array[ApprovalCard] {
  let out : Array[ApprovalCard] = []
  for c in self.cards {
    if c.visible_to_parent {
      out.push(c)
    }
  }
  out
}

///|
pub fn ParentApprovalView::has_visible_for_child(
  self : ParentApprovalView,
  child_id : String,
) -> Bool {
  for c in self.cards {
    if c.child_id == child_id && c.visible_to_parent {
      return true
    }
  }
  false
}

///|
/// Bubble helper: child report → parent card in one step.
pub fn bubble_need_approval_to_parent(
  parent : ParentApprovalView,
  report : NeedApprovalReport,
) -> ApprovalCard {
  parent.observe_child_need_approval(report)
}
