///|
/// CM-1907: Delete agent — sidebar context-menu + confirm; NOT inside Settings.
/// Kernel-contract only (phase machine); host-integration (real right-click) is GAP.

///|
/// Agent identity for Host lifecycle UI.
pub(all) struct HostAgentId {
  value : String
} derive(Eq, Debug)

///|
pub extend HostAgentId with Eq::{equal, not_equal}

///|
pub extend HostAgentId with Debug::{to_repr}

///|
pub fn HostAgentId::new(value : String) -> HostAgentId {
  { value, }
}

///|
/// Delete-agent phase machine (CM-1907 §3.3).
/// Requested → AwaitingConfirm → Confirmed | Cancelled → Completed (only after Confirmed).
pub(all) enum DeleteAgentPhase {
  Requested
  AwaitingConfirm
  Confirmed
  Cancelled
  Completed
} derive(Eq, Debug)

///|
pub extend DeleteAgentPhase with Eq::{equal, not_equal}

///|
pub extend DeleteAgentPhase with Debug::{to_repr}

///|
pub fn DeleteAgentPhase::label(self : DeleteAgentPhase) -> String {
  match self {
    Requested => "requested"
    AwaitingConfirm => "awaiting-confirm"
    Confirmed => "confirmed"
    Cancelled => "cancelled"
    Completed => "completed"
  }
}

///|
pub(all) struct DeleteAgentIntent {
  agent_id : HostAgentId
  phase : DeleteAgentPhase
} derive(Eq, Debug)

///|
pub extend DeleteAgentIntent with Eq::{equal, not_equal}

///|
pub extend DeleteAgentIntent with Debug::{to_repr}

///|
/// Where delete was initiated — must be sidebar context menu, never Settings.
pub(all) enum DeleteAgentPath {
  SidebarContextMenu
  // Forbidden placeholders (typed so tests can reject them):
  SettingsPanel
  ArchiveOrHide
} derive(Eq, Debug)

///|
pub extend DeleteAgentPath with Eq::{equal, not_equal}

///|
pub extend DeleteAgentPath with Debug::{to_repr}

///|
pub fn DeleteAgentPath::is_legal_delete_path(self : DeleteAgentPath) -> Bool {
  match self {
    SidebarContextMenu => true
    SettingsPanel => false
    ArchiveOrHide => false
  }
}

///|
/// Mock Host agent-lifecycle UI (kernel tracks phase; Host shows confirm).
pub(all) struct HostAgentLifecycleUiMock {
  mut intent : DeleteAgentIntent?
  mut path : DeleteAgentPath?
  mut transcript_removed : Bool
  mut agent_removed : Bool
  effects : Array[String]
}

///|
pub fn HostAgentLifecycleUiMock::new() -> HostAgentLifecycleUiMock {
  {
    intent: None,
    path: None,
    transcript_removed: false,
    agent_removed: false,
    effects: [],
  }
}

///|
/// User chose Delete on sidebar context menu → Requested then AwaitingConfirm.
pub fn HostAgentLifecycleUiMock::request_delete_agent(
  self : HostAgentLifecycleUiMock,
  agent_id : HostAgentId,
  path~ : DeleteAgentPath = SidebarContextMenu,
) -> Result[DeleteAgentIntent, String] {
  if !path.is_legal_delete_path() {
    return Err(
      "delete agent must use sidebar context-menu; not Settings / archive / hide",
    )
  }
  if agent_id.value.length() == 0 {
    return Err("agent_id must be non-empty")
  }
  self.path = Some(path)
  let intent : DeleteAgentIntent = { agent_id, phase: AwaitingConfirm, }
  self.intent = Some(intent)
  self.effects.push("request_delete:" + agent_id.value)
  // Requested is instantaneous; Host immediately shows confirm → AwaitingConfirm.
  Ok(intent)
}

///|
/// Confirm → Confirmed then Completed (agent + transcript removed).
pub fn HostAgentLifecycleUiMock::confirm_delete_agent(
  self : HostAgentLifecycleUiMock,
  intent : DeleteAgentIntent,
) -> Result[DeleteAgentIntent, String] {
  match self.intent {
    None => return Err("no pending delete intent")
    Some(cur) => {
      if cur.agent_id != intent.agent_id {
        return Err("delete intent agent_id mismatch")
      }
      match cur.phase {
        AwaitingConfirm => ()
        Requested => ()
        other =>
          return Err("confirm only from AwaitingConfirm; got " + other.label())
      }
    }
  }
  let confirmed : DeleteAgentIntent = {
    agent_id: intent.agent_id,
    phase: Confirmed,
  }
  self.intent = Some(confirmed)
  self.effects.push("confirm_delete:" + intent.agent_id.value)
  // Host callback: remove agent + transcript → Completed.
  self.agent_removed = true
  self.transcript_removed = true
  let done : DeleteAgentIntent = {
    agent_id: intent.agent_id,
    phase: Completed,
  }
  self.intent = Some(done)
  self.effects.push("completed_delete:" + intent.agent_id.value)
  Ok(done)
}

///|
/// Cancel while awaiting confirm — never Completed.
pub fn HostAgentLifecycleUiMock::cancel_delete_agent(
  self : HostAgentLifecycleUiMock,
  intent : DeleteAgentIntent,
) -> Result[DeleteAgentIntent, String] {
  match self.intent {
    None => return Err("no pending delete intent")
    Some(cur) => {
      if cur.agent_id != intent.agent_id {
        return Err("delete intent agent_id mismatch")
      }
      match cur.phase {
        AwaitingConfirm | Requested => ()
        other =>
          return Err("cancel only from AwaitingConfirm; got " + other.label())
      }
    }
  }
  let cancelled : DeleteAgentIntent = {
    agent_id: intent.agent_id,
    phase: Cancelled,
  }
  self.intent = Some(cancelled)
  self.agent_removed = false
  self.transcript_removed = false
  self.effects.push("cancel_delete:" + intent.agent_id.value)
  Ok(cancelled)
}

///|
/// Force Completed without confirm — must fail (contract: no Completed without confirm).
pub fn HostAgentLifecycleUiMock::force_complete_without_confirm(
  self : HostAgentLifecycleUiMock,
) -> Result[DeleteAgentIntent, String] {
  match self.intent {
    None => Err("no intent")
    Some(cur) =>
      match cur.phase {
        Confirmed | Completed =>
          Err("already past confirm; use confirm_delete_agent")
        AwaitingConfirm | Requested | Cancelled =>
          Err("Completed requires confirm; cannot skip AwaitingConfirm")
      }
  }
}

///|
/// Archive / hide must not be reported as delete (CM-1907 §3.2).
pub fn archive_or_hide_is_not_delete(path : DeleteAgentPath) -> Bool {
  match path {
    ArchiveOrHide => true
    _ => false
  }
}

///|
/// Guidance must not point delete into Settings.
pub fn validate_delete_agent_guidance(text : String) -> Result[Unit, String] {
  let lower = text.to_lower()
  if (lower.contains("settings") && lower.contains("delete")) &&
    (
      lower.contains("agent") ||
      lower.contains("assistant") ||
      lower.contains("bot")
    ) {
    // Allow "not in Settings" / "outside Settings" negations.
    if lower.contains("not in settings") ||
      lower.contains("not inside settings") ||
      lower.contains("outside settings") ||
      lower.contains("not settings") {
      return Ok(())
    }
    return Err("delete-agent guidance must not point into Settings")
  }
  Ok(())
}
