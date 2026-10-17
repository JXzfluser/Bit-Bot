///|
/// Logical memory partitions used by the agent runtime.
pub(all) enum MemoryScope {
  Profile
  Journal
  Shared
} derive(Eq, Debug)

///|
pub extend MemoryScope with Eq::{not_equal, equal}

///|
pub extend MemoryScope with Debug::{to_repr}

///|
pub fn MemoryScope::label(self : MemoryScope) -> String {
  match self {
    Profile => "profile"
    Journal => "journal"
    Shared => "shared"
  }
}

///|
pub(all) struct MemoryEntry {
  key : String
  value : String
  scope : MemoryScope
  updated_at_ms : Int64
} derive(Eq, Debug)

///|
pub extend MemoryEntry with Eq::{not_equal, equal}

///|
pub extend MemoryEntry with Debug::{to_repr}

///|
pub(all) struct RecallQuery {
  scope : MemoryScope
  key_prefix : String?
  limit : Int32
} derive(Eq, Debug)

///|
pub extend RecallQuery with Eq::{not_equal, equal}

///|
pub extend RecallQuery with Debug::{to_repr}

///|
pub(all) struct UpdateOp {
  scope : MemoryScope
  key : String
  value : String
} derive(Eq, Debug)

///|
pub extend UpdateOp with Eq::{not_equal, equal}

///|
pub extend UpdateOp with Debug::{to_repr}

///|
/// Backend-agnostic memory store. Implementations may be in-memory, file, or remote.
pub trait MemoryStore {
  fn recall(Self, query : RecallQuery) -> Array[MemoryEntry]
  fn update(Self, op : UpdateOp) -> Unit
  fn scopes(Self) -> Array[MemoryScope]
}

///|
/// Simple in-process store used to exercise the trait surface.
pub(all) struct InMemoryStore {
  entries : Array[MemoryEntry]
}

///|
pub fn InMemoryStore::new() -> InMemoryStore {
  { entries: [], }
}

///|
pub impl MemoryStore for InMemoryStore with fn recall(self, query) {
  let out : Array[MemoryEntry] = []
  for e in self.entries {
    if e.scope == query.scope {
      let prefix_ok = match query.key_prefix {
        None => true
        Some(p) => e.key.has_prefix(p)
      }
      if prefix_ok && out.length() < query.limit {
        out.push(e)
      }
    }
  }
  out
}

///|
pub impl MemoryStore for InMemoryStore with fn update(self, op) {
  let mut replaced = false
  let mut i = 0
  while i < self.entries.length() {
    let e = self.entries[i]
    if e.scope == op.scope && e.key == op.key {
      self.entries[i] = {
        key: op.key,
        value: op.value,
        scope: op.scope,
        updated_at_ms: e.updated_at_ms,
      }
      replaced = true
    }
    i = i + 1
  }
  if !replaced {
    self.entries.push({
      key: op.key,
      value: op.value,
      scope: op.scope,
      updated_at_ms: 0L,
    })
  }
}

///|
pub impl MemoryStore for InMemoryStore with fn scopes(_self) {
  [Profile, Journal, Shared]
}

///|
pub extend InMemoryStore with MemoryStore::{recall, update, scopes}

///|
/// CM-0305: parse/classify a scope label; unsupported labels are observable Err.
pub fn classify_scope(label : String) -> Result[MemoryScope, String] {
  let lower = label.to_lower()
  if lower == "profile" {
    Ok(Profile)
  } else if lower == "journal" {
    Ok(Journal)
  } else if lower == "shared" {
    Ok(Shared)
  } else {
    Err("unsupported memory scope classification: " + label)
  }
}
