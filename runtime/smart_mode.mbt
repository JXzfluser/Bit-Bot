///|
/// CM-1503: smart-mode retry must replay the same fingerprint; rewrite = deny.
pub(all) struct SmartModePending {
  request_id : String
  class_ : @security.ApprovalClass
  payload_json : String
  block_reason : String
} derive(Eq, Debug)

///|
pub extend SmartModePending with Eq::{equal, not_equal}

///|
pub extend SmartModePending with Debug::{to_repr}

///|
pub fn SmartModePending::fingerprint(self : SmartModePending) -> String {
  self.request_id + "|" + self.payload_json
}

///|
pub fn smart_mode_resume(
  pending : SmartModePending,
  retry_id : String,
  retry_payload : String,
  user_approved : Bool,
) -> @security.ApprovalDecision {
  if !user_approved {
    return @security.Deny(reason="user denied")
  }
  if retry_id != pending.request_id || retry_payload != pending.payload_json {
    return @security.Deny(reason="smart-mode: payload rewritten; refuse bypass")
  }
  @security.Allow
}

///|
pub fn capture_need_user(
  gate : @security.ApprovalGate,
  req : @security.ApprovalRequest,
) -> SmartModePending? {
  match gate.review(req) {
    @security.NeedUser(reason~) =>
      Some({
        request_id: req.id,
        class_: req.class_,
        payload_json: req.payload_json,
        block_reason: reason,
      })
    _ => None
  }
}
