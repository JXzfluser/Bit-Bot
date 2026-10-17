///|
/// Timing flexibility for a routine schedule (CM-0401).
pub(all) enum Timing {
  Exact
  Flexible
} derive(Eq, Debug)

///|
pub extend Timing with Eq::{equal, not_equal}

///|
pub extend Timing with Debug::{to_repr}

///|
/// Editable routine specification — get returns prompt/trigger/timing for edit-from-get.
pub(all) struct RoutineSpec {
  id : String
  name : String
  prompt : String
  trigger : Trigger
  timing : Timing
  enabled : Bool
  early_minutes : Int32
  late_minutes : Int32
} derive(Eq, Debug)

///|
pub extend RoutineSpec with Eq::{equal, not_equal}

///|
pub extend RoutineSpec with Debug::{to_repr}

///|
/// Partial update — never rewrite an entire spec from memory.
pub(all) struct RoutinePatch {
  name : String?
  prompt : String?
  trigger : Trigger?
  timing : Timing?
  enabled : Bool?
  early_minutes : Int32?
  late_minutes : Int32?
} derive(Eq, Debug)

///|
pub extend RoutinePatch with Eq::{equal, not_equal}

///|
pub extend RoutinePatch with Debug::{to_repr}

///|
pub fn RoutinePatch::empty() -> RoutinePatch {
  {
    name: None,
    prompt: None,
    trigger: None,
    timing: None,
    enabled: None,
    early_minutes: None,
    late_minutes: None,
  }
}

///|
pub(all) struct RoutineStore {
  specs : Array[RoutineSpec]
  /// Parallel lifecycle state keyed by id via linear scan.
  lifecycles : Array[Lifecycle]
}

///|
pub fn RoutineStore::empty() -> RoutineStore {
  { specs: [], lifecycles: [], }
}

///|
fn RoutineStore::find_index(self : RoutineStore, id : String) -> Int32? {
  let mut i = 0
  while i < self.specs.length() {
    if self.specs[i].id == id {
      return Some(i)
    }
    i = i + 1
  }
  None
}

///|
/// CM-0401: create a routine from a full spec.
pub fn RoutineStore::create(
  self : RoutineStore,
  spec : RoutineSpec,
) -> Result[Unit, String] {
  match self.find_index(spec.id) {
    Some(_) => Err("routine already exists: " + spec.id)
    None => {
      // Validate cron trigger if present.
      match spec.trigger {
        Cron(expr~) =>
          match validate_cron(expr) {
            Err(e) => return Err(e)
            Ok(_) => ()
          }
        _ => ()
      }
      self.specs.push(spec)
      let life = Lifecycle::new()
      if spec.enabled {
        life.activate()
      }
      self.lifecycles.push(life)
      Ok(())
    }
  }
}

///|
/// CM-0401: get returns full prompt/trigger/timing for edit-from-get.
pub fn RoutineStore::get(self : RoutineStore, id : String) -> RoutineSpec? {
  match self.find_index(id) {
    None => None
    Some(i) => Some(self.specs[i])
  }
}

///|
/// CM-0401: update via patch — not rewrite from memory.
pub fn RoutineStore::update(
  self : RoutineStore,
  id : String,
  patch : RoutinePatch,
) -> Result[Unit, String] {
  match self.find_index(id) {
    None => Err("routine not found: " + id)
    Some(i) => {
      let cur = self.specs[i]
      let new_trigger = match patch.trigger {
        Some(t) => t
        None => cur.trigger
      }
      match new_trigger {
        Cron(expr~) =>
          match validate_cron(expr) {
            Err(e) => return Err(e)
            Ok(_) => ()
          }
        _ => ()
      }
      let updated : RoutineSpec = {
        id: cur.id,
        name: match patch.name {
          Some(n) => n
          None => cur.name
        },
        prompt: match patch.prompt {
          Some(p) => p
          None => cur.prompt
        },
        trigger: new_trigger,
        timing: match patch.timing {
          Some(t) => t
          None => cur.timing
        },
        enabled: match patch.enabled {
          Some(e) => e
          None => cur.enabled
        },
        early_minutes: match patch.early_minutes {
          Some(m) => m
          None => cur.early_minutes
        },
        late_minutes: match patch.late_minutes {
          Some(m) => m
          None => cur.late_minutes
        },
      }
      self.specs[i] = updated
      Ok(())
    }
  }
}

///|
/// CM-0413: pause — set lifecycle Paused; enabled false.
pub fn RoutineStore::pause(
  self : RoutineStore,
  id : String,
) -> Result[Unit, String] {
  match self.find_index(id) {
    None => Err("routine not found: " + id)
    Some(i) => {
      self.lifecycles[i].state = Paused
      let cur = self.specs[i]
      self.specs[i] = { ..cur, enabled: false, }
      Ok(())
    }
  }
}

///|
/// CM-0413: resume — Active + enabled.
pub fn RoutineStore::resume_routine(
  self : RoutineStore,
  id : String,
) -> Result[Unit, String] {
  match self.find_index(id) {
    None => Err("routine not found: " + id)
    Some(i) => {
      self.lifecycles[i].state = Active
      let cur = self.specs[i]
      self.specs[i] = { ..cur, enabled: true, }
      Ok(())
    }
  }
}

///|
pub fn RoutineStore::lifecycle_of(
  self : RoutineStore,
  id : String,
) -> LifecycleState? {
  match self.find_index(id) {
    None => None
    Some(i) => Some(self.lifecycles[i].state)
  }
}

///|
pub fn RoutineStore::is_fireable(self : RoutineStore, id : String) -> Bool {
  match self.find_index(id) {
    None => false
    Some(i) => {
      let spec = self.specs[i]
      let life = self.lifecycles[i]
      spec.enabled && life.state == Active
    }
  }
}

///|
fn is_digits(s : String) -> Bool {
  if s.length() == 0 {
    return false
  }
  for i = 0; i < s.length(); i = i + 1 {
    let c = s[i]
    if c < '0' || c > '9' {
      return false
    }
  }
  true
}

///|
fn parse_u_int(s : String) -> Int32? {
  if !is_digits(s) {
    return None
  }
  let mut n = 0
  for i = 0; i < s.length(); i = i + 1 {
    n = n * 10 + (s[i].to_int() - '0'.to_int())
  }
  Some(n)
}

///|
fn cron_field_count(expr : String) -> Int32 {
  let parts = expr.split(" ").to_array()
  let mut n = 0
  for p in parts {
    if p.to_owned().length() > 0 {
      n = n + 1
    }
  }
  n
}

///|
/// CM-0402: 5-field cron or @hourly/@daily/@weekly/@every Nm;
/// reject denser than 5 minutes for @every.
/// Accepts optional `CRON_TZ=<iana> ` prefix (stripped before validation).
pub fn validate_cron(expr : String) -> Result[Unit, String] {
  let (_, body) = parse_cron_tz_prefix(expr)
  validate_cron_body(body)
}

///|
fn validate_cron_body(expr : String) -> Result[Unit, String] {
  if expr.length() == 0 {
    return Err("cron expression must not be empty")
  }
  if expr == "@hourly" || expr == "@daily" || expr == "@weekly" {
    return Ok(())
  }
  if expr.has_prefix("@every ") {
    let rest = expr[7:].to_owned()
    if rest.has_suffix("m") {
      let num_s = rest[:rest.length() - 1].to_owned()
      match parse_u_int(num_s) {
        None => Err("invalid @every minutes: " + rest)
        Some(mins) =>
          if mins < 5 {
            Err(
              "@every denser than 5 minutes is rejected (got " +
              mins.to_string() +
              "m)",
            )
          } else {
            Ok(())
          }
      }
    } else if rest.has_suffix("h") {
      let num_s = rest[:rest.length() - 1].to_owned()
      match parse_u_int(num_s) {
        None => Err("invalid @every hours: " + rest)
        Some(h) => if h < 1 { Err("@every hours must be >= 1") } else { Ok(()) }
      }
    } else {
      Err("unsupported @every unit (use Nm or Nh)")
    }
  } else {
    let n = cron_field_count(expr)
    if n == 5 {
      Ok(())
    } else {
      Err("cron must have 5 fields (got " + n.to_string() + ")")
    }
  }
}

///|
/// CM-0414: terminal wake reasons that delete the routine.
pub(all) enum TerminalWakeReason {
  PrMerged
  PrClosed
  TimedWatchEnded
} derive(Eq, Debug)

///|
pub extend TerminalWakeReason with Eq::{equal, not_equal}

///|
pub extend TerminalWakeReason with Debug::{to_repr}

///|
pub fn TerminalWakeReason::is_terminal(self : TerminalWakeReason) -> Bool {
  match self {
    PrMerged | PrClosed | TimedWatchEnded => true
  }
}

///|
/// Remove a routine by id (used by terminal delete).
pub fn RoutineStore::delete_routine(
  self : RoutineStore,
  id : String,
) -> Result[Unit, String] {
  match self.find_index(id) {
    None => Err("routine not found: " + id)
    Some(i) => {
      let new_specs : Array[RoutineSpec] = []
      let new_lives : Array[Lifecycle] = []
      let mut j = 0
      while j < self.specs.length() {
        if j != i {
          new_specs.push(self.specs[j])
          new_lives.push(self.lifecycles[j])
        }
        j = j + 1
      }
      while self.specs.length() > 0 {
        let _ = self.specs.pop()
      }
      while self.lifecycles.length() > 0 {
        let _ = self.lifecycles.pop()
      }
      for s in new_specs {
        self.specs.push(s)
      }
      for l in new_lives {
        self.lifecycles.push(l)
      }
      Ok(())
    }
  }
}

///|
/// CM-0414: after a terminal wake, the routine is gone.
pub fn RoutineStore::on_terminal_wake(
  self : RoutineStore,
  id : String,
  reason : TerminalWakeReason,
) -> Result[Unit, String] {
  if !reason.is_terminal() {
    return Err("non-terminal wake must not delete")
  }
  self.delete_routine(id)
}

///|
/// CM-0414: timed watch — self-expires after deadline.
pub(all) struct TimedWatch {
  routine_id : String
  expires_at_ms : Int64
} derive(Eq, Debug)

///|
pub extend TimedWatch with Eq::{equal, not_equal}

///|
pub extend TimedWatch with Debug::{to_repr}

///|
pub fn TimedWatch::is_expired(self : TimedWatch, now_ms : Int64) -> Bool {
  now_ms >= self.expires_at_ms
}

///|
/// Apply timed-watch end: if expired, terminal-delete the routine.
/// Returns Ok(true) when deleted.
pub fn RoutineStore::apply_timed_watch_end(
  self : RoutineStore,
  watch : TimedWatch,
  now_ms : Int64,
) -> Result[Bool, String] {
  if !watch.is_expired(now_ms) {
    return Ok(false)
  }
  match self.on_terminal_wake(watch.routine_id, TimedWatchEnded) {
    Ok(_) => Ok(true)
    Err(e) => Err(e)
  }
}

///|
/// Convenience: map PR terminal to CM-0414 wake + delete.
pub fn RoutineStore::on_pr_terminal_wake(
  self : RoutineStore,
  id : String,
  state : PrTerminalState,
) -> Result[Bool, String] {
  match state {
    Merged =>
      match self.on_terminal_wake(id, PrMerged) {
        Ok(_) => Ok(true)
        Err(e) => Err(e)
      }
    Closed =>
      match self.on_terminal_wake(id, PrClosed) {
        Ok(_) => Ok(true)
        Err(e) => Err(e)
      }
    Open => Ok(false)
  }
}
