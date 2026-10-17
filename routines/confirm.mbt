///|
/// CM-0415: user decision on a routine create/update confirm card.
pub(all) enum ConfirmCardDecision {
  Approve
  Deny
} derive(Eq, Debug)

///|
pub extend ConfirmCardDecision with Eq::{equal, not_equal}

///|
pub extend ConfirmCardDecision with Debug::{to_repr}

///|
/// Tool-facing result after a confirm-card gated write.
pub(all) struct RoutineWriteToolResult {
  ok : Bool
  message : String
  denied : Bool
  fingerprint : String
} derive(Eq, Debug)

///|
pub extend RoutineWriteToolResult with Eq::{equal, not_equal}

///|
pub extend RoutineWriteToolResult with Debug::{to_repr}

///|
/// Tracks denied write fingerprints so the same write is not rewrite-retried.
pub(all) struct ConfirmCardGate {
  denied_fingerprints : Array[String]
}

///|
pub fn ConfirmCardGate::new() -> ConfirmCardGate {
  { denied_fingerprints: [], }
}

///|
pub fn routine_write_fingerprint(spec : RoutineSpec) -> String {
  "create:" + spec.id + ":" + spec.name + ":" + spec.prompt
}

///|
fn ConfirmCardGate::was_denied(self : ConfirmCardGate, fp : String) -> Bool {
  for d in self.denied_fingerprints {
    if d == fp {
      return true
    }
  }
  false
}

///|
fn patch_fingerprint(id : String, patch : RoutinePatch) -> String {
  let prompt_part = match patch.prompt {
    Some(p) => p
    None => ""
  }
  "update:" + id + ":" + prompt_part
}

///|
/// CM-0415: create with confirm card; Deny → tool result reflects denial, no write;
/// a later attempt with the same fingerprint is refused (no rewrite-retry).
pub fn RoutineStore::create_with_confirm(
  self : RoutineStore,
  gate : ConfirmCardGate,
  spec : RoutineSpec,
  decision : ConfirmCardDecision,
) -> RoutineWriteToolResult {
  let fp = routine_write_fingerprint(spec)
  if gate.was_denied(fp) {
    return {
      ok: false,
      message: "refused: same write was denied; do not rewrite-retry",
      denied: true,
      fingerprint: fp,
    }
  }
  match decision {
    Deny => {
      gate.denied_fingerprints.push(fp)
      {
        ok: false,
        message: "user denied confirm card; routine not created",
        denied: true,
        fingerprint: fp,
      }
    }
    Approve =>
      match self.create(spec) {
        Ok(_) =>
          {
            ok: true,
            message: "routine created after confirm",
            denied: false,
            fingerprint: fp,
          }
        Err(e) => { ok: false, message: e, denied: false, fingerprint: fp, }
      }
  }
}

///|
/// CM-0415: update with confirm card; same deny → no retry policy.
pub fn RoutineStore::update_with_confirm(
  self : RoutineStore,
  gate : ConfirmCardGate,
  id : String,
  patch : RoutinePatch,
  decision : ConfirmCardDecision,
) -> RoutineWriteToolResult {
  let fp = patch_fingerprint(id, patch)
  if gate.was_denied(fp) {
    return {
      ok: false,
      message: "refused: same write was denied; do not rewrite-retry",
      denied: true,
      fingerprint: fp,
    }
  }
  match decision {
    Deny => {
      gate.denied_fingerprints.push(fp)
      {
        ok: false,
        message: "user denied confirm card; routine not updated",
        denied: true,
        fingerprint: fp,
      }
    }
    Approve =>
      match self.update(id, patch) {
        Ok(_) =>
          {
            ok: true,
            message: "routine updated after confirm",
            denied: false,
            fingerprint: fp,
          }
        Err(e) => { ok: false, message: e, denied: false, fingerprint: fp, }
      }
  }
}
