///|
/// H3 Host FFI skeleton tests (CM-2158/2174/0705/0411). U-safe: never claim I-PASS.

///|
test "h3_probe_skeleton_never_claims_i" {
  let mock = @box_host.HostAbi::mock()
  let rec = mock.run_h3_probe(@box_host.Cm2158PackageInstall)
  assert_false(rec.i_claimed)
  assert_eq(rec.backend_kind, "Mock")
  assert_true(rec.asserts_i_not_claimed())
  assert_true(rec.artifact_dir.contains("cm-2158-package-install"))
  assert_true(rec.evidence_cmd_hint.contains("host_h3_smoke"))
  assert_true(rec.evidence_cmd_hint.contains("cm-2158"))
  assert_eq(rec.cm_id, "CM-2158")
  assert_eq(rec.package_manager, Some("npm"))

  let live = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::default_workspace(),
  )
  let wave = live.run_h3_wave()
  assert_eq(wave.length(), 4)
  assert_true(@box_host.h3_wave_i_unclaimed(wave))
  for r in wave {
    assert_false(r.i_claimed)
    assert_eq(r.backend_kind, "Live")
    assert_true(r.evidence_cmd_hint.contains("host_h3_smoke"))
  }
  assert_true(live.audit_span_count() >= 4)
}

///|
test "h3_intent_cm_ids_and_artifact_subdirs" {
  assert_eq(@box_host.Cm2158PackageInstall.cm_id(), "CM-2158")
  assert_eq(@box_host.Cm2174SharedBoxFs.cm_id(), "CM-2174")
  assert_eq(@box_host.Cm0705DeviceLocalTools.cm_id(), "CM-0705")
  assert_eq(@box_host.Cm0411WebhookKeyOpaque.cm_id(), "CM-0411")
  assert_eq(
    @box_host.Cm2158PackageInstall.artifact_subdir(),
    "cm-2158-package-install",
  )
  assert_eq(
    @box_host.Cm2174SharedBoxFs.artifact_subdir(),
    "cm-2174-shared-box-fs",
  )
  assert_eq(
    @box_host.Cm0705DeviceLocalTools.artifact_subdir(),
    "cm-0705-device-local-tools",
  )
  assert_eq(
    @box_host.Cm0411WebhookKeyOpaque.artifact_subdir(),
    "cm-0411-webhook-panel",
  )
}

///|
test "h3_2174_probe_plans_distinct_desktops" {
  let host = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::default_workspace(),
  )
  let rec = host.run_h3_probe(@box_host.Cm2174SharedBoxFs)
  assert_eq(rec.agent_a_id, Some("h3-agent-a"))
  assert_eq(rec.agent_b_id, Some("h3-agent-b"))
  assert_eq(rec.shared_path, Some("/workspace/cross-agent-shared.txt"))
  match (rec.desktop_a_display, rec.desktop_b_display) {
    (Some(a), Some(b)) => assert_true(a != b)
    _ => fail("2174 probe must plan distinct displays")
  }
  assert_false(rec.i_claimed)
}

///|
test "h3_0705_probe_plans_platform_subset_label" {
  let host = @box_host.HostAbi::mock()
  let rec = host.run_h3_probe(@box_host.Cm0705DeviceLocalTools)
  assert_eq(
    rec.platform_subset,
    Some(@box_host.h3_platform_subset_desktop_no_device_local_tools()),
  )
  assert_eq(rec.permission_card_shown, Some(false))
  assert_false(rec.i_claimed)
  // Desktop lists no deviceLocalTools (U shape preserved).
  let machines = @box_host.MachineRegistry::seed()
  let devices = @box_host.DeviceLocalToolsRegistry::seed_phones()
  let desk = machines.device_local_tools_for(devices, "desk-1")
  assert_eq(desk.length(), 0)
}
