///|
/// H4 Host MCP/IO skeleton tests (CM-2163/2164 + plan stubs). U-safe: never claim I-PASS.

///|
test "h4_probe_skeleton_never_claims_i" {
  let mock = @box_host.HostAbi::mock()
  let rec = mock.run_h4_probe(@box_host.Cm2163McpFileExpand)
  assert_false(rec.i_claimed)
  assert_eq(rec.backend_kind, "Mock")
  assert_true(rec.asserts_i_not_claimed())
  assert_true(rec.artifact_dir.contains("cm-2163-mcp-file-expand"))
  assert_true(rec.evidence_cmd_hint.contains("host_h4_smoke"))
  assert_true(rec.evidence_cmd_hint.contains("cm-2163"))
  assert_eq(rec.cm_id, "CM-2163")
  assert_eq(rec.chat_has_payload_marker, Some(false))
  match rec.file_ref {
    Some(r) => assert_true(r.contains("file:"))
    None => fail("2163 probe must plan file_ref")
  }

  let live = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::default_workspace(),
  )
  let wave = live.run_h4_wave()
  assert_eq(wave.length(), 7)
  assert_true(@box_host.h4_wave_i_unclaimed(wave))
  for r in wave {
    assert_false(r.i_claimed)
    assert_eq(r.backend_kind, "Live")
    assert_true(r.evidence_cmd_hint.contains("host_h4_smoke"))
  }
  assert_true(live.audit_span_count() >= 7)

  let batch1 = live.run_h4_batch1()
  assert_eq(batch1.length(), 2)
  assert_eq(batch1[0].cm_id, "CM-2163")
  assert_eq(batch1[1].cm_id, "CM-2164")
}

///|
test "h4_intent_cm_ids_and_artifact_subdirs" {
  assert_eq(@box_host.Cm2163McpFileExpand.cm_id(), "CM-2163")
  assert_eq(@box_host.Cm2164McpWriteToFile.cm_id(), "CM-2164")
  assert_eq(@box_host.Cm1105SlackConnect.cm_id(), "CM-1105")
  assert_eq(@box_host.Cm2109FinanceOauth.cm_id(), "CM-2109")
  assert_eq(@box_host.Cm2120OutlookOauth.cm_id(), "CM-2120")
  assert_eq(@box_host.Cm2146AppVsUserBrowser.cm_id(), "CM-2146")
  assert_eq(@box_host.Cm1703FetchPublicFallback.cm_id(), "CM-1703")
  assert_eq(
    @box_host.Cm2163McpFileExpand.artifact_subdir(),
    "cm-2163-mcp-file-expand",
  )
  assert_eq(
    @box_host.Cm2164McpWriteToFile.artifact_subdir(),
    "cm-2164-mcp-write-to-file",
  )
  assert_true(@box_host.Cm2163McpFileExpand.is_batch1_host_fs())
  assert_true(@box_host.Cm2164McpWriteToFile.is_batch1_host_fs())
  assert_false(@box_host.Cm1105SlackConnect.is_batch1_host_fs())
}

///|
test "h4_2164_probe_plans_agent_tools_path" {
  let host = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::default_workspace(),
  )
  let rec = host.run_h4_probe(@box_host.Cm2164McpWriteToFile)
  match rec.result_path {
    Some(p) => {
      assert_true(p.has_prefix("/workspace/agent-tools/"))
    }
    None => fail("2164 probe must plan result_path under agent-tools")
  }
  assert_eq(rec.chat_has_payload_marker, Some(false))
  assert_false(rec.i_claimed)
  assert_true(rec.artifact_dir.contains("cm-2164-mcp-write-to-file"))
}

///|
test "h4_oauth_intents_plan_needs_auth_not_claimed" {
  let host = @box_host.HostAbi::mock()
  let slack = host.run_h4_probe(@box_host.Cm1105SlackConnect)
  assert_eq(slack.oauth_provider, Some("slack"))
  assert_eq(slack.namespace_before, Some("NeedsAuth"))
  assert_false(slack.i_claimed)
  let fin = host.run_h4_probe(@box_host.Cm2109FinanceOauth)
  assert_eq(fin.oauth_provider, Some("finance"))
  let outl = host.run_h4_probe(@box_host.Cm2120OutlookOauth)
  assert_eq(outl.oauth_provider, Some("outlook"))
  let fb = host.run_h4_probe(@box_host.Cm1703FetchPublicFallback)
  assert_eq(fb.primary_status, Some(403))
  assert_eq(fb.credential_bypass, Some(false))
}
