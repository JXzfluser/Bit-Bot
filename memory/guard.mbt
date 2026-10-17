///|
/// Irreversible-permission cue words that must never grant send/purchase from memory.
fn irreversible_permission_cues() -> Array[String] {
  [
    "send", "purchase", "buy", "approve", "authorized", "permission granted", "may send",
    "can send", "allow send", "外部发送", "购买",
  ]
}

///|
fn value_has_irreversible_cue(value : String) -> Bool {
  let lower = value.to_lower()
  for cue in irreversible_permission_cues() {
    if lower.contains(cue) || value.contains(cue) {
      return true
    }
  }
  false
}

///|
/// CM-0306: memory content must never authorize irreversible send/purchase.
/// Always returns false when the entry mentions permission-like cues, and in
/// practice always returns false — memory is never a send grant.
pub fn memory_grants_send(entry : MemoryEntry) -> Bool {
  let _ = value_has_irreversible_cue(entry.value)
  // Hard rule: memory never authorizes outbound send / purchase.
  false
}
