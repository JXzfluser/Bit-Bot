///|
/// J-batch P0: CM-2137 — inbound user attachment → AttachmentRef readable.

///|
test "acceptance_CM-2137_inbound_attachment_ref_readable" {
  let path = "/workspace/uploads/user-photo.png"
  let fs = @ui_protocol.MockFS::new([path])
  match
    @ui_protocol.collect_inbound_attachments(fs, [
      ("user-photo.png", "image/png", path),
    ]) {
    Err(e) => fail(e)
    Ok(bag) => {
      assert_eq(bag.refs.length(), 1)
      assert_true(bag.all_readable(fs))
      match bag.first_ref() {
        None => fail("expected AttachmentRef")
        Some(r) => {
          assert_eq(r.name, "user-photo.png")
          assert_eq(r.mime, "image/png")
          assert_eq(r.path, path)
          assert_true(r.validate() is Ok(_))
        }
      }
    }
  }
  // Missing file is not readable.
  let fs2 = @ui_protocol.MockFS::new([])
  match
    @ui_protocol.collect_inbound_attachments(fs2, [
      ("missing.png", "image/png", "/workspace/uploads/missing.png"),
    ]) {
    Err(m) => assert_true(m.contains("hallucinated") || m.contains("exist"))
    Ok(_) => fail("missing inbound path must fail")
  }
}
