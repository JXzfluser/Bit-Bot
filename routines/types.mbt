///|
pub(all) enum Trigger {
  Cron(expr~ : String)
  Event(name~ : String)
  Manual
  Interval(seconds~ : Int32)
} derive(Eq, Debug)

///|
pub extend Trigger with Eq::{not_equal, equal}

///|
pub extend Trigger with Debug::{to_repr}

///|
pub(all) struct Schedule {
  trigger : Trigger
  timezone : String
  enabled : Bool
} derive(Eq, Debug)

///|
pub extend Schedule with Eq::{not_equal, equal}

///|
pub extend Schedule with Debug::{to_repr}

///|
pub(all) enum LifecycleState {
  Draft
  Active
  Paused
  Retired
} derive(Eq, Debug)

///|
pub extend LifecycleState with Eq::{not_equal, equal}

///|
pub extend LifecycleState with Debug::{to_repr}

///|
pub(all) struct Lifecycle {
  mut state : LifecycleState
  last_run_ms : Int64?
  run_count : Int32
} derive(Eq, Debug)

///|
pub extend Lifecycle with Eq::{not_equal, equal}

///|
pub extend Lifecycle with Debug::{to_repr}

///|
pub fn Lifecycle::new() -> Lifecycle {
  { state: Draft, last_run_ms: None, run_count: 0, }
}

///|
pub fn Lifecycle::activate(self : Lifecycle) -> Unit {
  self.state = Active
}

///|
pub(all) struct Routine {
  id : String
  title : String
  schedule : Schedule
  lifecycle : Lifecycle
  skill_ref : String?
} derive(Eq, Debug)

///|
pub extend Routine with Eq::{not_equal, equal}

///|
pub extend Routine with Debug::{to_repr}

///|
pub fn Routine::is_runnable(self : Routine) -> Bool {
  self.schedule.enabled && self.lifecycle.state == Active
}
