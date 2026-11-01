///|
/// H2 probe skeleton (CM-1901–1907) — Wave H2 batch-1 + batch-2 (1903–1906).
/// Kernel-facing: schedules/records intents against Mock or Live.
/// Does NOT claim host-integration I-PASS — Bit验证 promotes from Host smoke artifacts.
/// Real evidence: scripts/host_h2_smoke.sh → docs/qa/artifacts/cm-1901-settings-entry/ etc.

///|
pub(all) enum H2Intent {
  Cm1901SettingsEntry
  Cm1902SettingsAnchor
  Cm1903UpdateComputer
  Cm1904ResetComputer
  Cm1905LocalExecution
  Cm1906UpdatesVsUpdateComputer
  Cm1907DeleteAgent
  Cm0204HiddenAgent
  Cm0205InfoPanel
  Cm0206NotifyToggles
  Cm1401CreateAgentSidebar
  Cm1405MembersPanel
  Cm1507AutoReviewDeeplink
  Cm2178PermissionGuideSettings
} derive(Eq, Debug)

///|
pub extend H2Intent with Eq::{equal, not_equal}

///|
pub extend H2Intent with Debug::{to_repr}

///|
pub fn H2Intent::cm_id(self : H2Intent) -> String {
  match self {
    Cm1901SettingsEntry => "CM-1901"
    Cm1902SettingsAnchor => "CM-1902"
    Cm1903UpdateComputer => "CM-1903"
    Cm1904ResetComputer => "CM-1904"
    Cm1905LocalExecution => "CM-1905"
    Cm1906UpdatesVsUpdateComputer => "CM-1906"
    Cm1907DeleteAgent => "CM-1907"
    Cm0204HiddenAgent => "CM-0204"
    Cm0205InfoPanel => "CM-0205"
    Cm0206NotifyToggles => "CM-0206"
    Cm1401CreateAgentSidebar => "CM-1401"
    Cm1405MembersPanel => "CM-1405"
    Cm1507AutoReviewDeeplink => "CM-1507"
    Cm2178PermissionGuideSettings => "CM-2178"
  }
}

///|
pub fn H2Intent::artifact_subdir(self : H2Intent) -> String {
  match self {
    Cm1901SettingsEntry => "cm-1901-settings-entry"
    Cm1902SettingsAnchor => "cm-1902-settings-anchor"
    Cm1903UpdateComputer => "cm-1903-update-computer"
    Cm1904ResetComputer => "cm-1904-reset-computer"
    Cm1905LocalExecution => "cm-1905-local-execution"
    Cm1906UpdatesVsUpdateComputer => "cm-1906-updates-vs-update-computer"
    Cm1907DeleteAgent => "cm-1907-delete-agent"
    Cm0204HiddenAgent => "cm-0204-hidden-agent"
    Cm0205InfoPanel => "cm-0205-info-panel"
    Cm0206NotifyToggles => "cm-0206-notify-toggles"
    Cm1401CreateAgentSidebar => "cm-1401-create-agent-sidebar"
    Cm1405MembersPanel => "cm-1405-members-panel"
    Cm1507AutoReviewDeeplink => "cm-1507-auto-review-deeplink"
    Cm2178PermissionGuideSettings => "cm-2178-permission-guide-settings"
  }
}

///|
fn h2_evidence_cmd_hint(intent : H2Intent) -> String {
  match intent {
    Cm0204HiddenAgent
    | Cm0205InfoPanel
    | Cm0206NotifyToggles
    | Cm1401CreateAgentSidebar
    | Cm1405MembersPanel
    | Cm1507AutoReviewDeeplink
    | Cm2178PermissionGuideSettings =>
      "bash /workspace/bitbot/scripts/host_h2_smoke.sh " +
      intent.cm_id().to_lower()
    Cm1901SettingsEntry =>
      "bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1901"
    Cm1902SettingsAnchor =>
      "bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1902"
    Cm1903UpdateComputer =>
      "bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1903"
    Cm1904ResetComputer =>
      "bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1904"
    Cm1905LocalExecution =>
      "bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1905"
    Cm1906UpdatesVsUpdateComputer =>
      "bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1906"
    Cm1907DeleteAgent =>
      "bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1907"
  }
}

///|
/// Live-only evidence record (G-UI-3 / H2UiEvidence). i_claimed always false here.
pub(all) struct H2UiEvidence {
  cm_id : String
  intent : H2Intent
  entry : @ui_protocol.SettingsEntry?
  anchor : @ui_protocol.SettingsAnchor?
  delete_phase : @ui_protocol.DeleteAgentPhase?
  /// CM-1903 phase string when probed
  update_computer_phase : String?
  /// CM-1905 gate state after probe (Some(false) = refused machineId)
  local_execution_enabled : Bool?
  frame_origin : FrameOrigin
  display_id : String
  bytes_sha256 : String
  artifact_dir : String
  evidence_cmd_hint : String
  audit_span_id : String
  backend_kind : String
  /// Always false from this skeleton — only Bit验证 may mark I-PASS.
  i_claimed : Bool
  note : String
} derive(Eq, Debug)

///|
pub extend H2UiEvidence with Eq::{equal, not_equal}

///|
pub extend H2UiEvidence with Debug::{to_repr}

///|
pub fn H2UiEvidence::asserts_i_not_claimed(self : H2UiEvidence) -> Bool {
  !self.i_claimed
}

///|
/// Schedule/run H2 intent. Mock and Live both leave i_claimed=false.
/// Live records an audit span pointing at the artifacts dir.
/// Optionally drives HostUiShell to emit HostUiEvent (queryable).
pub fn HostAbi::run_h2_probe(self : HostAbi, intent : H2Intent) -> H2UiEvidence {
  let sub = intent.artifact_subdir()
  let artifact_dir = host_artifacts_dir() + "/" + sub
  let backend_kind = self.backend_kind()
  let display_id = match self.backend {
    Live(cfg) =>
      match cfg.display {
        Some(d) => d
        None => ":1"
      }
    Mock => "n/a"
  }
  let shell = self.host_ui_shell()
  let mut entry : @ui_protocol.SettingsEntry? = None
  let mut anchor : @ui_protocol.SettingsAnchor? = None
  let mut delete_phase : @ui_protocol.DeleteAgentPhase? = None
  let mut update_computer_phase : String? = None
  let mut local_execution_enabled : Bool? = None
  match intent {
    Cm1901SettingsEntry => {
      entry = Some(@ui_protocol.SidebarAccountButton)
      let intent1901 = @ui_protocol.OpenSettingsIntent::open(
        @ui_protocol.SidebarAccountButton,
      )
      match shell.open_settings(intent1901) {
        Ok(_) => ()
        Err(_) => ()
      }
    }
    Cm1902SettingsAnchor => {
      entry = Some(@ui_protocol.CommandPalette)
      anchor = Some(@ui_protocol.Theme)
      let intent1902 = @ui_protocol.OpenSettingsIntent::open(
        @ui_protocol.CommandPalette,
        anchor=Some(@ui_protocol.Theme),
      )
      match shell.open_settings(intent1902) {
        Ok(_) => ()
        Err(_) => ()
      }
      // Also record the three required sample anchors as visible intents.
      shell.notify_anchor_visible(@ui_protocol.Timezone)
      shell.notify_anchor_visible(@ui_protocol.UpdateComputer)
    }
    Cm1903UpdateComputer => {
      entry = Some(@ui_protocol.CommandPalette)
      anchor = Some(@ui_protocol.UpdateComputer)
      match shell.request_update_computer() {
        Ok(ph) => update_computer_phase = Some(ph)
        Err(_) => ()
      }
      match shell.confirm_update_computer_step() {
        Ok(ph) => update_computer_phase = Some(ph)
        Err(_) => ()
      }
      // Smoke cancels — never Completed on I path.
      match shell.cancel_update_computer() {
        Ok(ph) => update_computer_phase = Some(ph)
        Err(_) => ()
      }
    }
    Cm1904ResetComputer => {
      entry = Some(@ui_protocol.CommandPalette)
      anchor = Some(@ui_protocol.ResetComputer)
      match shell.open_reset_computer() {
        Ok(_) => ()
        Err(_) => ()
      }
      // Prefer Update over Reset remains a guidance invariant (U+I).
    }
    Cm1905LocalExecution => {
      entry = Some(@ui_protocol.CommandPalette)
      anchor = Some(@ui_protocol.LocalExecution)
      shell.set_local_execution(enabled=false)
      local_execution_enabled = Some(false)
      match shell.try_machine_call("desk-1") {
        Err(msg) => {
          // Expected refuse — record via effects already.
          let _ = msg
        }
        Ok(_) => ()
      }
    }
    Cm1906UpdatesVsUpdateComputer => {
      entry = Some(@ui_protocol.CommandPalette)
      // Updates tab (update-channel) then Computer update-computer — distinguishable.
      anchor = Some(@ui_protocol.UpdateChannel)
      let intent_ch = @ui_protocol.OpenSettingsIntent::open(
        @ui_protocol.CommandPalette,
        anchor=Some(@ui_protocol.UpdateChannel),
      )
      match shell.open_settings(intent_ch) {
        Ok(_) => ()
        Err(_) => ()
      }
      shell.notify_anchor_visible(@ui_protocol.UpdateComputer)
      anchor = Some(@ui_protocol.UpdateComputer)
    }
    Cm0204HiddenAgent => {
      // Throwaway hidden agent: not in main sidebar, still addressable.
      let _ = shell.set_agent_hidden("h2-hidden-agent", hidden=true)
      let _ = shell.address_agent("h2-hidden-agent")
    }
    Cm0205InfoPanel => {
      let _ = shell.open_info_panel("h2-throwaway-agent")
    }
    Cm0206NotifyToggles => {
      let _ = shell.set_agent_notify(
        "h2-throwaway-agent",
        @ui_protocol.Sound,
        false,
      )
      let _ = shell.set_agent_notify(
        "h2-throwaway-agent",
        @ui_protocol.MentionsOnly,
        true,
      )
    }
    Cm1401CreateAgentSidebar => {
      let _ = shell.create_agent("h2-created-agent")
      let _ = shell.open_members_panel("h2-group", [
        "h2-throwaway-agent", "h2-created-agent",
      ])
    }
    Cm1405MembersPanel => {
      let _ = shell.open_members_panel("h2-group", [
        "h2-throwaway-agent", "demo-agent",
      ])
    }
    Cm1507AutoReviewDeeplink => {
      entry = Some(@ui_protocol.CommandPalette)
      for
        a in [
          @ui_protocol.AutoReview,
          @ui_protocol.AutoReviewRules,
          @ui_protocol.SecurityKeys,
        ] {
        let _ = shell.open_settings(
          @ui_protocol.OpenSettingsIntent::open(
            @ui_protocol.CommandPalette,
            anchor=Some(a),
          ),
        )
        anchor = Some(a)
      }
    }
    Cm2178PermissionGuideSettings => {
      entry = Some(@ui_protocol.SidebarAccountButton)
      match
        shell.open_permission_guide(
          @ui_protocol.ConnectorNeedsAuth(namespace_="user-Gmail"),
        ) {
        Ok(a) => anchor = Some(a)
        Err(_) => ()
      }
    }
    Cm1907DeleteAgent => {
      let aid = @ui_protocol.HostAgentId::new("h2-throwaway-agent")
      match shell.request_delete_agent(aid) {
        Ok(pending) => {
          delete_phase = Some(pending.phase)
          // Smoke must Cancel only — skeleton mirrors that (never Completed).
          match shell.cancel_delete_agent(pending) {
            Ok(cancelled) => delete_phase = Some(cancelled.phase)
            Err(_) => ()
          }
        }
        Err(_) => ()
      }
    }
  }
  let note = match self.backend {
    Mock =>
      "Mock backend — kernel-contract / HostUiEvent only; I not claimed (run Host H2 smoke for I evidence)"
    Live(_) =>
      "Live C′ path — HostUiShell events absorbed; host_h2_smoke must drive via HostUiShell Live adapter (not CDP page JS); I not claimed"
  }
  let audit_span_id = "h2_probe:" + intent.cm_id()
  self.effects.push("h2_probe:" + intent.cm_id() + ":" + backend_kind)
  // Host→Kernel event 回注 (C′): absorb into HostAbi.ui_events + effect log.
  self.absorb_ui_events(shell)
  for ev in shell.events {
    self.effects.push("h2_ui_event:" + ev.label())
  }
  match self.backend {
    Live(_) =>
      self.record_audit(
        AuditSpan::make(
          audit_span_id,
          artifact_path=Some(artifact_dir),
          ok=true,
          detail=note,
        ),
      )
    Mock => ()
  }
  {
    cm_id: intent.cm_id(),
    intent,
    entry,
    anchor,
    delete_phase,
    update_computer_phase,
    local_execution_enabled,
    // Skeleton does not capture pixels — Placeholder until smoke LiveDisplay.
    frame_origin: Placeholder,
    display_id,
    bytes_sha256: "",
    artifact_dir,
    evidence_cmd_hint: h2_evidence_cmd_hint(intent),
    audit_span_id,
    backend_kind,
    i_claimed: false,
    note,
  }
}

///|
/// Run batch-1 H2 intents (1901 → 1902 → 1907); I never claimed.
pub fn HostAbi::run_h2_wave(self : HostAbi) -> Array[H2UiEvidence] {
  let intents : Array[H2Intent] = [
    Cm1901SettingsEntry,
    Cm1902SettingsAnchor,
    Cm1907DeleteAgent,
  ]
  let out : Array[H2UiEvidence] = []
  for intent in intents {
    out.push(self.run_h2_probe(intent))
  }
  out
}

///|
/// Run batch-2 H2 intents (1903 → 1904 → 1905 → 1906); I never claimed.
pub fn HostAbi::run_h2_wave_batch2(self : HostAbi) -> Array[H2UiEvidence] {
  let intents : Array[H2Intent] = [
    Cm1903UpdateComputer,
    Cm1904ResetComputer,
    Cm1905LocalExecution,
    Cm1906UpdatesVsUpdateComputer,
  ]
  let out : Array[H2UiEvidence] = []
  for intent in intents {
    out.push(self.run_h2_probe(intent))
  }
  out
}

///|
/// Run batch-3 H2 intents (0204 → 0205 → 0206 → 1401 → 1405 → 1507 → 2178).
pub fn HostAbi::run_h2_wave_batch3(self : HostAbi) -> Array[H2UiEvidence] {
  let intents : Array[H2Intent] = [
    Cm0204HiddenAgent,
    Cm0205InfoPanel,
    Cm0206NotifyToggles,
    Cm1401CreateAgentSidebar,
    Cm1405MembersPanel,
    Cm1507AutoReviewDeeplink,
    Cm2178PermissionGuideSettings,
  ]
  let out : Array[H2UiEvidence] = []
  for intent in intents {
    out.push(self.run_h2_probe(intent))
  }
  out
}

///|
/// True iff every record leaves I unclaimed (skeleton invariant).
pub fn h2_wave_i_unclaimed(records : Array[H2UiEvidence]) -> Bool {
  for r in records {
    if r.i_claimed {
      return false
    }
  }
  true
}

///|
/// Documented paths for Bit Bot Host UI surface frames (not Grok client).
pub fn h2_surface_artifact_path(intent : H2Intent) -> String {
  match intent {
    Cm1901SettingsEntry =>
      host_artifacts_dir() + "/cm-1901-settings-entry/entry_sidebar.png"
    Cm1902SettingsAnchor =>
      host_artifacts_dir() + "/cm-1902-settings-anchor/theme.png"
    Cm1903UpdateComputer =>
      host_artifacts_dir() +
      "/cm-1903-update-computer/awaiting_second_confirm.png"
    Cm1904ResetComputer =>
      host_artifacts_dir() + "/cm-1904-reset-computer/reset_computer.png"
    Cm1905LocalExecution =>
      host_artifacts_dir() + "/cm-1905-local-execution/local_execution_off.png"
    Cm1906UpdatesVsUpdateComputer =>
      host_artifacts_dir() +
      "/cm-1906-updates-vs-update-computer/update_computer.png"
    Cm1907DeleteAgent =>
      host_artifacts_dir() + "/cm-1907-delete-agent/awaiting_confirm.png"
    Cm0204HiddenAgent =>
      host_artifacts_dir() + "/cm-0204-hidden-agent/sidebar_hidden.png"
    Cm0205InfoPanel =>
      host_artifacts_dir() + "/cm-0205-info-panel/info_panel.png"
    Cm0206NotifyToggles =>
      host_artifacts_dir() + "/cm-0206-notify-toggles/agent_a_toggled.png"
    Cm1401CreateAgentSidebar =>
      host_artifacts_dir() +
      "/cm-1401-create-agent-sidebar/after_create_members.png"
    Cm1405MembersPanel =>
      host_artifacts_dir() + "/cm-1405-members-panel/members_panel.png"
    Cm1507AutoReviewDeeplink =>
      host_artifacts_dir() + "/cm-1507-auto-review-deeplink/auto-review.png"
    Cm2178PermissionGuideSettings =>
      host_artifacts_dir() +
      "/cm-2178-permission-guide-settings/settings_opened.png"
  }
}
