///|
/// CM-1007: mailbox create_draft — stays in Drafts; never sends.
/// Attachments via UploadFile when needed.
pub(all) struct MailboxDraft {
  id : String
  to_ : String
  subject : String
  body : String
  /// Attachment paths under /workspace (from UploadFile).
  attachment_paths : Array[String]
  mut sent : Bool
} derive(Eq, Debug)

///|
pub extend MailboxDraft with Eq::{equal, not_equal}

///|
pub extend MailboxDraft with Debug::{to_repr}

///|
pub(all) struct MailboxDraftStore {
  drafts : Array[MailboxDraft]
  mut next_id : Int32
  uploads : AttachmentStore
}

///|
pub fn MailboxDraftStore::new() -> MailboxDraftStore {
  { drafts: [], next_id: 1, uploads: AttachmentStore::new(), }
}

///|
/// create_draft in mailbox — no send.
pub fn MailboxDraftStore::create_draft(
  self : MailboxDraftStore,
  to_~ : String,
  subject~ : String,
  body~ : String,
) -> MailboxDraft {
  let n = self.next_id
  self.next_id = n + 1
  let d = {
    id: "draft-" + n.to_string(),
    to_,
    subject,
    body,
    attachment_paths: [],
    sent: false,
  }
  self.drafts.push(d)
  d
}

///|
pub fn MailboxDraftStore::draft_count(self : MailboxDraftStore) -> Int32 {
  self.drafts.length()
}

///|
pub fn MailboxDraftStore::find(
  self : MailboxDraftStore,
  id~ : String,
) -> Result[MailboxDraft, String] {
  for d in self.drafts {
    if d.id == id {
      return Ok(d)
    }
  }
  Err("draft not found: " + id)
}

///|
/// Attach via UploadFile path contract; draft still not sent.
pub fn MailboxDraftStore::attach_via_upload(
  self : MailboxDraftStore,
  draft_id~ : String,
  source_path~ : String,
  dest_path~ : String,
  size_bytes~ : Int32,
) -> Result[MailboxDraft, String] {
  match self.uploads.upload_file(source_path~, dest_path~, size_bytes~) {
    Err(e) => Err(e)
    Ok(bytes) =>
      match self.find(id=draft_id) {
        Err(e) => Err(e)
        Ok(d) => {
          if d.sent {
            return Err("cannot attach to already-sent draft")
          }
          d.attachment_paths.push(bytes.path)
          Ok(d)
        }
      }
  }
}

///|
/// Explicit send is separate — create_draft itself never sends.
pub fn MailboxDraftStore::try_send(
  self : MailboxDraftStore,
  draft_id~ : String,
  user_pressed_send~ : Bool,
) -> Result[String, String] {
  match self.find(id=draft_id) {
    Err(e) => Err(e)
    Ok(d) => {
      if !user_pressed_send {
        return Err("create_draft does not send; user must press Send")
      }
      if d.sent {
        return Err("draft already sent")
      }
      d.sent = true
      Ok("sent draft=" + d.id + " to=" + d.to_)
    }
  }
}

///|
pub fn MailboxDraft::is_unsent(self : MailboxDraft) -> Bool {
  !self.sent
}

///|
pub fn MailboxDraftStore::any_sent(self : MailboxDraftStore) -> Bool {
  for d in self.drafts {
    if d.sent {
      return true
    }
  }
  false
}
