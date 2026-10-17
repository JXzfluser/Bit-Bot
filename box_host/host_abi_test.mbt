///|
/// CM-0601: Shell on box (machine_id=None) vs user_machine tag.
test "acceptance_cm0601_shell_box_and_machine" {
  let host = @box_host.HostAbi::mock()
  let r1 = host.shell(@box_host.ShellRequest::on_box("echo hi"))
  assert_eq(r1.target, @box_host.Box)
  assert_true(r1.stdout.contains("box"))
  assert_true(r1.stdout.contains("/workspace"))
  assert_true(r1.completed)
  let r2 = host.shell(@box_host.ShellRequest::{
    command: "ls",
    working_directory: Some("/tmp"),
    block_until_ms: 1000,
    machine_id: Some("desk-1"),
  })
  assert_eq(r2.target, @box_host.UserMachine(machine_id="desk-1"))
  assert_true(r2.stdout.contains("user_machine"))
}

///|
/// CM-0602: Read line-numbered; missing rejected; offset/limit.
test "acceptance_cm0602_read_line_numbered" {
  let host = @box_host.HostAbi::mock()
  host.write("/workspace/a.txt", "alpha\nbeta\ngamma\ndelta")
  match host.read("/workspace/a.txt") {
    Ok(r) => {
      assert_true(r.text.contains("1|alpha"))
      assert_true(r.text.contains("2|beta"))
      assert_eq(r.line_count, 4)
    }
    Err(e) => fail(e)
  }
  match host.read("/workspace/a.txt", offset=Some(2), limit=Some(2)) {
    Ok(r) => {
      assert_true(r.text.contains("2|beta"))
      assert_true(r.text.contains("3|gamma"))
      assert_false(r.text.contains("1|alpha"))
      assert_eq(r.line_count, 2)
    }
    Err(e) => fail(e)
  }
  match host.read("/workspace/missing.txt") {
    Err(_) => ()
    Ok(_) => fail("missing path must reject")
  }
}

///|
/// CM-0603: write persists across later reads (same HostAbi / "turn").
test "acceptance_cm0603_fs_persists" {
  let host = @box_host.HostAbi::mock()
  host.write("/workspace/persist.txt", "keep-me")
  // Simulate later turn on same host instance.
  match host.read("/workspace/persist.txt") {
    Ok(r) => assert_true(r.text.contains("1|keep-me"))
    Err(e) => fail(e)
  }
}

///|
/// CM-0604: await observes job; fire-and-forget never killed.
test "acceptance_cm0604_await_no_kill_fire_and_forget" {
  let host = @box_host.HostAbi::mock()
  let bg = host.shell(@box_host.ShellRequest::{
    command: "sleep 999",
    working_directory: None,
    block_until_ms: 0,
    machine_id: None,
  })
  assert_false(bg.completed)
  match host.await_shell(bg.job_id, pattern=Some("sleep"), block_until_ms=100) {
    Ok(a) => {
      assert_true(a.matched)
      assert_true(a.completed)
      assert_false(a.killed)
    }
    Err(e) => fail(e)
  }
}

///|
/// CM-0605: screenshot read_only under /workspace; does not click.
test "acceptance_cm0605_screenshot_read_only" {
  let host = @box_host.HostAbi::mock()
  let shot = host.screenshot("executor")
  assert_true(shot.path.has_prefix("/workspace"))
  assert_true(shot.read_only)
  assert_false(shot.clicked)
  match host.read(shot.path) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
}

///|
/// CM-0606: shared FS; distinct desktops per agent.
test "acceptance_cm0606_shared_fs_distinct_desktops" {
  let host = @box_host.HostAbi::mock()
  let fs1 = host.fs_shared()
  let fs2 = host.fs_shared()
  assert_eq(fs1, fs2)
  host.write("/workspace/shared.txt", "visible")
  let d1 = host.desktop_for("agent-a")
  let d2 = host.desktop_for("agent-b")
  assert_true(d1.display != d2.display)
  assert_eq(d1.agent_id, "agent-a")
  assert_eq(d2.agent_id, "agent-b")
  // Same agent returns same session.
  let d1b = host.desktop_for("agent-a")
  assert_eq(d1b.display, d1.display)
  match host.read("/workspace/shared.txt") {
    Ok(r) => assert_true(r.text.contains("visible"))
    Err(e) => fail(e)
  }
}

///|
/// CM-0602: image Read returns ImageContent mime+visible+byte_len (inline可见).
test "acceptance_CM-0602_image_read_inline_visible" {
  let host = @box_host.HostAbi::mock()
  host.write("/workspace/shot.png", "PNG-MOCK-PIXELS")
  match host.read_image("/workspace/shot.png") {
    Ok(img) => {
      assert_eq(img.mime, "image/png")
      assert_true(img.visible)
      assert_true(img.byte_len > 0)
      assert_eq(img.path, "/workspace/shot.png")
    }
    Err(e) => fail(e)
  }
  match host.read_image("/workspace/missing.png") {
    Err(_) => ()
    Ok(_) => fail("missing image must err")
  }
  match host.read_image("/workspace/a.txt") {
    Err(_) => ()
    Ok(_) => fail("non-image must err")
  }
}

///|
/// CM-0605: Screenshot returns 画面 evidence (PNG magic under /workspace);
/// read_only, not clicked. Host real screen = integration layer (see host_abi comment).
test "acceptance_CM-0605_screenshot_frame_evidence" {
  let host = @box_host.HostAbi::mock()
  let shot = host.screenshot("executor")
  assert_true(shot.path.has_prefix("/workspace"))
  assert_true(shot.path.has_suffix(".png"))
  assert_true(shot.read_only)
  assert_false(shot.clicked)
  assert_true(shot.has_frame)
  assert_true(shot.frame_bytes_len > 0)
  match host.read_image(shot.path) {
    Ok(img) => {
      assert_true(img.visible)
      assert_eq(img.mime, "image/png")
      assert_true(img.byte_len > 0)
    }
    Err(e) => fail(e)
  }
}
