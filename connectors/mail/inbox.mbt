///|
/// Assistant-owned inbox identity (CM-1001–1003).
pub(all) struct InboxId {
  local_part : String
  domain : String
} derive(Eq, Debug)

///|
pub extend InboxId with Eq::{equal, not_equal}

///|
pub extend InboxId with Debug::{to_repr}

///|
pub fn InboxId::address(self : InboxId) -> String {
  self.local_part + "@" + self.domain
}

///|
pub(all) struct MailService {
  mut claimed : InboxId?
  available_locals : Array[String]
  domain : String
  threads : Array[MailThread]
}

///|
/// CM-1004: attachment; openable when path is valid under /workspace.
pub(all) struct EmailAttachment {
  name : String
  path : String
  openable : Bool
} derive(Eq, Debug)

///|
pub extend EmailAttachment with Eq::{equal, not_equal}

///|
pub extend EmailAttachment with Debug::{to_repr}

///|
pub fn EmailAttachment::make(name~ : String, path~ : String) -> EmailAttachment {
  {
    name,
    path,
    openable: path.has_prefix("/workspace/") || path == "/workspace",
  }
}

///|
pub(all) struct MailThread {
  id : String
  subject : String
  snippet : String
  attachments : Array[EmailAttachment]
} derive(Eq, Debug)

///|
pub extend MailThread with Eq::{equal, not_equal}

///|
pub extend MailThread with Debug::{to_repr}

///|
pub fn MailService::new(domain~ : String = "bot.example") -> MailService {
  {
    claimed: None,
    available_locals: ["alpha", "bravo", "charlie"],
    domain,
    threads: [],
  }
}

///|
/// CM-1001: list inboxes; empty → guide claim; claimed → do not double-claim.
pub fn MailService::list_inboxes(self : MailService) -> Array[InboxId] {
  match self.claimed {
    Some(id) => [id]
    None => []
  }
}

///|
/// CM-1002: availability without claiming.
pub fn MailService::check_availability(self : MailService) -> Array[String] {
  self.available_locals
}

///|
/// CM-1003: claim only with user-selected local part (no random).
pub fn MailService::claim_inbox(
  self : MailService,
  local_part~ : String,
  user_confirmed~ : Bool,
) -> Result[InboxId, String] {
  if !user_confirmed {
    return Err("claim requires user confirmation card")
  }
  if local_part.length() == 0 {
    return Err("local part must not be empty")
  }
  if local_part == "random" || local_part.has_prefix("rnd-") {
    return Err("random inbox names are forbidden")
  }
  match self.claimed {
    Some(_) => Err("inbox already claimed; do not double-claim")
    None => {
      let mut ok = false
      for a in self.available_locals {
        if a == local_part {
          ok = true
          break
        }
      }
      if !ok {
        return Err("local part not in availability list")
      }
      let id = { local_part, domain: self.domain, }
      self.claimed = Some(id)
      Ok(id)
    }
  }
}

///|
/// CM-1004: search threads (ids from this service only).
pub fn MailService::search_threads(
  self : MailService,
  query~ : String,
) -> Array[MailThread] {
  let _ = query
  let out : Array[MailThread] = []
  for t in self.threads {
    out.push(t)
  }
  out
}

///|
pub fn MailService::seed_thread(
  self : MailService,
  id~ : String,
  subject~ : String,
  snippet~ : String,
  attachments~ : Array[EmailAttachment] = [],
) -> Unit {
  let atts : Array[EmailAttachment] = []
  for a in attachments {
    atts.push(EmailAttachment::make(name=a.name, path=a.path))
  }
  self.threads.push({ id, subject, snippet, attachments: atts, })
}

///|
/// CM-1004: open attachment from a thread (path must be openable).
pub fn MailService::open_attachment(
  self : MailService,
  thread_id~ : String,
  name~ : String,
) -> Result[EmailAttachment, String] {
  match self.read_thread(thread_id~) {
    Err(e) => Err(e)
    Ok(th) => {
      for a in th.attachments {
        if a.name == name {
          if !a.openable {
            return Err("attachment not openable: " + name)
          }
          if a.path.length() == 0 {
            return Err("attachment path empty")
          }
          return Ok(a)
        }
      }
      Err("attachment not found: " + name)
    }
  }
}

///|
pub fn MailService::read_thread(
  self : MailService,
  thread_id~ : String,
) -> Result[MailThread, String] {
  for t in self.threads {
    if t.id == thread_id {
      let atts : Array[EmailAttachment] = []
      for a in t.attachments {
        atts.push(EmailAttachment::make(name=a.name, path=a.path))
      }
      return Ok({
        id: t.id,
        subject: t.subject,
        snippet: t.snippet,
        attachments: atts,
      })
    }
  }
  Err("unknown thread_id: " + thread_id)
}
