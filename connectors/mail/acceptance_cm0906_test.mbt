///|
/// CM-0906: Gmail MCP surface — draft + search + read thread acceptance.
test "acceptance_CM-0906_gmail_mcp_draft_search_read" {
  let gmail = @mail.GmailMcpSurface::new()
  gmail.seed_thread(id="th-mcp-1", subject="Invoice", snippet="please review")
  let hits = gmail.search_threads(query="Invoice")
  assert_eq(hits.length(), 1)
  assert_eq(hits[0].id, "th-mcp-1")
  match gmail.read_thread(thread_id="th-mcp-1") {
    Ok(th) => {
      assert_eq(th.subject, "Invoice")
      assert_eq(th.snippet, "please review")
    }
    Err(e) => fail(e)
  }
  let draft = gmail.create_draft(
    to_="boss@example.com",
    subject="Re: Invoice",
    body="Looking into it.",
  )
  assert_eq(draft.to_, "boss@example.com")
  assert_eq(draft.subject, "Re: Invoice")
  assert_false(draft.user_pressed_send)
  assert_eq(gmail.draft_count(), 1)
  // Draft must not auto-send.
  match draft.try_send() {
    Err(m) => assert_true(m.contains("Send") || m.contains("press"))
    Ok(_) => fail("draft must not send without press")
  }
}
