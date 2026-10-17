///|
/// CM-0906: Gmail MCP-facing surface over connectors/mail (draft + search + read).
pub(all) struct GmailMcpSurface {
  service : MailService
  drafts : Array[DraftEmailCard]
}

///|
pub fn GmailMcpSurface::new() -> GmailMcpSurface {
  { service: MailService::new(), drafts: [], }
}

///|
/// MCP: create_draft — returns a DraftEmailCard (not sent).
pub fn GmailMcpSurface::create_draft(
  self : GmailMcpSurface,
  to_~ : String,
  subject~ : String,
  body~ : String,
) -> DraftEmailCard {
  let card = DraftEmailCard::new(to_~, subject~, body~)
  self.drafts.push(card)
  card
}

///|
/// MCP: search_threads.
pub fn GmailMcpSurface::search_threads(
  self : GmailMcpSurface,
  query~ : String,
) -> Array[MailThread] {
  self.service.search_threads(query~)
}

///|
/// MCP: get_thread / read thread.
pub fn GmailMcpSurface::read_thread(
  self : GmailMcpSurface,
  thread_id~ : String,
) -> Result[MailThread, String] {
  self.service.read_thread(thread_id~)
}

///|
/// Seed helper for acceptance fixtures.
pub fn GmailMcpSurface::seed_thread(
  self : GmailMcpSurface,
  id~ : String,
  subject~ : String,
  snippet~ : String,
) -> Unit {
  self.service.seed_thread(id~, subject~, snippet~)
}

///|
pub fn GmailMcpSurface::draft_count(self : GmailMcpSurface) -> Int32 {
  self.drafts.length()
}
