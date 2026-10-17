///|
/// CM-0202: UpdateAvatar — avatar file previewable; invalid path rejected.
test "acceptance_CM-0202_update_avatar_preview_reject_invalid" {
  let fs = @ui_protocol.MockFS::new([
    "/workspace/fixtures/avatars/bit.png", "/home/box/agent-data/avatars/nova.jpg",
  ])

  match
    @ui_protocol.update_avatar(
      agent_id="agent-bit",
      path="/workspace/fixtures/avatars/bit.png",
      fs~,
    ) {
    Ok(preview) => {
      assert_true(preview.is_previewable())
      assert_eq(preview.agent_id, "agent-bit")
      assert_eq(preview.path, "/workspace/fixtures/avatars/bit.png")
      assert_eq(preview.mime, "image/png")
      assert_true(preview.previewable)
    }
    Err(e) => fail(e)
  }

  match
    @ui_protocol.update_avatar(
      agent_id="agent-nova",
      path="/home/box/agent-data/avatars/nova.jpg",
      fs~,
    ) {
    Ok(p) => {
      assert_true(p.previewable)
      assert_eq(p.mime, "image/jpeg")
    }
    Err(e) => fail(e)
  }

  // Invalid: scheme
  match
    @ui_protocol.update_avatar(
      agent_id="a",
      path="https://cdn.example.com/avatar.png",
      fs~,
    ) {
    Err(msg) => assert_true(msg.contains("invalid avatar path"))
    Ok(_) => fail("scheme path must be rejected")
  }

  // Invalid: extension
  match
    @ui_protocol.update_avatar(
      agent_id="a",
      path="/workspace/fixtures/avatars/notes.txt",
      fs~,
    ) {
    Err(msg) => assert_true(msg.contains("image") || msg.contains("invalid"))
    Ok(_) => fail("non-image must be rejected")
  }

  // Invalid: missing file (shape ok)
  match
    @ui_protocol.update_avatar(
      agent_id="a",
      path="/workspace/fixtures/avatars/missing.png",
      fs~,
    ) {
    Err(msg) => assert_true(msg.contains("exist") || msg.contains("invalid"))
    Ok(_) => fail("missing file must be rejected")
  }

  // Invalid: empty / parent
  assert_true(@ui_protocol.validate_avatar_path("") is Err(_))
  assert_true(
    @ui_protocol.validate_avatar_path("/workspace/../etc/passwd.png") is Err(_),
  )
}
