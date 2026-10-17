///|
/// M-batch P0: CM-1901 Settings entry, CM-1902 anchors, CM-1907 delete agent.
/// Kernel-contract only — do NOT claim host-integration / real-screen PASS.

///|
/// CM-1901: only SidebarAccountButton | KeyboardShortcut | CommandPalette;
/// OpenSettingsIntent validates; forbid gear / Preferences / per-agent panel gear.
test "acceptance_CM-1901_settings_entry_closed_set" {
  let entries = [
    @ui_protocol.SettingsEntry::SidebarAccountButton,
    @ui_protocol.SettingsEntry::KeyboardShortcut,
    @ui_protocol.SettingsEntry::CommandPalette,
  ]
  assert_eq(entries.length(), 3)
  for e in entries {
    let intent = @ui_protocol.OpenSettingsIntent::open(e)
    match intent.validate() {
      Ok(_) => ()
      Err(err) => fail(err)
    }
    let host = @ui_protocol.HostSettingsUiMock::new()
    match host.open_settings(intent) {
      Ok(_) => ()
      Err(err) => fail(err)
    }
  }
  // Forbidden guidance paths.
  assert_true(
    @ui_protocol.validate_settings_entry_guidance(
      "Click the gear icon to open Settings",
    )
    is Err(_),
  )
  assert_true(
    @ui_protocol.validate_settings_entry_guidance(
      "Use the macOS Preferences menu",
    )
    is Err(_),
  )
  assert_true(
    @ui_protocol.validate_settings_entry_guidance(
      "Open the per-agent info panel gear for global Settings",
    )
    is Err(_),
  )
  // Allowed: describe the three real entries.
  match
    @ui_protocol.validate_settings_entry_guidance(
      "Open Settings via sidebar account button, Cmd+,, or Command Palette Open settings",
    ) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  // With optional deep-link anchor still validates.
  let with_anchor = @ui_protocol.OpenSettingsIntent::open(
    @ui_protocol.SettingsEntry::CommandPalette,
    anchor=Some(@ui_protocol.SettingsAnchor::Theme),
  )
  match with_anchor.validate() {
    Ok(_) => ()
    Err(e) => fail(e)
  }
}

///|
/// CM-1902: closed-set SettingsAnchor ↔ id bijection; deep link form only;
/// unknown id → Error.
test "acceptance_CM-1902_settings_anchor_deeplink_bijection" {
  let all = @ui_protocol.settings_anchors_closed_set()
  // Expected closed-set size from host-ui-contract.md §2.2:
  // General 15 + Computer 4 + Usage&Billing 5 + Updates 3 = 27
  assert_eq(all.length(), 27)
  let mut i = 0
  while i < all.length() {
    let a = all[i]
    let id = a.id()
    match @ui_protocol.parse_settings_anchor(id) {
      Ok(back) => assert_eq(back, a)
      Err(e) => fail(e)
    }
    let link = @ui_protocol.settings_deep_link(a)
    assert_true(link.has_prefix("grokbot://app/v1/settings?id="))
    assert_true(link.contains(id))
    match @ui_protocol.parse_settings_deep_link(link) {
      Ok(back) => assert_eq(back, a)
      Err(e) => fail(e)
    }
    i = i + 1
  }
  // Unknown id → Error (never silent).
  match @ui_protocol.parse_settings_anchor("not-a-real-anchor") {
    Err(msg) => assert_true(msg.contains("unknown"))
    Ok(_) => fail("unknown anchor must Error")
  }
  match
    @ui_protocol.parse_settings_deep_link(
      "grokbot://app/v1/settings?id=invented-xyz",
    ) {
    Err(msg) => assert_true(msg.contains("unknown") || msg.contains("anchor"))
    Ok(_) => fail("unknown deep link id must Error")
  }
  // Wrong URI shape rejected.
  match @ui_protocol.parse_settings_deep_link("grokbot://settings?id=theme") {
    Err(_) => ()
    Ok(_) => fail("legacy/wrong shape must not parse as settings deep link")
  }
  // Tabs present.
  assert_eq(
    @ui_protocol.SettingsAnchor::Theme.tab(),
    @ui_protocol.SettingsTab::General,
  )
  assert_eq(
    @ui_protocol.SettingsAnchor::UpdateComputer.tab(),
    @ui_protocol.SettingsTab::Computer,
  )
  assert_eq(
    @ui_protocol.SettingsAnchor::Billing.tab(),
    @ui_protocol.SettingsTab::UsageBilling,
  )
  assert_eq(
    @ui_protocol.SettingsAnchor::UpdateChannel.tab(),
    @ui_protocol.SettingsTab::Updates,
  )
}

///|
/// CM-1907: sidebar context-menu Delete + confirm; not in Settings;
/// no Completed without confirm; archive/hide ≠ delete.
test "acceptance_CM-1907_delete_agent_confirm_not_settings" {
  let host = @ui_protocol.HostAgentLifecycleUiMock::new()
  let aid = @ui_protocol.HostAgentId::new("agent-m1907")
  // Forbidden paths.
  match
    host.request_delete_agent(
      aid,
      path=@ui_protocol.DeleteAgentPath::SettingsPanel,
    ) {
    Err(msg) =>
      assert_true(
        msg.contains("Settings") ||
        msg.contains("sidebar") ||
        msg.contains("context-menu"),
      )
    Ok(_) => fail("delete via Settings must be rejected")
  }
  match
    host.request_delete_agent(
      aid,
      path=@ui_protocol.DeleteAgentPath::ArchiveOrHide,
    ) {
    Err(_) => ()
    Ok(_) => fail("archive/hide must not count as delete")
  }
  assert_true(
    @ui_protocol.archive_or_hide_is_not_delete(
      @ui_protocol.DeleteAgentPath::ArchiveOrHide,
    ),
  )
  // Legal path → AwaitingConfirm.
  match
    host.request_delete_agent(
      aid,
      path=@ui_protocol.DeleteAgentPath::SidebarContextMenu,
    ) {
    Ok(intent) => {
      assert_eq(intent.phase, @ui_protocol.DeleteAgentPhase::AwaitingConfirm)
      // Cannot complete without confirm.
      match host.force_complete_without_confirm() {
        Err(msg) =>
          assert_true(msg.contains("confirm") || msg.contains("Completed"))
        Ok(_) => fail("Completed without confirm must fail")
      }
      assert_false(host.agent_removed)
      assert_false(host.transcript_removed)
      // Confirm → Completed; agent + transcript removed.
      match host.confirm_delete_agent(intent) {
        Ok(done) => {
          assert_eq(done.phase, @ui_protocol.DeleteAgentPhase::Completed)
          assert_true(host.agent_removed)
          assert_true(host.transcript_removed)
        }
        Err(e) => fail(e)
      }
    }
    Err(e) => fail(e)
  }
  // Cancel path never reaches Completed.
  let host2 = @ui_protocol.HostAgentLifecycleUiMock::new()
  match host2.request_delete_agent(aid) {
    Ok(intent2) =>
      match host2.cancel_delete_agent(intent2) {
        Ok(c) => {
          assert_eq(c.phase, @ui_protocol.DeleteAgentPhase::Cancelled)
          assert_false(host2.agent_removed)
        }
        Err(e) => fail(e)
      }
    Err(e) => fail(e)
  }
  // Guidance must not point into Settings.
  assert_true(
    @ui_protocol.validate_delete_agent_guidance(
      "Open Settings and delete the agent there",
    )
    is Err(_),
  )
  match
    @ui_protocol.validate_delete_agent_guidance(
      "Right-click the agent in the sidebar, choose Delete, then confirm (not in Settings)",
    ) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
}
