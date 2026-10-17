///|
/// CM-2155: Origin routine trigger event subset — only documented PR events:
/// pr-opened / pushed / merged / comment.

///|
pub(all) enum OriginTriggerEvent {
  PrOpened
  Pushed
  Merged
  Comment
} derive(Eq, Debug)

///|
pub extend OriginTriggerEvent with Eq::{equal, not_equal}

///|
pub extend OriginTriggerEvent with Debug::{to_repr}

///|
pub fn OriginTriggerEvent::label(self : OriginTriggerEvent) -> String {
  match self {
    PrOpened => "pr-opened"
    Pushed => "pushed"
    Merged => "merged"
    Comment => "comment"
  }
}

///|
/// Documented allowed Origin trigger event labels (exact subset).
pub fn allowed_origin_trigger_events() -> Array[String] {
  ["pr-opened", "pushed", "merged", "comment"]
}

///|
pub fn OriginTriggerEvent::from_label(
  label : String,
) -> Result[OriginTriggerEvent, String] {
  let t = label.to_lower()
  if t == "pr-opened" || t == "pr_opened" || t == "opened" {
    Ok(PrOpened)
  } else if t == "pushed" || t == "push" {
    Ok(Pushed)
  } else if t == "merged" || t == "merge" {
    Ok(Merged)
  } else if t == "comment" || t == "pr-comment" {
    Ok(Comment)
  } else {
    Err(
      "origin trigger event not in documented subset (pr-opened/pushed/merged/comment): " +
      label,
    )
  }
}

///|
/// Given origin trigger When validate Then only documented events allowed.
pub fn validate_origin_trigger_event(event : String) -> Result[Unit, String] {
  match OriginTriggerEvent::from_label(event) {
    Ok(_) => Ok(())
    Err(e) => Err(e)
  }
}

///|
/// True when label is exactly one of the four documented events (canonical form).
pub fn is_canonical_origin_trigger_event(event : String) -> Bool {
  let allowed = allowed_origin_trigger_events()
  for a in allowed {
    if a == event {
      return true
    }
  }
  false
}

///|
/// Register an Origin trigger — rejects events outside the subset.
pub fn register_origin_trigger_event(
  repo~ : String,
  event~ : String,
) -> Result[OriginTriggerEvent, String] {
  if repo.length() == 0 {
    return Err("origin trigger repo must not be empty")
  }
  match OriginTriggerEvent::from_label(event) {
    Err(e) => Err(e)
    Ok(ev) => Ok(ev)
  }
}
