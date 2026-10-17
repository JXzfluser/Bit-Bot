///|
/// CM-2106: trigger:microsoftTeams — Teams event wakes routine.
/// Aligns with CM-1107 Teams scope (tenant/team); does not edit channels Z-batch.

///|
pub const MICROSOFT_TEAMS_TRIGGER : String = "microsoftTeams"

///|
/// Routine binding for trigger:microsoftTeams.
pub(all) struct MicrosoftTeamsRoutineBinding {
  routine_id : String
  /// Tenant id (CM-1107 scope).
  tenant_id : String
  /// Team id (CM-1107 scope).
  team_id : String
  /// Event kind filter (message / channelMessage / mention / reaction).
  event_kind : String
  mut armed : Bool
} derive(Eq, Debug)

///|
pub extend MicrosoftTeamsRoutineBinding with Eq::{equal, not_equal}

///|
pub extend MicrosoftTeamsRoutineBinding with Debug::{to_repr}

///|
pub fn MicrosoftTeamsRoutineBinding::new(
  routine_id~ : String,
  tenant_id~ : String,
  team_id~ : String,
  event_kind~ : String = "message",
) -> Result[MicrosoftTeamsRoutineBinding, String] {
  if routine_id.length() == 0 {
    return Err("microsoftTeams binding requires routine_id")
  }
  if tenant_id.length() == 0 || team_id.length() == 0 {
    return Err("microsoftTeams binding requires tenant_id and team_id")
  }
  let ok = event_kind == "message" ||
    event_kind == "channelMessage" ||
    event_kind == "mention" ||
    event_kind == "reaction"
  if !ok {
    return Err("unknown microsoftTeams event_kind: " + event_kind)
  }
  Ok({
    routine_id,
    tenant_id,
    team_id,
    event_kind,
    armed: true,
  })
}

///|
/// Trigger label used in Schedule / Event(name=…).
pub fn MicrosoftTeamsRoutineBinding::trigger_name(
  self : MicrosoftTeamsRoutineBinding,
) -> String {
  let _ = self
  MICROSOFT_TEAMS_TRIGGER
}

///|
/// Build routines Trigger::Event for microsoftTeams.
pub fn MicrosoftTeamsRoutineBinding::as_trigger(
  self : MicrosoftTeamsRoutineBinding,
) -> Trigger {
  Event(name=MICROSOFT_TEAMS_TRIGGER + ":" + self.event_kind)
}

///|
/// Inbound Teams event payload (kernel-contract; mirrors CM-1107 scope fields).
pub(all) struct MicrosoftTeamsEvent {
  tenant_id : String
  team_id : String
  event_kind : String
  message_id : String
  body : String
} derive(Eq, Debug)

///|
pub extend MicrosoftTeamsEvent with Eq::{equal, not_equal}

///|
pub extend MicrosoftTeamsEvent with Debug::{to_repr}

///|
pub fn MicrosoftTeamsEvent::of(
  tenant_id~ : String,
  team_id~ : String,
  event_kind~ : String,
  message_id~ : String = "m1",
  body~ : String = "",
) -> MicrosoftTeamsEvent {
  { tenant_id, team_id, event_kind, message_id, body, }
}

///|
/// Whether this binding matches an inbound Teams event (same tenant/team + kind).
pub fn MicrosoftTeamsRoutineBinding::matches_event(
  self : MicrosoftTeamsRoutineBinding,
  event : MicrosoftTeamsEvent,
) -> Bool {
  self.armed &&
  self.tenant_id == event.tenant_id &&
  self.team_id == event.team_id &&
  self.event_kind == event.event_kind
}

///|
/// Wake outcome when a Teams event hits a routine binding.
pub(all) enum TeamsRoutineWake {
  Woke(routine_id~ : String, event_kind~ : String, trigger~ : String)
  Ignored(reason~ : String)
} derive(Eq, Debug)

///|
pub extend TeamsRoutineWake with Eq::{equal, not_equal}

///|
pub extend TeamsRoutineWake with Debug::{to_repr}

///|
pub fn TeamsRoutineWake::did_wake(self : TeamsRoutineWake) -> Bool {
  match self {
    Woke(_) => true
    Ignored(_) => false
  }
}

///|
/// CM-2106: Teams event wakes the routine when binding matches.
pub fn wake_routine_on_microsoft_teams_event(
  binding : MicrosoftTeamsRoutineBinding,
  event : MicrosoftTeamsEvent,
) -> TeamsRoutineWake {
  if !binding.armed {
    return Ignored(reason="microsoftTeams binding not armed")
  }
  if !binding.matches_event(event) {
    return Ignored(
      reason="microsoftTeams event scope/kind mismatch for routine " +
        binding.routine_id,
    )
  }
  Woke(
    routine_id=binding.routine_id,
    event_kind=event.event_kind,
    trigger=MICROSOFT_TEAMS_TRIGGER,
  )
}

///|
/// Registry of microsoftTeams-triggered routines.
pub(all) struct MicrosoftTeamsTriggerRegistry {
  bindings : Array[MicrosoftTeamsRoutineBinding]
  wake_log : Array[String]
}

///|
pub fn MicrosoftTeamsTriggerRegistry::empty() -> MicrosoftTeamsTriggerRegistry {
  { bindings: [], wake_log: [], }
}

///|
pub fn MicrosoftTeamsTriggerRegistry::register(
  self : MicrosoftTeamsTriggerRegistry,
  binding : MicrosoftTeamsRoutineBinding,
) -> Unit {
  self.bindings.push(binding)
}

///|
/// Deliver event to all matching bindings; returns wake results.
pub fn MicrosoftTeamsTriggerRegistry::deliver(
  self : MicrosoftTeamsTriggerRegistry,
  event : MicrosoftTeamsEvent,
) -> Array[TeamsRoutineWake] {
  let out : Array[TeamsRoutineWake] = []
  for b in self.bindings {
    let w = wake_routine_on_microsoft_teams_event(b, event)
    if w.did_wake() {
      self.wake_log.push(b.routine_id + "|" + event.event_kind)
    }
    out.push(w)
  }
  out
}

///|
pub fn MicrosoftTeamsTriggerRegistry::wake_count(
  self : MicrosoftTeamsTriggerRegistry,
) -> Int {
  self.wake_log.length()
}

///|
/// Align with CM-0409 connector label.
pub fn microsoft_teams_trigger_label() -> String {
  MICROSOFT_TEAMS_TRIGGER
}

///|
pub fn ExternalEventConnector::is_microsoft_teams(
  self : ExternalEventConnector,
) -> Bool {
  match self {
    Teams => true
    Linear | Sentry | PagerDuty => false
  }
}
