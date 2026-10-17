///|
/// CM-1604: ReadEmailAttachment / UploadFile — large file not truncated; path contract.
test "acceptance_CM-1604_email_attachment_upload_path_contract" {
  let store = @mail.AttachmentStore::new()
  let large = 1024 * 1024 * 5 // 5 MiB — must not truncate
  match
    store.read_email_attachment(
      attachment_id="att-large.bin",
      path="/workspace/mail/att-large.bin",
      size_bytes=large,
    ) {
    Ok(bytes) => {
      assert_eq(bytes.size_bytes, large)
      assert_eq(bytes.content_len, large)
      assert_false(bytes.was_truncated())
      assert_true(bytes.path.has_prefix("/workspace/"))
    }
    Err(e) => fail(e)
  }
  match
    store.read_email_attachment(
      attachment_id="bad",
      path="/tmp/outside.bin",
      size_bytes=10,
    ) {
    Err(m) => assert_true(m.contains("/workspace"))
    Ok(_) => fail("path outside /workspace must Err")
  }
  match
    store.upload_file(
      source_path="/tmp/src.pdf",
      dest_path="/workspace/uploads/report.pdf",
      size_bytes=large,
    ) {
    Ok(up) => {
      assert_eq(up.path, "/workspace/uploads/report.pdf")
      assert_eq(up.size_bytes, large)
      assert_eq(up.content_len, large)
      assert_false(up.was_truncated())
    }
    Err(e) => fail(e)
  }
  match
    store.upload_file(
      source_path="/tmp/src.pdf",
      dest_path="/var/bad/out.pdf",
      size_bytes=100,
    ) {
    Err(m) => assert_true(m.contains("/workspace"))
    Ok(_) => fail("UploadFile outside /workspace must Err")
  }
}
