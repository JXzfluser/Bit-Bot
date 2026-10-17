///|
/// H5 Host media/UI skeleton tests. U-safe: never claim I-PASS.

///|
test "h5_probe_skeleton_never_claims_i" {
  let mock = @box_host.HostAbi::mock()
  let rec = mock.run_h5_probe(@box_host.Cm1601GenerateImage)
  assert_false(rec.i_claimed)
  assert_eq(rec.backend_kind, "Mock")
  assert_true(rec.asserts_i_not_claimed())
  assert_true(rec.artifact_dir.contains("cm-1601-generate-image"))
  assert_true(rec.evidence_cmd_hint.contains("host_h5_smoke"))
  assert_true(rec.evidence_cmd_hint.contains("cm-1601"))
  assert_eq(rec.cm_id, "CM-1601")
  match rec.image_path {
    Some(p) => assert_true(p.has_prefix("/workspace/agent-tools/"))
    None => fail("1601 probe must plan image_path")
  }

  let live = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::default_workspace(),
  )
  let wave = live.run_h5_wave()
  assert_eq(wave.length(), 9)
  assert_true(@box_host.h5_wave_i_unclaimed(wave))
  for r in wave {
    assert_false(r.i_claimed)
    assert_eq(r.backend_kind, "Live")
    assert_true(r.evidence_cmd_hint.contains("host_h5_smoke"))
  }
  assert_true(live.audit_span_count() >= 9)

  let media = live.run_h5_media()
  assert_eq(media.length(), 5)
  assert_eq(media[0].cm_id, "CM-1601")
  assert_eq(media[4].cm_id, "CM-1807")

  let ui = live.run_h5_ui()
  assert_eq(ui.length(), 4)
  assert_eq(ui[0].cm_id, "CM-2131")
  assert_eq(ui[3].cm_id, "CM-2103")
}

///|
test "h5_intent_cm_ids_and_artifact_subdirs" {
  assert_eq(@box_host.Cm1601GenerateImage.cm_id(), "CM-1601")
  assert_eq(@box_host.Cm1602GenerateVideo.cm_id(), "CM-1602")
  assert_eq(@box_host.Cm1603WatchVideo.cm_id(), "CM-1603")
  assert_eq(@box_host.Cm2157StructuredChart.cm_id(), "CM-2157")
  assert_eq(@box_host.Cm1807Pptx.cm_id(), "CM-1807")
  assert_eq(@box_host.Cm2131CursorAgentCard.cm_id(), "CM-2131")
  assert_eq(@box_host.Cm2101ReactToMessage.cm_id(), "CM-2101")
  assert_eq(@box_host.Cm2128OutboundReactEndTurn.cm_id(), "CM-2128")
  assert_eq(@box_host.Cm2103MathMermaid.cm_id(), "CM-2103")
  assert_eq(
    @box_host.Cm1601GenerateImage.artifact_subdir(),
    "cm-1601-generate-image",
  )
  assert_eq(
    @box_host.Cm2131CursorAgentCard.artifact_subdir(),
    "cm-2131-cursor-agent-card",
  )
  assert_true(@box_host.Cm1601GenerateImage.is_media())
  assert_false(@box_host.Cm1601GenerateImage.is_ui())
  assert_true(@box_host.Cm2101ReactToMessage.is_ui())
  assert_false(@box_host.Cm2101ReactToMessage.is_media())
}

///|
test "h5_media_probes_plan_agent_tools_paths" {
  let host = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::default_workspace(),
  )
  let img = host.run_h5_probe(@box_host.Cm1601GenerateImage)
  match img.image_path {
    Some(p) => assert_true(p.has_prefix("/workspace/agent-tools/"))
    None => fail("1601 image_path")
  }
  assert_false(img.i_claimed)

  let vid = host.run_h5_probe(@box_host.Cm1602GenerateVideo)
  match vid.video_path {
    Some(p) => assert_true(p.has_suffix(".mp4"))
    None => fail("1602 video_path")
  }
  assert_eq(vid.video_complete_notified, Some(true))

  let frame = host.run_h5_probe(@box_host.Cm1603WatchVideo)
  match frame.frame_path {
    Some(p) => assert_true(p.has_prefix("/workspace/agent-tools/"))
    None => fail("1603 frame_path")
  }

  let pptx = host.run_h5_probe(@box_host.Cm1807Pptx)
  match pptx.pptx_path {
    Some(p) => assert_true(p.has_suffix(".pptx"))
    None => fail("1807 pptx_path")
  }
}

///|
test "h5_ui_probes_plan_pills_and_render" {
  let host = @box_host.HostAbi::mock()
  let pill = host.run_h5_probe(@box_host.Cm2101ReactToMessage)
  assert_eq(pill.react_emoji, Some("👍"))
  assert_eq(pill.pill_visible, Some(true))
  assert_false(pill.i_claimed)

  let end = host.run_h5_probe(@box_host.Cm2128OutboundReactEndTurn)
  assert_eq(end.end_turn_left_pill, Some(true))
  assert_eq(end.pill_visible, Some(true))

  let math = host.run_h5_probe(@box_host.Cm2103MathMermaid)
  assert_eq(math.math_rendered, Some(true))
  assert_eq(math.mermaid_rendered, Some(true))

  let card = host.run_h5_probe(@box_host.Cm2131CursorAgentCard)
  match card.cursor_agent_url {
    Some(u) => assert_true(u.contains("cursor.com/agents/"))
    None => fail("2131 cursor_agent_url")
  }
}
