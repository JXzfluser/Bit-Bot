///|
/// CM-0302: journal layer — query by date range; does not pollute profile.

///|
/// One journal event keyed by ISO date (YYYY-MM-DD) plus event id.
pub(all) struct JournalEvent {
  date : String
  event_id : String
  body : String
  at_ms : Int64
} derive(Eq, Debug)

///|
pub extend JournalEvent with Eq::{equal, not_equal}

///|
pub extend JournalEvent with Debug::{to_repr}

///|
/// Journal store layered on MemoryScope::Journal; profile stays separate.
pub(all) struct JournalStore {
  events : Array[JournalEvent]
  backing : InMemoryStore
}

///|
pub fn JournalStore::new() -> JournalStore {
  { events: [], backing: InMemoryStore::new(), }
}

///|
/// Append a journal event (does not write profile).
pub fn JournalStore::append(
  self : JournalStore,
  date~ : String,
  event_id~ : String,
  body~ : String,
  at_ms~ : Int64 = 0L,
) -> Unit {
  self.events.push({ date, event_id, body, at_ms, })
  self.backing.update({
    scope: Journal,
    key: date + "/" + event_id,
    value: body,
  })
}

///|
/// Lexicographic ISO date compare: a <= b (YYYY-MM-DD chronological).
fn date_leq(a : String, b : String) -> Bool {
  let n = if a.length() < b.length() { a.length() } else { b.length() }
  let mut i = 0
  while i < n {
    let ca = a[i]
    let cb = b[i]
    if ca < cb {
      return true
    }
    if ca > cb {
      return false
    }
    i = i + 1
  }
  a.length() <= b.length()
}

///|
/// CM-0302: query journal events in an inclusive date range [from_date, to_date].
pub fn JournalStore::query_range(
  self : JournalStore,
  from_date~ : String,
  to_date~ : String,
) -> Array[JournalEvent] {
  let out : Array[JournalEvent] = []
  for e in self.events {
    if date_leq(from_date, e.date) && date_leq(e.date, to_date) {
      out.push(e)
    }
  }
  out
}

///|
/// Profile keys currently stored (should stay empty unless explicitly updated).
pub fn JournalStore::profile_keys(self : JournalStore) -> Array[String] {
  let hits = self.backing.recall({
    scope: Profile,
    key_prefix: None,
    limit: 256,
  })
  let keys : Array[String] = []
  for h in hits {
    keys.push(h.key)
  }
  keys
}

///|
/// Explicit profile update (for pollution-negative tests).
pub fn JournalStore::update_profile(
  self : JournalStore,
  key~ : String,
  value~ : String,
) -> Unit {
  self.backing.update({ scope: Profile, key, value, })
}

///|
/// CM-0302: true when any Profile-scope entry exists (journal must not set this).
pub fn JournalStore::journal_pollutes_profile(self : JournalStore) -> Bool {
  self.profile_keys().length() > 0
}
