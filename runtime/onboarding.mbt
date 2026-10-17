///|
/// CM-2152: first-turn onboarding — non-empty description → short announce + start work
/// (skip getting-started); empty description → show getting-started.
pub(all) enum FirstTurnPlan {
  StartWork(announce~ : String)
  ShowGettingStarted
} derive(Eq, Debug)

///|
pub extend FirstTurnPlan with Eq::{equal, not_equal}

///|
pub extend FirstTurnPlan with Debug::{to_repr}

///|
pub fn FirstTurnPlan::skips_getting_started(self : FirstTurnPlan) -> Bool {
  match self {
    StartWork(_) => true
    ShowGettingStarted => false
  }
}

///|
pub fn FirstTurnPlan::announce_text(self : FirstTurnPlan) -> String? {
  match self {
    StartWork(announce~) => Some(announce)
    ShowGettingStarted => None
  }
}

///|
fn is_blank(s : String) -> Bool {
  let mut i = 0
  while i < s.length() {
    let c = s[i]
    if c != ' ' && c != '\t' && c != '\n' && c != '\r' {
      return false
    }
    i = i + 1
  }
  true
}

///|
/// CM-2152: plan first turn from agent description.
pub fn plan_first_turn(description~ : String) -> FirstTurnPlan {
  if is_blank(description) {
    ShowGettingStarted
  } else {
    // Short announce; do not dump getting-started checklist.
    let trimmed = trim_ws(description)
    let short = if trimmed.length() > 80 {
      trimmed[0:80].to_owned() + "…"
    } else {
      trimmed
    }
    StartWork(announce="Ready — " + short + ". Starting work.")
  }
}

///|
fn trim_ws(s : String) -> String {
  let mut start = 0
  while start < s.length() {
    let c = s[start]
    if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
      start = start + 1
    } else {
      break
    }
  }
  let mut end = s.length()
  while end > start {
    let c = s[end - 1]
    if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
      end = end - 1
    } else {
      break
    }
  }
  s[start:end].to_owned()
}

///|
/// True when a first-turn plan should begin work immediately (no getting-started).
pub fn should_start_work_immediately(description~ : String) -> Bool {
  plan_first_turn(description~).skips_getting_started()
}
