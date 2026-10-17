///|
/// Live Host UI shell + Host→Kernel events (G-UI-1 / Wave H2).
/// Authority: docs/host-integration-interface-gaps.md §3 + Bitbot C′.
/// Mock = U-only effect recording. Live records events + audit spans.
/// Does NOT claim I-PASS. Real pixels come from Host UI surface + host_h2_smoke.

///|
/// Host → Kernel observation events (G-UI-1). Payloads reuse @ui_protocol types.
pub(all) enum HostUiEvent {
  SettingsOpened(
    entry~ : @ui_protocol.SettingsEntry,
    anchor~ : @ui_protocol.SettingsAnchor?,
  )
  SettingsAnchorVisible(anchor~ : @ui_protocol.SettingsAnchor)
  DeleteAgentPhaseChanged(
    agent_id~ : String,
    phase~ : @ui_protocol.DeleteAgentPhase,
  )
  /// CM-1903: idle | prompted | awaiting-second-confirm | cancelled | completed
  UpdateComputerPhaseChanged(phase~ : String)
  /// CM-1905: local-execution gate flipped
  LocalExecutionGateChanged(enabled~ : Bool)
  /// CM-0204 / CM-1401: main sidebar list after a change (hidden excluded)
  SidebarListChanged(visible_ids~ : Array[String])
  /// CM-0204: hidden agent remains addressable (not in main sidebar); §3.2 name
  SidebarHiddenAgentAddressable(agent_id~ : String)
  /// CM-0205: per-agent Info panel opened (≠ global Settings)
  InfoPanelOpened(agent_id~ : String, sections~ : Array[String])
  /// CM-0206: per-agent notification toggle changed
  AgentNotifyToggleChanged(agent_id~ : String, toggle~ : String, value~ : Bool)
  /// CM-1401: CreateAgent observed by Host
  AgentCreated(agent_id~ : String)
  /// CM-1401 / CM-1405: Members section visible in Info panel
  MembersPanelVisible(group_id~ : String, member_ids~ : Array[String])
  /// CM-2178: missing-permission guide opened Settings; never pretends connected
  PermissionGuideShown(
    kind~ : String,
    anchor~ : @ui_protocol.SettingsAnchor,
    pretends_connected~ : Bool,
  )
} derive(Eq, Debug)

///|
pub extend HostUiEvent with Eq::{equal, not_equal}

///|
pub extend HostUiEvent with Debug::{to_repr}

///|
pub fn HostUiEvent::label(self : HostUiEvent) -> String {
  match self {
    SettingsOpened(entry~, anchor~) => {
      let base = "settings_opened:" + entry.label()
      match anchor {
        None => base
        Some(a) => base + ":" + a.id()
      }
    }
    SettingsAnchorVisible(anchor~) => "settings_anchor_visible:" + anchor.id()
    DeleteAgentPhaseChanged(agent_id~, phase~) =>
      "delete_phase:" + agent_id + ":" + phase.label()
    UpdateComputerPhaseChanged(phase~) => "update_computer_phase:" + phase
    LocalExecutionGateChanged(enabled~) =>
      "local_execution_gate:" + (if enabled { "on" } else { "off" })
    SidebarListChanged(visible_ids~) =>
      "sidebar_list:" + visible_ids.join(",")
    SidebarHiddenAgentAddressable(agent_id~) =>
      "sidebar_hidden_agent_addressable:" + agent_id
    InfoPanelOpened(agent_id~, sections~) =>
      "info_panel_opened:" + agent_id + ":" + sections.join(",")
    AgentNotifyToggleChanged(agent_id~, toggle~, value~) =>
      "agent_notify:" + agent_id + ":" + toggle + "=" + value.to_string()
    AgentCreated(agent_id~) => "agent_created:" + agent_id
    MembersPanelVisible(group_id~, member_ids~) =>
      "members_panel:" + group_id + ":" + member_ids.join(",")
    PermissionGuideShown(kind~, anchor~, pretends_connected~) =>
      "permission_guide:" + kind + ":" + anchor.id() +
      (if pretends_connected { ":PRETEND" } else { ":not_connected" })
  }
}

///|
/// Thin Host UI adapter (Mock | Live). Events are queryable; Live audits.
pub(all) struct HostUiShell {
  /// "Mock" | "Live"
  backend_kind : String
  events : Array[HostUiEvent]
  mut pending_delete : @ui_protocol.DeleteAgentIntent?
  /// CM-1903 two-step Update Computer phase string
  mut update_computer_phase : String
  /// CM-1905 local-execution gate (Host face)
  mut local_execution_enabled : Bool
  /// CM-0204 / CM-1401: all known agents (id) and hidden subset
  agents : Array[String]
  hidden_agents : Array[String]
  /// CM-0206: per-agent notify state, key = agent_id + "|" + toggle key
  notify : Map[String, Bool]
  effects : Array[String]
}

///|
pub fn HostUiShell::mock() -> HostUiShell {
  {
    backend_kind: "Mock",
    events: [],
    pending_delete: None,
    update_computer_phase: "idle",
    local_execution_enabled: true,
    agents: ["h2-throwaway-agent", "demo-agent"],
    hidden_agents: [],
    notify: {},
    effects: [],
  }
}

///|
pub fn HostUiShell::live() -> HostUiShell {
  {
    backend_kind: "Live",
    events: [],
    pending_delete: None,
    update_computer_phase: "idle",
    local_execution_enabled: true,
    agents: ["h2-throwaway-agent", "demo-agent"],
    hidden_agents: [],
    notify: {},
    effects: [],
  }
}

///|
pub fn HostUiShell::for_backend(backend : HostBackend) -> HostUiShell {
  match backend {
    Mock => HostUiShell::mock()
    Live(_) => HostUiShell::live()
  }
}

///|
pub fn HostUiShell::is_live(self : HostUiShell) -> Bool {
  self.backend_kind == "Live"
}

///|
pub fn HostUiShell::event_count(self : HostUiShell) -> Int32 {
  self.events.length()
}

///|
pub fn HostUiShell::push_event(self : HostUiShell, ev : HostUiEvent) -> Unit {
  self.events.push(ev)
  self.effects.push(ev.label())
}

///|
/// CM-1901 / CM-1902: open Settings (optional deep-link anchor).
pub fn HostUiShell::open_settings(
  self : HostUiShell,
  intent : @ui_protocol.OpenSettingsIntent,
) -> Result[Unit, String] {
  match intent.validate() {
    Err(e) => Err(e)
    Ok(_) => {
      self.push_event(
        SettingsOpened(entry=intent.entry, anchor=intent.anchor),
      )
      match intent.anchor {
        None => ()
        Some(a) => self.push_event(SettingsAnchorVisible(anchor=a))
      }
      Ok(())
    }
  }
}

///|
/// CM-1902: record that a deep-link anchor became visible (Host observation).
pub fn HostUiShell::notify_anchor_visible(
  self : HostUiShell,
  anchor : @ui_protocol.SettingsAnchor,
) -> Unit {
  self.push_event(SettingsAnchorVisible(anchor~))
}


///|
/// CM-1907: show sidebar context menu before Delete confirm (Host face step).
/// Emits effect only in kernel; Live Host process advances real UI via /api/host/*.
pub fn HostUiShell::open_sidebar_context_menu(
  self : HostUiShell,
  agent_id : @ui_protocol.HostAgentId,
) -> Result[Unit, String] {
  if agent_id.value.length() == 0 {
    return Err("agent_id must be non-empty")
  }
  self.effects.push("open_sidebar_context_menu:" + agent_id.value)
  // Phase not yet Requested — menu visible only. Host process emits SidebarContextMenuOpened.
  Ok(())
}

///|
/// CM-1907: sidebar Delete → AwaitingConfirm (never auto-completes).
pub fn HostUiShell::request_delete_agent(
  self : HostUiShell,
  agent_id : @ui_protocol.HostAgentId,
) -> Result[@ui_protocol.DeleteAgentIntent, String] {
  if agent_id.value.length() == 0 {
    return Err("agent_id must be non-empty")
  }
  self.push_event(
    DeleteAgentPhaseChanged(agent_id=agent_id.value, phase=@ui_protocol.Requested),
  )
  let awaiting : @ui_protocol.DeleteAgentIntent = {
    agent_id,
    phase: @ui_protocol.AwaitingConfirm,
  }
  self.pending_delete = Some(awaiting)
  self.push_event(
    DeleteAgentPhaseChanged(
      agent_id=agent_id.value,
      phase=@ui_protocol.AwaitingConfirm,
    ),
  )
  Ok(awaiting)
}

///|
/// CM-1907: confirm delete — advances to Confirmed then Completed.
/// Smoke / I probes should prefer cancel_delete_agent on throwaway agents.
pub fn HostUiShell::confirm_delete_agent(
  self : HostUiShell,
  intent : @ui_protocol.DeleteAgentIntent,
) -> Result[@ui_protocol.DeleteAgentIntent, String] {
  match self.pending_delete {
    None => return Err("no pending delete intent")
    Some(cur) => {
      if cur.agent_id != intent.agent_id {
        return Err("delete intent agent_id mismatch")
      }
      match cur.phase {
        @ui_protocol.AwaitingConfirm | @ui_protocol.Requested => ()
        other =>
          return Err("confirm only from AwaitingConfirm; got " + other.label())
      }
    }
  }
  let confirmed : @ui_protocol.DeleteAgentIntent = {
    agent_id: intent.agent_id,
    phase: @ui_protocol.Confirmed,
  }
  self.pending_delete = Some(confirmed)
  self.push_event(
    DeleteAgentPhaseChanged(
      agent_id=intent.agent_id.value,
      phase=@ui_protocol.Confirmed,
    ),
  )
  let done : @ui_protocol.DeleteAgentIntent = {
    agent_id: intent.agent_id,
    phase: @ui_protocol.Completed,
  }
  self.pending_delete = Some(done)
  self.push_event(
    DeleteAgentPhaseChanged(
      agent_id=intent.agent_id.value,
      phase=@ui_protocol.Completed,
    ),
  )
  Ok(done)
}

///|
/// CM-1907: cancel while awaiting confirm — never Completed (smoke default).
pub fn HostUiShell::cancel_delete_agent(
  self : HostUiShell,
  intent : @ui_protocol.DeleteAgentIntent,
) -> Result[@ui_protocol.DeleteAgentIntent, String] {
  match self.pending_delete {
    None => return Err("no pending delete intent")
    Some(cur) => {
      if cur.agent_id != intent.agent_id {
        return Err("delete intent agent_id mismatch")
      }
      match cur.phase {
        @ui_protocol.AwaitingConfirm | @ui_protocol.Requested => ()
        other =>
          return Err("cancel only from AwaitingConfirm; got " + other.label())
      }
    }
  }
  let cancelled : @ui_protocol.DeleteAgentIntent = {
    agent_id: intent.agent_id,
    phase: @ui_protocol.Cancelled,
  }
  self.pending_delete = Some(cancelled)
  self.push_event(
    DeleteAgentPhaseChanged(
      agent_id=intent.agent_id.value,
      phase=@ui_protocol.Cancelled,
    ),
  )
  Ok(cancelled)
}

///|
/// CM-1903: open Update Computer UI (Computer tab) — first step / prompted.
/// Distinct from Reset Computer. Does not complete Update.
pub fn HostUiShell::request_update_computer(
  self : HostUiShell,
) -> Result[String, String] {
  // Open settings at update-computer anchor for Host face visibility.
  let intent = @ui_protocol.OpenSettingsIntent::open(
    @ui_protocol.CommandPalette,
    anchor=Some(@ui_protocol.UpdateComputer),
  )
  match self.open_settings(intent) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  self.update_computer_phase = "prompted"
  self.push_event(UpdateComputerPhaseChanged(phase="prompted"))
  self.effects.push("request_update_computer:prompted")
  Ok("prompted")
}

///|
/// CM-1903: advance one confirm step. First advance → awaiting-second-confirm
/// ("Click Again to Confirm"). Second would complete — smoke must cancel instead.
pub fn HostUiShell::confirm_update_computer_step(
  self : HostUiShell,
) -> Result[String, String] {
  match self.update_computer_phase {
    "prompted" => {
      self.update_computer_phase = "awaiting-second-confirm"
      self.push_event(
        UpdateComputerPhaseChanged(phase="awaiting-second-confirm"),
      )
      self.effects.push("confirm_update_computer_step:awaiting-second-confirm")
      Ok("awaiting-second-confirm")
    }
    "awaiting-second-confirm" => {
      // Product may complete; I smoke must use cancel — still model Completed here.
      self.update_computer_phase = "completed"
      self.push_event(UpdateComputerPhaseChanged(phase="completed"))
      self.effects.push("confirm_update_computer_step:completed")
      Ok("completed")
    }
    other =>
      Err(
        "confirm_update_computer_step: bad phase " +
        other +
        " (need prompted or awaiting-second-confirm)",
      )
  }
}

///|
/// CM-1903: cancel two-step Update Computer (smoke default — never Completed).
pub fn HostUiShell::cancel_update_computer(
  self : HostUiShell,
) -> Result[String, String] {
  match self.update_computer_phase {
    "prompted" | "awaiting-second-confirm" => {
      self.update_computer_phase = "cancelled"
      self.push_event(UpdateComputerPhaseChanged(phase="cancelled"))
      self.effects.push("cancel_update_computer:cancelled")
      Ok("cancelled")
    }
    other =>
      Err("cancel_update_computer: bad phase " + other)
  }
}

///|
/// CM-1904: open Reset Computer real UI (reachable; not preferred vs Update).
pub fn HostUiShell::open_reset_computer(
  self : HostUiShell,
) -> Result[Unit, String] {
  let intent = @ui_protocol.OpenSettingsIntent::open(
    @ui_protocol.CommandPalette,
    anchor=Some(@ui_protocol.ResetComputer),
  )
  match self.open_settings(intent) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  self.effects.push("open_reset_computer:visible")
  // Guidance: Reset is reachable but not assistant-preferred.
  Ok(())
}

///|
/// CM-1905: set local-execution gate on Host face; emit LocalExecutionGateChanged.
pub fn HostUiShell::set_local_execution(
  self : HostUiShell,
  enabled~ : Bool,
) -> Unit {
  self.local_execution_enabled = enabled
  self.push_event(LocalExecutionGateChanged(enabled~))
  // Also surface the settings anchor for LiveDisplay.
  let intent = @ui_protocol.OpenSettingsIntent::open(
    @ui_protocol.CommandPalette,
    anchor=Some(@ui_protocol.LocalExecution),
  )
  match self.open_settings(intent) {
    Ok(_) => ()
    Err(_) => ()
  }
  self.effects.push(
    "set_local_execution:" + (if enabled { "on" } else { "off" }),
  )
}

///|
/// CM-1905: Host gate — refuse machineId when local-execution off.
pub fn HostUiShell::try_machine_call(
  self : HostUiShell,
  machine_id : String,
) -> Result[String, String] {
  if machine_id.length() == 0 {
    return Err("machine_id must be non-empty")
  }
  if !self.local_execution_enabled {
    self.effects.push("rejected_local_off:" + machine_id)
    return Err("local-execution disabled: machine-targeted call rejected")
  }
  self.effects.push("machine_call_allowed:" + machine_id)
  Ok("allowed:" + machine_id)
}

///|
/// CM-0204 / CM-1401: main sidebar ids (hidden agents excluded).
pub fn HostUiShell::main_sidebar_ids(self : HostUiShell) -> Array[String] {
  let out : Array[String] = []
  for a in self.agents {
    if !self.hidden_agents.contains(a) {
      out.push(a)
    }
  }
  out
}

///|
fn HostUiShell::emit_sidebar(self : HostUiShell) -> Unit {
  self.push_event(SidebarListChanged(visible_ids=self.main_sidebar_ids()))
}

///|
/// CM-0204: register (if needed) and mark agent hidden / visible.
pub fn HostUiShell::set_agent_hidden(
  self : HostUiShell,
  agent_id : String,
  hidden~ : Bool,
) -> Result[Unit, String] {
  if agent_id.length() == 0 {
    return Err("agent_id must be non-empty")
  }
  if !self.agents.contains(agent_id) {
    self.agents.push(agent_id)
  }
  let filtered = self.hidden_agents.filter(fn(x) { x != agent_id })
  self.hidden_agents.clear()
  for x in filtered {
    self.hidden_agents.push(x)
  }
  if hidden {
    self.hidden_agents.push(agent_id)
  }
  self.effects.push("set_agent_hidden:" + agent_id + ":" + hidden.to_string())
  self.emit_sidebar()
  Ok(())
}

///|
/// CM-0204: address an agent directly (hidden stays addressable).
pub fn HostUiShell::address_agent(
  self : HostUiShell,
  agent_id : String,
) -> Result[Bool, String] {
  if !self.agents.contains(agent_id) {
    return Err("unknown agent: " + agent_id)
  }
  let hidden = self.hidden_agents.contains(agent_id)
  // §3.2: emit SidebarHiddenAgentAddressable only when the addressed agent is hidden
  if hidden {
    self.push_event(SidebarHiddenAgentAddressable(agent_id~))
  }
  Ok(hidden)
}

///|
/// CM-0205: open per-agent Info panel (five sections; not global Settings).
pub fn HostUiShell::open_info_panel(
  self : HostUiShell,
  agent_id : String,
) -> Result[Array[String], String] {
  if !self.agents.contains(agent_id) {
    return Err("unknown agent: " + agent_id)
  }
  let sections = @ui_protocol.info_panel_section_anchors().map(fn(s) {
    s.label()
  })
  self.push_event(InfoPanelOpened(agent_id~, sections~))
  Ok(sections)
}

///|
/// CM-0206: per-agent notification toggle (isolated per agent).
pub fn HostUiShell::set_agent_notify(
  self : HostUiShell,
  agent_id : String,
  toggle : @ui_protocol.AssistantNotifyToggle,
  value : Bool,
) -> Result[Unit, String] {
  if !self.agents.contains(agent_id) {
    return Err("unknown agent: " + agent_id)
  }
  self.notify.set(agent_id + "|" + toggle.key(), value)
  self.push_event(
    AgentNotifyToggleChanged(agent_id~, toggle=toggle.key(), value~),
  )
  Ok(())
}

///|
/// CM-0206: read toggle (default true for desktop/sound/routines/channels,
/// false for mentions-only) — per agent.
pub fn HostUiShell::agent_notify(
  self : HostUiShell,
  agent_id : String,
  toggle : @ui_protocol.AssistantNotifyToggle,
) -> Bool {
  match self.notify.get(agent_id + "|" + toggle.key()) {
    Some(v) => v
    None =>
      match toggle {
        @ui_protocol.MentionsOnly => false
        _ => true
      }
  }
}

///|
/// CM-1401: CreateAgent → sidebar row (Members visibility via open_members_panel).
pub fn HostUiShell::create_agent(
  self : HostUiShell,
  agent_id : String,
) -> Result[Unit, String] {
  if agent_id.length() == 0 {
    return Err("agent_id must be non-empty")
  }
  if self.agents.contains(agent_id) {
    return Err("agent exists: " + agent_id)
  }
  self.agents.push(agent_id)
  self.push_event(AgentCreated(agent_id~))
  self.emit_sidebar()
  Ok(())
}

///|
/// CM-1401 / CM-1405: Members section in Info panel (group chat).
pub fn HostUiShell::open_members_panel(
  self : HostUiShell,
  group_id : String,
  member_ids : Array[String],
) -> Result[Unit, String] {
  for m in member_ids {
    if !self.agents.contains(m) {
      return Err("unknown member: " + m)
    }
  }
  match self.open_info_panel_group(group_id) {
    Err(e) => return Err(e)
    Ok(_) => ()
  }
  self.push_event(MembersPanelVisible(group_id~, member_ids~))
  Ok(())
}

///|
fn HostUiShell::open_info_panel_group(
  self : HostUiShell,
  group_id : String,
) -> Result[Unit, String] {
  if group_id.length() == 0 {
    return Err("group_id must be non-empty")
  }
  let sections = @ui_protocol.info_panel_section_anchors().map(fn(s) {
    s.label()
  })
  self.push_event(InfoPanelOpened(agent_id=group_id, sections~))
  Ok(())
}

///|
/// CM-2178: missing-permission guide → really opens Settings at anchor.
pub fn HostUiShell::open_permission_guide(
  self : HostUiShell,
  kind : @ui_protocol.MissingPermissionKind,
) -> Result[@ui_protocol.SettingsAnchor, String] {
  let guide = @ui_protocol.guide_missing_permission_to_settings(kind)
  if guide.pretends_connected {
    return Err("guide must not pretend connected")
  }
  match self.open_settings(guide.open_settings) {
    Err(e) => return Err(e)
    Ok(_) => ()
  }
  let anchor = kind.settings_anchor()
  self.push_event(
    PermissionGuideShown(kind=kind.label(), anchor~, pretends_connected=false),
  )
  Ok(anchor)
}

///|
/// Attach a fresh HostUiShell matching this HostAbi backend.
pub fn HostAbi::host_ui_shell(self : HostAbi) -> HostUiShell {
  HostUiShell::for_backend(self.backend)
}

///|
/// Merge shell events into HostAbi.ui_events (Host→Kernel 回注 queryable on ABI).
pub fn HostAbi::absorb_ui_events(self : HostAbi, shell : HostUiShell) -> Unit {
  for ev in shell.events {
    self.ui_events.push(ev)
  }
}

///|
pub fn HostAbi::ui_event_count(self : HostAbi) -> Int32 {
  self.ui_events.length()
}

///|
/// §3.0 C′ acceptance dimensions (documentation + test hook). Not an I claim.
pub fn h2_cprime_checklist_dims() -> Array[String] {
  [
    "ui_drive:HostUiShell_Live_methods",
    "smoke_entry:HostAbi_run_h2_probe",
    "audit:Live_audit_span",
    "events:HostUiEvent_feedback",
    "artifacts:regular_dir_LiveDisplay_not_fixture_only",
  ]
}

///|
/// §3.0 B rejection markers (must NOT appear on I path).
pub fn h2_b_rejection_markers() -> Array[String] {
  [
    "cdp_page_js_bypass",
    "fixture-only/",
    "memory_only_events_no_host_face",
    "synthetic_png",
  ]
}

///|
/// Live path: open_settings + audit span. Mock records events only (no audit).
/// Never claims I. Never silently upgrades Mock → Live success.
pub fn HostAbi::ui_open_settings(
  self : HostAbi,
  shell : HostUiShell,
  intent : @ui_protocol.OpenSettingsIntent,
) -> Result[Unit, String] {
  // Refuse Mock↔Live mismatch before any success side-effects.
  if shell.backend_kind == "Mock" && self.is_live() {
    return Err(
      "ui_open_settings: Live HostAbi must use Live HostUiShell (refusing Mock shell on Live)",
    )
  }
  if shell.backend_kind == "Live" && !self.is_live() {
    return Err(
      "ui_open_settings: Mock HostAbi must use Mock HostUiShell (refusing Live shell on Mock)",
    )
  }
  let res = shell.open_settings(intent)
  match res {
    Err(e) => {
      match self.backend {
        Live(_) =>
          self.record_audit(
            AuditSpan::make(
              "host_ui:open_settings",
              ok=false,
              detail=e,
            ),
          )
        Mock => ()
      }
      Err(e)
    }
    Ok(_) => {
      self.effects.push("host_ui:open_settings:" + intent.entry.label())
      self.absorb_ui_events(shell)
      match self.backend {
        Live(_) =>
          self.record_audit(
            AuditSpan::make(
              "host_ui:open_settings",
              artifact_path=Some(
                host_artifacts_dir() + "/cm-1901-settings-entry",
              ),
              ok=true,
              detail="C_prime HostUiShell.open_settings; HostUiEvent absorbed; I not claimed",
            ),
          )
        Mock => ()
      }
      Ok(())
    }
  }
}
