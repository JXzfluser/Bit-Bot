///|
/// CM-1007: mailbox create_draft — no send; attachments via UploadFile when needed.
test "acceptance_CM-1007_mailbox_create_draft_no_send" {
  let box = @mail.MailboxDraftStore::new()
  let d = box.create_draft(
    to_="user@example.com",
    subject="Stay in Drafts",
    body="do not send yet",
  )
  assert_eq(box.draft_count(), 1)
  assert_true(d.is_unsent())
  assert_false(box.any_sent())
  match box.try_send(draft_id=d.id, user_pressed_send=false) {
    Err(m) =>
      assert_true(m.contains("does not send") || m.contains("press Send"))
    Ok(_) => fail("create_draft must not send")
  }
  assert_false(box.any_sent())
  match
    box.attach_via_upload(
      draft_id=d.id,
      source_path="/workspace/uploads/report.pdf",
      dest_path="/workspace/uploads/report.pdf",
      size_bytes=4096,
    ) {
    Ok(updated) => {
      assert_eq(updated.attachment_paths.length(), 1)
      assert_true(updated.attachment_paths[0].has_prefix("/workspace/"))
      assert_true(updated.is_unsent())
    }
    Err(e) => fail(e)
  }
  match
    box.attach_via_upload(
      draft_id=d.id,
      source_path="/tmp/x",
      dest_path="/tmp/outside",
      size_bytes=10,
    ) {
    Err(m) => assert_true(m.contains("/workspace") || m.contains("UploadFile"))
    Ok(_) => fail("UploadFile outside /workspace must Err")
  }
  // Still unsent after attach; only explicit user send succeeds.
  assert_false(box.any_sent())
  match box.try_send(draft_id=d.id, user_pressed_send=true) {
    Ok(s) => {
      assert_true(s.contains("sent"))
      assert_true(s.contains(d.id))
    }
    Err(e) => fail(e)
  }
  assert_true(box.any_sent())
}
