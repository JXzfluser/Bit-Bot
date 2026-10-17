///|
/// H1 Live probe skeleton tests. U-safe: never claim I-PASS.

///|
test "h1_probe_skeleton_never_claims_i" {
  let mock = @box_host.HostAbi::mock()
  let rec = mock.run_h1_probe(@box_host.Cm0605Screenshot)
  assert_false(rec.i_claimed)
  assert_eq(rec.backend_kind, "Mock")
  assert_true(rec.asserts_i_not_claimed())
  assert_true(rec.artifact_dir.contains("cm-0605-screenshot"))
  assert_true(rec.evidence_cmd_hint.contains("host_h1_smoke"))
  assert_true(rec.evidence_cmd_hint.contains("cm-0605"))

  let live = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  let wave = live.run_h1_wave()
  assert_eq(wave.length(), 4)
  assert_true(@box_host.h1_wave_i_unclaimed(wave))
  for r in wave {
    assert_false(r.i_claimed)
    assert_eq(r.backend_kind, "Live")
    assert_true(r.evidence_cmd_hint.contains("host_h1_smoke"))
  }
  assert_true(live.audit_span_count() >= 4)
}

///|
test "h1_intent_cm_ids_and_artifact_subdirs" {
  assert_eq(@box_host.Cm0605Screenshot.cm_id(), "CM-0605")
  assert_eq(@box_host.Cm0802BoxChrome.cm_id(), "CM-0802")
  assert_eq(@box_host.Cm2160Navigate.cm_id(), "CM-2160")
  assert_eq(@box_host.Cm0806SessionJar.cm_id(), "CM-0806")
  assert_eq(
    @box_host.Cm0605Screenshot.artifact_subdir(),
    "cm-0605-screenshot",
  )
  assert_eq(@box_host.Cm0802BoxChrome.artifact_subdir(), "cm-0802-box-chrome")
  assert_eq(@box_host.Cm2160Navigate.artifact_subdir(), "cm-2160-navigate")
  assert_eq(@box_host.Cm0806SessionJar.artifact_subdir(), "cm-0806-session-jar")
}

///|
test "h1_live_vs_mock_backend_labels_no_silent_fallback" {
  let mock = @box_host.HostAbi::mock()
  let live = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  assert_eq(mock.backend_kind(), "Mock")
  assert_eq(live.backend_kind(), "Live")
  assert_false(mock.is_live())
  assert_true(live.is_live())
  match live.backend {
    @box_host.Live(c) => assert_eq(c.display, Some(":1"))
    @box_host.Mock => fail("Live must not degrade to Mock")
  }
  let r_mock = mock.run_h1_probe(@box_host.Cm0605Screenshot)
  let r_live = live.run_h1_probe(@box_host.Cm0605Screenshot)
  assert_eq(r_mock.backend_kind, "Mock")
  assert_eq(r_live.backend_kind, "Live")
  assert_false(r_mock.i_claimed)
  assert_false(r_live.i_claimed)
}

///|
test "h1_live_frame_artifact_path_documents_cm0605" {
  let p = @box_host.h1_live_frame_artifact_path()
  assert_true(p.contains("cm-0605-screenshot"))
  assert_true(p.contains("live_display.png"))
  assert_true(p.contains("artifacts"))
  // Path helper does not claim I.
  let host = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  let rec = host.run_h1_probe(@box_host.Cm0605Screenshot)
  assert_false(rec.i_claimed)
  assert_eq(rec.artifact_dir, @box_host.host_artifacts_dir() + "/cm-0605-screenshot")
}

///|
test "h1_mock_screenshot_unchanged_placeholder" {
  let host = @box_host.HostAbi::mock()
  let shot = host.screenshot("h1-executor")
  assert_eq(shot.frame_origin, @box_host.Placeholder)
  assert_eq(shot.display_id, None)
  assert_true(shot.read_only)
  assert_false(shot.clicked)
}

///|
test "h1_each_probe_evidence_cmd_matches_smoke" {
  let host = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  let pairs : Array[(@box_host.H1Intent, String)] = [
    (@box_host.Cm0605Screenshot, "cm-0605"),
    (@box_host.Cm0802BoxChrome, "cm-0802"),
    (@box_host.Cm2160Navigate, "cm-2160"),
    (@box_host.Cm0806SessionJar, "cm-0806"),
  ]
  for pair in pairs {
    let (intent, flag) = pair
    let rec = host.run_h1_probe(intent)
    assert_false(rec.i_claimed)
    assert_true(rec.evidence_cmd_hint.contains(flag))
    assert_true(rec.artifact_dir.contains(intent.artifact_subdir()))
  }
}

///|
test "h1_cm0802_guard_refuses_bare_chrome" {
  let bare : Array[String] = [
    "google-chrome-stable --user-data-dir=/tmp/x about:blank",
    "/opt/google/chrome/chrome --no-sandbox",
    "chrome",
    "chromium --headless=new",
    "google-chrome",
    "",
  ]
  for cmd in bare {
    match @box_host.box_chrome_launch_guard(cmd) {
      Err(m) => assert_true(m.contains("refused"))
      Ok(_) => fail("bare launch must be refused: " + cmd)
    }
  }
  match @box_host.box_chrome_launch_guard("/usr/local/bin/box-chrome https://example.com") {
    Ok(p) => assert_eq(p, "/usr/local/bin/box-chrome")
    Err(e) => fail(e)
  }
}

///|
test "h1_cm0802_live_guard_audits_refusal_no_i_claim" {
  let live = @box_host.HostAbi::live(
    @box_host.LiveHostConfig::with_display(":1"),
  )
  match live.guard_browser_launch("google-chrome-stable") {
    Err(_) => ()
    Ok(_) => fail("Live guard must refuse bare chrome")
  }
  match live.guard_browser_launch("/usr/local/bin/box-chrome") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  let mut refused_span = false
  let mut allowed_span = false
  for s in live.audit_spans {
    if s.tool_name == "h1_launch_guard" {
      if s.ok { allowed_span = true } else { refused_span = true }
      match s.artifact_path {
        Some(p) => assert_true(p.contains("bare_refusal.txt"))
        None => fail("guard span needs artifact_path")
      }
    }
  }
  assert_true(refused_span)
  assert_true(allowed_span)
  let rec = live.run_h1_probe(@box_host.Cm0802BoxChrome)
  assert_false(rec.i_claimed)
  // Mock: same verdict, no audit span.
  let mock = @box_host.HostAbi::mock()
  match mock.guard_browser_launch("chrome") {
    Err(_) => ()
    Ok(_) => fail("Mock guard must refuse bare chrome")
  }
  assert_eq(mock.audit_span_count(), 0)
}
