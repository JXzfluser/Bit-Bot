///|
/// CM-1004: Search/Read thread attachments openable when path under /workspace.
test "acceptance_CM-1004_thread_attachment_openable" {
  let svc = @mail.MailService::new()
  svc.seed_thread(id="th-att", subject="Report", snippet="see attached", attachments=[
    @mail.EmailAttachment::make(
      name="report.pdf",
      path="/workspace/mail/th-att/report.pdf",
    ),
    @mail.EmailAttachment::make(name="secret.bin", path="/tmp/secret.bin"),
  ])
  let hits = svc.search_threads(query="Report")
  assert_eq(hits.length(), 1)
  assert_eq(hits[0].id, "th-att")
  match svc.read_thread(thread_id=hits[0].id) {
    Ok(th) => {
      assert_eq(th.attachments.length(), 2)
      assert_eq(th.attachments[0].path, "/workspace/mail/th-att/report.pdf")
      assert_true(th.attachments[0].openable)
      assert_false(th.attachments[1].openable)
    }
    Err(e) => fail(e)
  }
  match svc.open_attachment(thread_id="th-att", name="report.pdf") {
    Ok(a) => {
      assert_true(a.openable)
      assert_true(a.path.has_prefix("/workspace/"))
    }
    Err(e) => fail(e)
  }
  match svc.open_attachment(thread_id="th-att", name="secret.bin") {
    Err(m) => assert_true(m.contains("openable"))
    Ok(_) => fail("non-openable must Err")
  }
}
