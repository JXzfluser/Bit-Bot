///|
/// Live backend skeleton tests (G-ABI-1/2, G-SCR). U-safe: do not claim I-PASS.

///|
test "live_backend_display_colon1_exposes_live_no_mock_fallback" {
  let cfg = @box_host.LiveHostConfig::with_display(":1")
  let host = @box_host.HostAbi::live(cfg)
  assert_eq(host.backend_kind(), "Live")
  assert_true(host.is_live())
  // Construction is Live; no silent Mock.
  match host.backend {
    @box_host.Live(c) => {
      assert_eq(c.display, Some(":1"))
      assert_eq(c.workspace_root, "/workspace")
    }
    @box_host.Mock => fail("Live factory must not degrade to Mock")
  }
  // with_backend(Live) likewise.
  let host2 = @box_host.HostAbi::with_backend(
    @box_host.Live(@box_host.LiveHostConfig::with_display(":1")),
  )
  assert_eq(host2.backend_kind(), "Live")
}

///|
test "mock_screenshot_still_placeholder_frame_origin" {
  let host = @box_host.HostAbi::mock()
  let shot = host.screenshot("executor")
  assert_eq(shot.frame_origin, @box_host.Placeholder)
  assert_eq(shot.display_id, None)
  assert_eq(shot.bytes_sha256, None)
  assert_eq(shot.captured_at, None)
  assert_true(shot.has_frame)
  assert_true(shot.read_only)
  assert_false(shot.clicked)
}

///|
test "live_screenshot_unavailable_errs_no_placeholder_fallback" {
  let host = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  match host.screenshot_live("executor") {
    Err(msg) => {
      assert_true(msg.contains("unavailable") || msg.contains("refusing"))
      assert_true(msg.contains(":1") || msg.contains("Placeholder"))
    }
    Ok(_) => fail("Live without inject must Err (no silent Placeholder)")
  }
  // Audit span recorded even on Err.
  assert_true(host.audit_span_count() >= 1)
  let mut saw = false
  for s in host.audit_spans {
    if s.tool_name == "screenshot_live" && !s.ok {
      saw = true
    }
  }
  assert_true(saw)
}

///|
test "live_screenshot_inject_sets_live_display_not_i_pass" {
  let host = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  match host.inject_live_frame("FAKE-LIVE-FRAME-BYTES") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match host.screenshot_live("executor") {
    Ok(shot) => {
      assert_eq(shot.frame_origin, @box_host.LiveDisplay)
      assert_eq(shot.display_id, Some(":1"))
      assert_true(shot.read_only)
      assert_false(shot.clicked)
      assert_true(shot.has_frame)
      match shot.bytes_sha256 {
        Some(h) => assert_true(h.length() > 0)
        None => fail("LiveDisplay must carry bytes_sha256")
      }
      match shot.captured_at {
        Some(t) => assert_true(t.length() > 0)
        None => fail("LiveDisplay must carry captured_at")
      }
    }
    Err(e) => fail(e)
  }
  // Audit on success.
  let mut ok_span = false
  for s in host.audit_spans {
    if s.tool_name == "screenshot_live" && s.ok {
      ok_span = true
      match s.artifact_path {
        Some(p) => assert_true(p.contains("live.png") || p.contains("shots"))
        None => fail("ok live span needs artifact_path")
      }
    }
  }
  assert_true(ok_span)
  // Second call without re-inject → Err (no sticky fake I).
  match host.screenshot_live("executor") {
    Err(_) => ()
    Ok(_) => fail("inject must be single-shot")
  }
}

///|
test "live_side_effect_audit_span_queryable" {
  let host = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  // Force Err path — still records audit (G-ABI-2).
  match host.screenshot_live("a") {
    Err(_) => ()
    Ok(_) => fail("expected Err")
  }
  assert_true(host.audit_span_count() >= 1)
  let span = host.audit_spans[0]
  assert_eq(span.tool_name, "screenshot_live")
  assert_false(span.ok)
}

///|
test "h0_probe_skeleton_never_claims_i" {
  let mock = @box_host.HostAbi::mock()
  let rec = mock.run_h0_probe(@box_host.Cm0607BoxDoctor)
  assert_false(rec.i_claimed)
  assert_eq(rec.backend_kind, "Mock")
  assert_true(rec.asserts_i_not_claimed())
  assert_true(rec.artifact_dir.contains("cm-0607"))
  assert_true(rec.evidence_cmd_hint.contains("host_h0_smoke"))

  let live = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  let wave = live.run_h0_wave()
  assert_eq(wave.length(), 3)
  assert_true(@box_host.h0_wave_i_unclaimed(wave))
  for r in wave {
    assert_false(r.i_claimed)
    assert_eq(r.backend_kind, "Live")
  }
  assert_true(live.audit_span_count() >= 3)
}

///|
test "mock_inject_live_frame_refused" {
  let host = @box_host.HostAbi::mock()
  match host.inject_live_frame("x") {
    Err(m) => assert_true(m.contains("Mock"))
    Ok(_) => fail("Mock must refuse live inject")
  }
}
