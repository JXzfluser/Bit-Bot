///|
/// CM-0303: shared memory — correct scope isolation; no cross-scope read.

///|
/// Logical shared-memory tenant / group scope id.
pub(all) struct SharedScopeId {
  value : String
} derive(Eq, Debug)

///|
pub extend SharedScopeId with Eq::{equal, not_equal}

///|
pub extend SharedScopeId with Debug::{to_repr}

///|
pub fn SharedScopeId::new(value : String) -> SharedScopeId {
  { value, }
}

///|
pub(all) struct SharedMemoryEntry {
  scope : SharedScopeId
  key : String
  value : String
} derive(Eq, Debug)

///|
pub extend SharedMemoryEntry with Eq::{equal, not_equal}

///|
pub extend SharedMemoryEntry with Debug::{to_repr}

///|
/// Multi-scope shared memory with hard isolation.
pub(all) struct SharedMemoryStore {
  entries : Array[SharedMemoryEntry]
}

///|
pub fn SharedMemoryStore::new() -> SharedMemoryStore {
  { entries: [], }
}

///|
pub fn SharedMemoryStore::put(
  self : SharedMemoryStore,
  scope~ : SharedScopeId,
  key~ : String,
  value~ : String,
) -> Unit {
  let mut i = 0
  while i < self.entries.length() {
    let e = self.entries[i]
    if e.scope == scope && e.key == key {
      self.entries[i] = { scope, key, value, }
      return
    }
    i = i + 1
  }
  self.entries.push({ scope, key, value, })
}

///|
/// Read only within the given shared scope (CM-0303 isolation).
pub fn SharedMemoryStore::read(
  self : SharedMemoryStore,
  scope~ : SharedScopeId,
  key~ : String,
) -> Result[String, String] {
  for e in self.entries {
    if e.scope == scope && e.key == key {
      return Ok(e.value)
    }
  }
  Err("key not found in scope " + scope.value + ": " + key)
}

///|
/// List keys visible inside one scope only.
pub fn SharedMemoryStore::keys_in_scope(
  self : SharedMemoryStore,
  scope~ : SharedScopeId,
) -> Array[String] {
  let out : Array[String] = []
  for e in self.entries {
    if e.scope == scope {
      out.push(e.key)
    }
  }
  out
}

///|
/// CM-0303: read from a scope that does not own the key → Err (no leak).
pub fn SharedMemoryStore::cross_scope_read(
  self : SharedMemoryStore,
  from_scope~ : SharedScopeId,
  key~ : String,
) -> Result[String, String] {
  match self.read(scope=from_scope, key~) {
    Ok(v) => Ok(v)
    Err(_) =>
      Err(
        "cross-scope read denied: key '" +
        key +
        "' not visible in scope " +
        from_scope.value,
      )
  }
}

///|
/// True when each scope only sees its own keys.
pub fn SharedMemoryStore::scopes_isolated(
  self : SharedMemoryStore,
  scope_a~ : SharedScopeId,
  scope_b~ : SharedScopeId,
) -> Bool {
  for e in self.entries {
    if e.scope == scope_a {
      match self.read(scope=scope_b, key=e.key) {
        Ok(vb) =>
          // Same key name in B is a different slot; isolation requires
          // that reading B never returns A's value unless B also put it.
          match self.read(scope=scope_a, key=e.key) {
            Ok(va) =>
              if va == vb {
                // Distinct puts could coincide; check ownership via keys_in_scope.
                let in_b = self.keys_in_scope(scope=scope_b)
                let mut owned_by_b = false
                for k in in_b {
                  if k == e.key {
                    owned_by_b = true
                  }
                }
                if !owned_by_b {
                  return false
                }
              }
            Err(_) => return false
          }
        Err(_) => ()
      }
    }
  }
  true
}
