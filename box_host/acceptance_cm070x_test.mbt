///|
/// CM-0701: ListMachines returns full registered set (id/label/kind/status).
test "acceptance_CM-0701_list_machines_full_set" {
  let reg = @box_host.MachineRegistry::seed()
  let all = reg.list()
  assert_true(all.length() >= 3)
  let mut saw_desk = false
  let mut saw_ios = false
  let mut saw_android = false
  for m in all {
    assert_true(m.id.length() > 0)
    assert_true(m.label.length() > 0)
    match m.kind {
      @box_host.Desktop => {
        saw_desk = true
        assert_eq(m.kind.name(), "desktop")
      }
      @box_host.Ios => {
        saw_ios = true
        assert_eq(m.kind.name(), "ios")
      }
      @box_host.Android => {
        saw_android = true
        assert_eq(m.kind.name(), "android")
      }
    }
    // status is always Connected or Disconnected (named).
    assert_true(
      m.status.name() == "connected" || m.status.name() == "disconnected",
    )
  }
  assert_true(saw_desk)
  assert_true(saw_ios)
  assert_true(saw_android)
}

///|
/// CM-0702: machineId Shell/Read — without approval → not executed; with → success.
test "acceptance_CM-0702_machine_id_requires_approval" {
  let reg = @box_host.MachineRegistry::seed()
  reg.put_machine_file("desk-1", "/home/u/a.txt", "hello-machine")

  // Shell without approval: Err + not executed.
  match reg.run_on_machine("desk-1", "echo hi", approved=false) {
    Err(msg) => {
      assert_true(msg.contains("approval required"))
      assert_false(reg.was_executed("desk-1"))
    }
    Ok(_) => fail("unapproved shell must not execute")
  }

  // Read without approval: Err + not executed.
  match reg.read_on_machine("desk-1", "/home/u/a.txt", approved=false) {
    Err(msg) => assert_true(msg.contains("approval required"))
    Ok(_) => fail("unapproved read must not execute")
  }

  // Shell with approval: success + effect recorded.
  match reg.run_on_machine("desk-1", "echo hi", approved=true) {
    Ok(out) => {
      assert_true(out.contains("desk-1"))
      assert_true(out.contains("echo hi"))
      assert_true(reg.was_executed("desk-1"))
    }
    Err(e) => fail(e)
  }

  // Read with approval: success.
  match reg.read_on_machine("desk-1", "/home/u/a.txt", approved=true) {
    Ok(content) => assert_eq(content, "hello-machine")
    Err(e) => fail(e)
  }
}

///|
/// CM-0703: CopyToBox — binary intact; default dest `/workspace/uploads/<name>`.
test "acceptance_CM-0703_copy_to_box_binary_uploads" {
  let reg = @box_host.MachineRegistry::seed()
  // Binary-ish payload: NUL + high bytes + PNG magic fragment.
  let sb = StringBuilder()
  sb.write_char('\u{00}')
  sb.write_char('\u{01}')
  sb.write_char('\u{FF}')
  sb.write_char('\u{89}')
  sb.write_string("PNG")
  sb.write_string("BIN-PAYLOAD-42")
  let payload = sb.to_string()
  reg.put_machine_file("desk-1", "/Users/me/photo.bin", payload)

  match reg.copy_to_box("desk-1", "/Users/me/photo.bin") {
    Ok(dest) => {
      assert_eq(dest, "/workspace/uploads/photo.bin")
      assert_true(dest.has_prefix("/workspace/uploads"))
      match reg.get_box_bytes(dest) {
        Some(got) => {
          assert_eq(got.length(), payload.length())
          assert_eq(got, payload)
        }
        None => fail("copied bytes missing on box")
      }
    }
    Err(e) => fail(e)
  }

  // Explicit dest still preserves bytes.
  match
    reg.copy_to_box(
      "desk-1",
      "/Users/me/photo.bin",
      dest_path=Some("/workspace/custom/x.bin"),
    ) {
    Ok(dest) => {
      assert_eq(dest, "/workspace/custom/x.bin")
      match reg.get_box_bytes(dest) {
        Some(got) => assert_eq(got, payload)
        None => fail("explicit dest missing")
      }
    }
    Err(e) => fail(e)
  }
}

///|
/// CM-0704: CopyFromBox — correct dest path; overwrite Allow|Refuse documented.
test "acceptance_CM-0704_copy_from_box_path_and_overwrite" {
  let reg = @box_host.MachineRegistry::seed()
  let payload = "box-bytes-v1"
  reg.put_box_file("/workspace/out/report.txt", payload)

  // Fresh dest: lands at exact dest_path.
  match
    reg.copy_from_box(
      "desk-1",
      "/workspace/out/report.txt",
      "/Users/me/Downloads/report.txt",
      overwrite=@box_host.Refuse,
    ) {
    Ok(dest) => {
      assert_eq(dest, "/Users/me/Downloads/report.txt")
      match reg.get_machine_bytes("desk-1", dest) {
        Some(got) => assert_eq(got, payload)
        None => fail("dest missing after copy")
      }
    }
    Err(e) => fail(e)
  }

  // Refuse: existing dest → Err, content unchanged.
  reg.put_machine_file("desk-1", "/Users/me/Downloads/report.txt", "OLD")
  match
    reg.copy_from_box(
      "desk-1",
      "/workspace/out/report.txt",
      "/Users/me/Downloads/report.txt",
      overwrite=@box_host.Refuse,
    ) {
    Err(msg) => {
      assert_true(msg.contains("Refuse") || msg.contains("exists"))
      match reg.get_machine_bytes("desk-1", "/Users/me/Downloads/report.txt") {
        Some(got) => assert_eq(got, "OLD")
        None => fail("should still hold OLD")
      }
    }
    Ok(_) => fail("Refuse must reject existing dest")
  }

  // Allow: overwrite succeeds with new bytes.
  match
    reg.copy_from_box(
      "desk-1",
      "/workspace/out/report.txt",
      "/Users/me/Downloads/report.txt",
      overwrite=@box_host.Allow,
    ) {
    Ok(_) =>
      match reg.get_machine_bytes("desk-1", "/Users/me/Downloads/report.txt") {
        Some(got) => assert_eq(got, payload)
        None => fail("Allow overwrite missing")
      }
    Err(e) => fail(e)
  }
}
