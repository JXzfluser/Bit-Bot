///|
/// H2 Live Host UI skeleton tests (CM-1901/1902/1907). U-safe: never claim I-PASS.
/// Mock cannot silently become Live UI success.

///|
test "h2_probe_skeleton_never_claims_i" {
  let mock = @box_host.HostAbi::mock()
  let rec = mock.run_h2_probe(@box_host.Cm1901SettingsEntry)
  assert_false(rec.i_claimed)
  assert_eq(rec.backend_kind, "Mock")
  assert_true(rec.asserts_i_not_claimed())
  assert_true(rec.artifact_dir.contains("cm-1901-settings-entry"))
  assert_true(rec.evidence_cmd_hint.contains("host_h2_smoke"))
  assert_true(rec.evidence_cmd_hint.contains("cm-1901"))
  assert_eq(rec.cm_id, "CM-1901")

  let live = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1", ui_automation=true),
  )
  let wave = live.run_h2_wave()
  assert_eq(wave.length(), 3)
  assert_true(@box_host.h2_wave_i_unclaimed(wave))
  for r in wave {
    assert_false(r.i_claimed)
    assert_eq(r.backend_kind, "Live")
    assert_true(r.evidence_cmd_hint.contains("host_h2_smoke"))
  }
  assert_true(live.audit_span_count() >= 3)
}

///|
test "h2_intent_cm_ids_and_artifact_subdirs" {
  assert_eq(@box_host.Cm1901SettingsEntry.cm_id(), "CM-1901")
  assert_eq(@box_host.Cm1902SettingsAnchor.cm_id(), "CM-1902")
  assert_eq(@box_host.Cm1907DeleteAgent.cm_id(), "CM-1907")
  assert_eq(
    @box_host.Cm1901SettingsEntry.artifact_subdir(),
    "cm-1901-settings-entry",
  )
  assert_eq(
    @box_host.Cm1902SettingsAnchor.artifact_subdir(),
    "cm-1902-settings-anchor",
  )
  assert_eq(
    @box_host.Cm1907DeleteAgent.artifact_subdir(),
    "cm-1907-delete-agent",
  )
}

///|
test "h2_host_ui_events_queryable_on_shell" {
  let shell = @box_host.HostUiShell::live()
  let intent = @ui_protocol.OpenSettingsIntent::open(
    @ui_protocol.SidebarAccountButton,
  )
  match shell.open_settings(intent) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_true(shell.event_count() >= 1)
  let mut found_opened = false
  for ev in shell.events {
    match ev {
      @box_host.SettingsOpened(entry~, anchor~) => {
        assert_eq(entry, @ui_protocol.SidebarAccountButton)
        assert_eq(anchor, None)
        found_opened = true
      }
      _ => ()
    }
  }
  assert_true(found_opened)

  shell.notify_anchor_visible(@ui_protocol.Theme)
  let mut found_anchor = false
  for ev in shell.events {
    match ev {
      @box_host.SettingsAnchorVisible(anchor~) =>
        if anchor == @ui_protocol.Theme {
          found_anchor = true
        }
      _ => ()
    }
  }
  assert_true(found_anchor)
}

///|
test "h2_delete_cancel_never_completed" {
  let shell = @box_host.HostUiShell::live()
  let aid = @ui_protocol.HostAgentId::new("h2-throwaway-agent")
  let pending = match shell.request_delete_agent(aid) {
    Ok(i) => i
    Err(e) => fail(e)
  }
  assert_eq(pending.phase, @ui_protocol.AwaitingConfirm)
  let cancelled = match shell.cancel_delete_agent(pending) {
    Ok(i) => i
    Err(e) => fail(e)
  }
  assert_eq(cancelled.phase, @ui_protocol.Cancelled)
  let mut saw_completed = false
  for ev in shell.events {
    match ev {
      @box_host.DeleteAgentPhaseChanged(agent_id~, phase~) => {
        let _ = agent_id
        if phase == @ui_protocol.Completed {
          saw_completed = true
        }
      }
      _ => ()
    }
  }
  assert_false(saw_completed)
}

///|
test "h2_mock_shell_not_live_ui_success" {
  let mock_host = @box_host.HostAbi::mock()
  let live_shell = @box_host.HostUiShell::live()
  let intent = @ui_protocol.OpenSettingsIntent::open(
    @ui_protocol.KeyboardShortcut,
  )
  match mock_host.ui_open_settings(live_shell, intent) {
    Err(m) => assert_true(m.contains("Mock") || m.contains("Live"))
    Ok(_) => fail("Mock HostAbi must refuse Live HostUiShell")
  }
  let live_host = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  let mock_shell = @box_host.HostUiShell::mock()
  match live_host.ui_open_settings(mock_shell, intent) {
    Err(m) => assert_true(m.contains("Mock") || m.contains("Live"))
    Ok(_) => fail("Live HostAbi must refuse Mock HostUiShell")
  }
  // Matching pairs work; still never claim I.
  let live_ok = @box_host.HostUiShell::live()
  match live_host.ui_open_settings(live_ok, intent) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  let rec = live_host.run_h2_probe(@box_host.Cm1901SettingsEntry)
  assert_false(rec.i_claimed)
  assert_eq(rec.frame_origin, @box_host.Placeholder)
}

///|
test "h2_probe_emits_ui_event_effects" {
  let live = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1", ui_automation=true),
  )
  let _ = live.run_h2_probe(@box_host.Cm1901SettingsEntry)
  let mut saw = false
  for e in live.effects {
    if e.contains("h2_ui_event:settings_opened") {
      saw = true
    }
  }
  assert_true(saw)
}

///|
test "h2_each_probe_evidence_cmd_matches_smoke" {
  let host = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  let pairs : Array[(@box_host.H2Intent, String)] = [
    (@box_host.Cm1901SettingsEntry, "cm-1901"),
    (@box_host.Cm1902SettingsAnchor, "cm-1902"),
    (@box_host.Cm1907DeleteAgent, "cm-1907"),
  ]
  for pair in pairs {
    let (intent, flag) = pair
    let rec = host.run_h2_probe(intent)
    assert_false(rec.i_claimed)
    assert_true(rec.evidence_cmd_hint.contains(flag))
    assert_true(rec.artifact_dir.contains(intent.artifact_subdir()))
  }
}

///|
test "h2_cm1907_probe_cancels_not_completes" {
  let host = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  let rec = host.run_h2_probe(@box_host.Cm1907DeleteAgent)
  assert_false(rec.i_claimed)
  match rec.delete_phase {
    Some(p) => assert_eq(p, @ui_protocol.Cancelled)
    None => fail("1907 probe should record cancel phase")
  }
}

///|
/// §3.0 C′ vs B 验收自检（MoonBit 侧不变量；I 不自标）
test "h2_section_3_0_cprime_checklist" {
  let dims = @box_host.h2_cprime_checklist_dims()
  assert_eq(dims.length(), 5)
  assert_true(dims[0].contains("HostUiShell_Live"))
  assert_true(dims[1].contains("run_h2_probe"))
  assert_true(dims[2].contains("audit"))
  assert_true(dims[3].contains("HostUiEvent"))
  assert_true(dims[4].contains("LiveDisplay"))
  let banned = @box_host.h2_b_rejection_markers()
  assert_true(banned.length() >= 3)
  for m in banned {
    assert_false(m.contains("C_prime"))
  }

  let live = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1", ui_automation=true),
  )
  let shell = live.host_ui_shell()
  assert_true(shell.is_live())
  let intent = @ui_protocol.OpenSettingsIntent::open(
    @ui_protocol.SidebarAccountButton,
  )
  match live.ui_open_settings(shell, intent) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  // Events absorbed via run_h2_probe path
  let rec = live.run_h2_probe(@box_host.Cm1901SettingsEntry)
  assert_false(rec.i_claimed)
  assert_true(live.ui_event_count() >= 1)
  assert_true(live.audit_span_count() >= 1)
  // Evidence points at host_h2_smoke (HostUiShell Live adapter), not fixture-only
  assert_true(rec.evidence_cmd_hint.contains("host_h2_smoke"))
  assert_false(rec.artifact_dir.contains("fixture-only"))
}

///|
test "h2_batch2_intent_cm_ids_and_subdirs" {
  assert_eq(@box_host.Cm1903UpdateComputer.cm_id(), "CM-1903")
  assert_eq(@box_host.Cm1904ResetComputer.cm_id(), "CM-1904")
  assert_eq(@box_host.Cm1905LocalExecution.cm_id(), "CM-1905")
  assert_eq(@box_host.Cm1906UpdatesVsUpdateComputer.cm_id(), "CM-1906")
  assert_eq(
    @box_host.Cm1903UpdateComputer.artifact_subdir(),
    "cm-1903-update-computer",
  )
  assert_eq(
    @box_host.Cm1904ResetComputer.artifact_subdir(),
    "cm-1904-reset-computer",
  )
  assert_eq(
    @box_host.Cm1905LocalExecution.artifact_subdir(),
    "cm-1905-local-execution",
  )
  assert_eq(
    @box_host.Cm1906UpdatesVsUpdateComputer.artifact_subdir(),
    "cm-1906-updates-vs-update-computer",
  )
}

///|
test "h2_batch2_wave_never_claims_i" {
  let live = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1", ui_automation=true),
  )
  let wave = live.run_h2_wave_batch2()
  assert_eq(wave.length(), 4)
  assert_true(@box_host.h2_wave_i_unclaimed(wave))
  for r in wave {
    assert_false(r.i_claimed)
    assert_eq(r.backend_kind, "Live")
    assert_true(r.evidence_cmd_hint.contains("host_h2_smoke"))
    assert_false(r.artifact_dir.contains("fixture-only"))
  }
  assert_true(live.audit_span_count() >= 4)
}

///|
test "h2_cm1903_two_step_then_cancel_not_completed" {
  let shell = @box_host.HostUiShell::live()
  match shell.request_update_computer() {
    Ok(ph) => assert_eq(ph, "prompted")
    Err(e) => fail(e)
  }
  match shell.confirm_update_computer_step() {
    Ok(ph) => assert_eq(ph, "awaiting-second-confirm")
    Err(e) => fail(e)
  }
  match shell.cancel_update_computer() {
    Ok(ph) => assert_eq(ph, "cancelled")
    Err(e) => fail(e)
  }
  let mut saw_completed = false
  let mut saw_second = false
  for ev in shell.events {
    match ev {
      @box_host.UpdateComputerPhaseChanged(phase~) => {
        if phase == "completed" {
          saw_completed = true
        }
        if phase == "awaiting-second-confirm" {
          saw_second = true
        }
      }
      _ => ()
    }
  }
  assert_true(saw_second)
  assert_false(saw_completed)
  // Not Reset path
  let mut saw_reset_anchor = false
  for ev in shell.events {
    match ev {
      @box_host.SettingsAnchorVisible(anchor~) =>
        if anchor == @ui_protocol.ResetComputer {
          saw_reset_anchor = true
        }
      _ => ()
    }
  }
  assert_false(saw_reset_anchor)
}

///|
test "h2_cm1904_reset_reachable_not_preferred" {
  let shell = @box_host.HostUiShell::live()
  match shell.open_reset_computer() {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  let mut saw_reset = false
  for ev in shell.events {
    match ev {
      @box_host.SettingsAnchorVisible(anchor~) =>
        if anchor == @ui_protocol.ResetComputer {
          saw_reset = true
        }
      _ => ()
    }
  }
  assert_true(saw_reset)
  assert_false(
    @ui_protocol.is_assistant_preferred_computer_recovery(
      @ui_protocol.ResetComputer,
    ),
  )
  assert_true(
    @ui_protocol.is_assistant_preferred_computer_recovery(
      @ui_protocol.UpdateComputer,
    ),
  )
}

///|
test "h2_cm1905_local_execution_off_refuses_machine" {
  let shell = @box_host.HostUiShell::live()
  shell.set_local_execution(enabled=false)
  assert_false(shell.local_execution_enabled)
  match shell.try_machine_call("desk-1") {
    Err(msg) =>
      assert_true(msg.contains("local-execution") || msg.contains("rejected"))
    Ok(_) => fail("must refuse machineId when local-execution off")
  }
  let mut saw_gate = false
  for ev in shell.events {
    match ev {
      @box_host.LocalExecutionGateChanged(enabled~) =>
        if !enabled {
          saw_gate = true
        }
      _ => ()
    }
  }
  assert_true(saw_gate)
  let mut saw_rejected = false
  for e in shell.effects {
    if e.has_prefix("rejected_local_off:") {
      saw_rejected = true
    }
  }
  assert_true(saw_rejected)
}

///|
test "h2_cm1906_updates_tab_vs_update_computer_distinguishable" {
  let host = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  let rec = host.run_h2_probe(@box_host.Cm1906UpdatesVsUpdateComputer)
  assert_false(rec.i_claimed)
  match rec.anchor {
    Some(a) => assert_eq(a, @ui_protocol.UpdateComputer)
    None => fail("1906 should end on update-computer anchor")
  }
  let mut saw_channel = false
  let mut saw_computer = false
  for ev in host.ui_events {
    match ev {
      @box_host.SettingsAnchorVisible(anchor~) => {
        if anchor == @ui_protocol.UpdateChannel {
          saw_channel = true
        }
        if anchor == @ui_protocol.UpdateComputer {
          saw_computer = true
        }
      }
      _ => ()
    }
  }
  assert_true(saw_channel)
  assert_true(saw_computer)
  assert_true(@ui_protocol.update_channel_ne_update_computer())
}

///|
test "h2_cm1903_probe_cancels_after_second_prompt" {
  let host = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  let rec = host.run_h2_probe(@box_host.Cm1903UpdateComputer)
  assert_false(rec.i_claimed)
  match rec.update_computer_phase {
    Some(ph) => assert_eq(ph, "cancelled")
    None => fail("1903 probe should record cancel phase")
  }
  match rec.anchor {
    Some(a) => assert_eq(a, @ui_protocol.UpdateComputer)
    None => fail("1903 must target UpdateComputer not Reset")
  }
}

///|
test "h2_cm1905_probe_records_gate_off" {
  let host = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  let rec = host.run_h2_probe(@box_host.Cm1905LocalExecution)
  assert_false(rec.i_claimed)
  match rec.local_execution_enabled {
    Some(on) => assert_false(on)
    None => fail("1905 should record local_execution_enabled=false")
  }
}

///|
test "h2_batch3_ids_subdirs_and_wave_unclaimed" {
  let pairs : Array[(@box_host.H2Intent, String, String)] = [
    (@box_host.Cm0204HiddenAgent, "CM-0204", "cm-0204-hidden-agent"),
    (@box_host.Cm0205InfoPanel, "CM-0205", "cm-0205-info-panel"),
    (@box_host.Cm0206NotifyToggles, "CM-0206", "cm-0206-notify-toggles"),
    (
      @box_host.Cm1401CreateAgentSidebar,
      "CM-1401",
      "cm-1401-create-agent-sidebar",
    ),
    (@box_host.Cm1405MembersPanel, "CM-1405", "cm-1405-members-panel"),
    (
      @box_host.Cm1507AutoReviewDeeplink,
      "CM-1507",
      "cm-1507-auto-review-deeplink",
    ),
    (
      @box_host.Cm2178PermissionGuideSettings,
      "CM-2178",
      "cm-2178-permission-guide-settings",
    ),
  ]
  for p in pairs {
    let (i, cm, sub) = p
    assert_eq(i.cm_id(), cm)
    assert_eq(i.artifact_subdir(), sub)
  }
  let live = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1", ui_automation=true),
  )
  let wave = live.run_h2_wave_batch3()
  assert_eq(wave.length(), 7)
  assert_true(@box_host.h2_wave_i_unclaimed(wave))
  for r in wave {
    assert_eq(r.backend_kind, "Live")
    assert_true(r.evidence_cmd_hint.contains("host_h2_smoke.sh cm-"))
    assert_true(r.evidence_cmd_hint.contains(r.cm_id.to_lower()))
    assert_false(r.artifact_dir.contains("fixture-only"))
  }
  assert_true(live.audit_span_count() >= 7)
}

///|
test "h2_cm0204_hidden_not_in_sidebar_but_addressable" {
  let shell = @box_host.HostUiShell::live()
  match shell.set_agent_hidden("h2-hidden-agent", hidden=true) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_false(shell.main_sidebar_ids().contains("h2-hidden-agent"))
  assert_true(shell.main_sidebar_ids().contains("h2-throwaway-agent"))
  match shell.address_agent("h2-hidden-agent") {
    Ok(hidden) => assert_true(hidden)
    Err(e) => fail(e)
  }
  let mut saw = false
  for ev in shell.events {
    match ev {
      @box_host.SidebarHiddenAgentAddressable(agent_id~) =>
        if agent_id == "h2-hidden-agent" {
          saw = true
        }
      _ => ()
    }
  }
  assert_true(saw)
  match shell.address_agent("never-registered") {
    Err(_) => ()
    Ok(_) => fail("unknown agent must Err")
  }
  // Non-hidden address must not emit SidebarHiddenAgentAddressable
  let shell2 = @box_host.HostUiShell::live()
  match shell2.address_agent("h2-throwaway-agent") {
    Ok(hidden) => assert_false(hidden)
    Err(e) => fail(e)
  }
  for ev in shell2.events {
    match ev {
      @box_host.SidebarHiddenAgentAddressable(..) =>
        fail("visible agent must not emit SidebarHiddenAgentAddressable")
      _ => ()
    }
  }
}

///|
test "h2_cm0205_info_panel_five_sections_not_settings" {
  let shell = @box_host.HostUiShell::live()
  match shell.open_info_panel("h2-throwaway-agent") {
    Ok(s) => {
      assert_eq(s.length(), 5)
      assert_eq(s[0], "desktop-preview")
      assert_eq(s[4], "gear-settings")
    }
    Err(e) => fail(e)
  }
  for ev in shell.events {
    match ev {
      @box_host.SettingsOpened(..) => fail("info panel must not open Settings")
      _ => ()
    }
  }
}

///|
test "h2_cm0206_notify_toggles_isolated_per_agent" {
  let shell = @box_host.HostUiShell::live()
  match
    shell.set_agent_notify("h2-throwaway-agent", @ui_protocol.Sound, false) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_false(shell.agent_notify("h2-throwaway-agent", @ui_protocol.Sound))
  assert_true(shell.agent_notify("demo-agent", @ui_protocol.Sound))
  assert_false(shell.agent_notify("demo-agent", @ui_protocol.MentionsOnly))
}

///|
test "h2_cm1401_create_agent_sidebar_and_members" {
  let shell = @box_host.HostUiShell::live()
  match shell.create_agent("h2-created-agent") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_true(shell.main_sidebar_ids().contains("h2-created-agent"))
  match shell.create_agent("h2-created-agent") {
    Err(m) => assert_true(m.contains("exists"))
    Ok(_) => fail("duplicate CreateAgent must Err")
  }
  match shell.open_members_panel("h2-group", ["h2-created-agent"]) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  let mut saw = false
  for ev in shell.events {
    match ev {
      @box_host.MembersPanelVisible(member_ids~, ..) =>
        if member_ids.contains("h2-created-agent") {
          saw = true
        }
      _ => ()
    }
  }
  assert_true(saw)
  match shell.open_members_panel("h2-group", ["ghost"]) {
    Err(_) => ()
    Ok(_) => fail("unknown member must Err")
  }
}

///|
test "h2_cm1507_auto_review_anchors_visible" {
  let host = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  let _ = host.run_h2_probe(@box_host.Cm1507AutoReviewDeeplink)
  let seen : Array[String] = []
  for ev in host.ui_events {
    match ev {
      @box_host.SettingsAnchorVisible(anchor~) => seen.push(anchor.id())
      _ => ()
    }
  }
  assert_true(seen.contains("auto-review"))
  assert_true(seen.contains("auto-review-rules"))
  assert_true(seen.contains("security-keys"))
}

///|
test "h2_cm2178_permission_guide_opens_settings_not_pretend" {
  let shell = @box_host.HostUiShell::live()
  match
    shell.open_permission_guide(
      @ui_protocol.ConnectorNeedsAuth(namespace_="user-Gmail"),
    ) {
    Ok(a) => assert_eq(a, @ui_protocol.Account)
    Err(e) => fail(e)
  }
  let mut opened = false
  let mut pretend = false
  for ev in shell.events {
    match ev {
      @box_host.SettingsOpened(..) => opened = true
      @box_host.PermissionGuideShown(pretends_connected~, ..) =>
        if pretends_connected {
          pretend = true
        }
      _ => ()
    }
  }
  assert_true(opened)
  assert_false(pretend)
}
