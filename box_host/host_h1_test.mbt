///|
/// H1 宿主机表面测试：Live/Mock 后端标签、Mock 截图占位、Chrome 启动守卫。
/// 原 `h1_probes.mbt` 探针骨架（run_h1_probe / run_h1_wave / H1Intent）整层删除：
/// 它零生产消费者、能力矩阵零引用，只是一层自测脚手架。真正有价值的守卫逻辑
/// （`box_chrome_launch_guard` / `HostAbi::guard_browser_launch`）已搬回
/// `box_host/box_chrome.mbt`，断言保留在这里。

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
test "h1_cm0802_guard_refuses_bare_chrome" {
  let bare : Array[String] = [
    "google-chrome-stable --user-data-dir=/tmp/x about:blank", "/opt/google/chrome/chrome --no-sandbox",
    "chrome", "chromium --headless=new", "google-chrome", "",
  ]
  for cmd in bare {
    match @box_host.box_chrome_launch_guard(cmd) {
      Err(m) => assert_true(m.contains("refused"))
      Ok(_) => fail("bare launch must be refused: " + cmd)
    }
  }
  match
    @box_host.box_chrome_launch_guard(
      "/usr/local/bin/box-chrome https://example.com",
    ) {
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
    if s.tool_name == "browser_launch_guard" {
      if s.ok {
        allowed_span = true
      } else {
        refused_span = true
      }
      match s.artifact_path {
        Some(p) => assert_true(p.contains("bare_refusal.txt"))
        None => fail("guard span needs artifact_path")
      }
    }
  }
  assert_true(refused_span)
  assert_true(allowed_span)
  // Mock: same verdict, no audit span.
  let mock = @box_host.HostAbi::mock()
  match mock.guard_browser_launch("chrome") {
    Err(_) => ()
    Ok(_) => fail("Mock guard must refuse bare chrome")
  }
  assert_eq(mock.audit_span_count(), 0)
}
