///|
/// CM-0301: session boundary; profile facts persist across sessions.
pub(all) struct SessionId {
  value : String
} derive(Eq, Debug)

///|
pub extend SessionId with Eq::{equal, not_equal}

///|
pub extend SessionId with Debug::{to_repr}

///|
/// Profile-scoped memory that survives session boundaries.
pub(all) struct ProfileMemoryStore {
  store : InMemoryStore
  mut current_session : SessionId?
}

///|
pub fn ProfileMemoryStore::new() -> ProfileMemoryStore {
  { store: InMemoryStore::new(), current_session: None, }
}

///|
/// Open a new session; profile entries are NOT cleared.
pub fn ProfileMemoryStore::open_session(
  self : ProfileMemoryStore,
  session : SessionId,
) -> Unit {
  self.current_session = Some(session)
}

///|
/// Update a profile fact (long-lived preference / identity).
pub fn ProfileMemoryStore::update_profile(
  self : ProfileMemoryStore,
  key~ : String,
  value~ : String,
) -> Unit {
  self.store.update({ scope: Profile, key, value, })
}

///|
/// Recall profile facts in the current session (may be a newer session).
pub fn ProfileMemoryStore::recall_profile(
  self : ProfileMemoryStore,
  key_prefix~ : String? = None,
  limit~ : Int32 = 32,
) -> Array[MemoryEntry] {
  self.store.recall({ scope: Profile, key_prefix, limit, })
}

///|
pub fn ProfileMemoryStore::session_id(self : ProfileMemoryStore) -> SessionId? {
  self.current_session
}
