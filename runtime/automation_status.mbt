///|
/// CM-2007: system reminder automation_status / timestamp.
/// Routine phase must use the latest timestamp.

///|
pub(all) enum RoutinePhase {
  Idle
  Scheduled
  Running
  Completed
  Failed
} derive(Eq, Debug)

///|
pub extend RoutinePhase with Eq::{equal, not_equal}

///|
pub extend RoutinePhase with Debug::{to_repr}

///|
pub fn RoutinePhase::label(self : RoutinePhase) -> String {
  match self {
    Idle => "idle"
    Scheduled => "scheduled"
    Running => "running"
    Completed => "completed"
    Failed => "failed"
  }
}

///|
/// One automation_status snapshot injected as a system reminder.
pub(all) struct AutomationStatus {
  routine_id : String
  phase : RoutinePhase
  /// Latest event timestamp (RFC3339); phase reporting must use this value.
  timestamp : String
  summary : String
} derive(Eq, Debug)

///|
pub extend AutomationStatus with Eq::{equal, not_equal}

///|
pub extend AutomationStatus with Debug::{to_repr}

///|
pub fn AutomationStatus::new(
  routine_id~ : String,
  phase~ : RoutinePhase,
  timestamp~ : String,
  summary~ : String,
) -> AutomationStatus {
  { routine_id, phase, timestamp, summary, }
}

///|
/// Tracker that always surfaces the newest timestamp for the routine phase.
pub(all) struct AutomationStatusTracker {
  mut current : AutomationStatus?
  history : Array[String]
}

///|
pub fn AutomationStatusTracker::new() -> AutomationStatusTracker {
  { current: None, history: [], }
}

///|
/// Record a phase update. The latest timestamp wins for subsequent reports.
pub fn AutomationStatusTracker::update(
  self : AutomationStatusTracker,
  routine_id~ : String,
  phase~ : RoutinePhase,
  timestamp~ : String,
  summary~ : String,
) -> Unit {
  self.history.push(timestamp)
  self.current = Some(
    AutomationStatus::new(routine_id~, phase~, timestamp~, summary~),
  )
}

///|
/// Build the system-reminder text; phase line uses the latest timestamp.
pub fn AutomationStatusTracker::reminder_text(
  self : AutomationStatusTracker,
) -> String {
  match self.current {
    None => "automation_status: none"
    Some(s) =>
      "automation_status: routine=" +
      s.routine_id +
      " phase=" +
      s.phase.label() +
      " timestamp=" +
      s.timestamp +
      " summary=" +
      s.summary
  }
}

///|
/// Latest timestamp recorded (for acceptance assertions).
pub fn AutomationStatusTracker::latest_timestamp(
  self : AutomationStatusTracker,
) -> String? {
  match self.current {
    Some(s) => Some(s.timestamp)
    None => None
  }
}

///|
/// True when reminder embeds the given timestamp (latest).
pub fn AutomationStatusTracker::reminder_uses_timestamp(
  self : AutomationStatusTracker,
  ts : String,
) -> Bool {
  self.reminder_text().contains("timestamp=" + ts)
}

///|
/// CM-0417: one routine line for the system reminder — id + folder, no prompt.
pub(all) struct RoutineStatusEntry {
  routine_id : String
  folder_id : String
} derive(Eq, Debug)

///|
pub extend RoutineStatusEntry with Eq::{equal, not_equal}

///|
pub extend RoutineStatusEntry with Debug::{to_repr}

///|
pub fn RoutineStatusEntry::new(
  routine_id~ : String,
  folder_id~ : String,
) -> RoutineStatusEntry {
  { routine_id, folder_id, }
}

///|
/// CM-0417: build automation_status reminder listing routines + folder ids.
/// Must NOT embed any routine prompt body.
pub fn build_routines_status_reminder(
  entries : Array[RoutineStatusEntry],
) -> String {
  if entries.length() == 0 {
    return "automation_status: routines=[]"
  }
  let mut out = "automation_status: routines=["
  let mut i = 0
  while i < entries.length() {
    let e = entries[i]
    if i > 0 {
      out = out + "; "
    }
    out = out + "id=" + e.routine_id + " folder=" + e.folder_id
    i = i + 1
  }
  out + "]"
}

///|
/// True when reminder wrongly contains a prompt body (must stay false).
pub fn reminder_contains_prompt_body(
  reminder : String,
  prompt : String,
) -> Bool {
  if prompt.length() == 0 {
    false
  } else {
    reminder.contains(prompt)
  }
}

///|
/// Tracker helper: list reminder from entries (CM-0417).
pub fn AutomationStatusTracker::routines_reminder(
  self : AutomationStatusTracker,
  entries : Array[RoutineStatusEntry],
) -> String {
  let _ = self
  build_routines_status_reminder(entries)
}
