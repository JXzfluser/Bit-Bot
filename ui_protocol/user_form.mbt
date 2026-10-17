///|
/// CM-0804: form field target bound to a DOM/page snapshot id.
pub(all) struct FormFieldTarget {
  field_id : String
  snapshot_node_id : String
  label : String
} derive(Eq, Debug)

///|
pub extend FormFieldTarget with Eq::{equal, not_equal}

///|
pub extend FormFieldTarget with Debug::{to_repr}

///|
/// CM-0804: RequestUserForm targets come from a page snapshot (not guessed).
pub(all) struct UserFormSnapshot {
  form_id : String
  page_url : String
  snapshot_rev : String
  targets : Array[FormFieldTarget]
} derive(Eq, Debug)

///|
pub extend UserFormSnapshot with Eq::{equal, not_equal}

///|
pub extend UserFormSnapshot with Debug::{to_repr}

///|
pub fn UserFormSnapshot::fingerprint(self : UserFormSnapshot) -> String {
  self.form_id + "@" + self.snapshot_rev + "@" + self.page_url
}

///|
pub(all) enum FormSubmitOutcome {
  Submitted
  Failed(reason~ : String)
} derive(Eq, Debug)

///|
pub extend FormSubmitOutcome with Eq::{equal, not_equal}

///|
pub extend FormSubmitOutcome with Debug::{to_repr}

///|
/// Tracks failed form attempt fingerprints so the same form is not blind-retried.
pub(all) struct UserFormGate {
  failed_fingerprints : Array[String]
}

///|
pub fn UserFormGate::new() -> UserFormGate {
  { failed_fingerprints: [], }
}

///|
fn UserFormGate::was_failed(self : UserFormGate, fp : String) -> Bool {
  for d in self.failed_fingerprints {
    if d == fp {
      return true
    }
  }
  false
}

///|
/// CM-0804: submit must use snapshot targets; failed submit → no blind same-form retry.
pub fn UserFormGate::submit(
  self : UserFormGate,
  snapshot : UserFormSnapshot,
  outcome : FormSubmitOutcome,
) -> Result[Unit, String] {
  if snapshot.targets.length() == 0 {
    return Err("RequestUserForm requires targets from snapshot")
  }
  let fp = snapshot.fingerprint()
  if self.was_failed(fp) {
    return Err(
      "refused: same form snapshot failed; do not blind-retry same form",
    )
  }
  match outcome {
    Submitted => Ok(())
    Failed(reason~) => {
      self.failed_fingerprints.push(fp)
      Err("form submit failed: " + reason)
    }
  }
}

///|
/// Build RequestUserForm targets strictly from a snapshot (acceptance helper).
pub fn request_user_form_from_snapshot(
  snapshot : UserFormSnapshot,
) -> Result[Array[FormFieldTarget], String] {
  if snapshot.targets.length() == 0 {
    Err("no targets in snapshot")
  } else {
    let out : Array[FormFieldTarget] = []
    for t in snapshot.targets {
      out.push(t)
    }
    Ok(out)
  }
}
