///|
/// Remove a single entry by scope+key (CM-0305 helper).
pub fn InMemoryStore::forget_by_key(
  self : InMemoryStore,
  scope : MemoryScope,
  key : String,
) -> Bool {
  let mut i = 0
  while i < self.entries.length() {
    let e = self.entries[i]
    if e.scope == scope && e.key == key {
      let _ = self.entries.remove(i)
      return true
    }
    i = i + 1
  }
  false
}
