///|
/// H0 probe skeleton (CM-0607 / CM-0608 / CM-2175).
/// Kernel-facing: schedules/records intents against Mock or Live.
/// Does NOT claim host-integration I-PASS — Bit验证 promotes from Host smoke artifacts.

///|
pub(all) enum H0Intent {
  Cm0607BoxDoctor
  Cm0608EnvDetect
  Cm2175BoxClock
} derive(Eq, Debug)

///|
pub extend H0Intent with Eq::{equal, not_equal}

///|
pub extend H0Intent with Debug::{to_repr}

///|
pub fn H0Intent::cm_id(self : H0Intent) -> String {
  match self {
    Cm0607BoxDoctor => "CM-0607"
    Cm0608EnvDetect => "CM-0608"
    Cm2175BoxClock => "CM-2175"
  }
}

///|
pub fn H0Intent::artifact_subdir(self : H0Intent) -> String {
  match self {
    Cm0607BoxDoctor => "cm-0607-box-doctor"
    Cm0608EnvDetect => "cm-0608-env-detect"
    Cm2175BoxClock => "cm-2175-box-clock"
  }
}

///|
/// Record of one H0 probe scheduling attempt (never auto-claims I).
pub(all) struct H0ProbeRecord {
  intent : H0Intent
  backend_kind : String
  /// Always false from this skeleton — only Bit验证 may mark I-PASS.
  i_claimed : Bool
  artifact_dir : String
  evidence_cmd_hint : String
  note : String
} derive(Eq, Debug)

///|
pub extend H0ProbeRecord with Eq::{equal, not_equal}

///|
pub extend H0ProbeRecord with Debug::{to_repr}

///|
pub fn H0ProbeRecord::asserts_i_not_claimed(self : H0ProbeRecord) -> Bool {
  !self.i_claimed
}

///|
fn h0_evidence_cmd_hint(intent : H0Intent) -> String {
  match intent {
    Cm0607BoxDoctor =>
      "bash /workspace/bitbot/scripts/host_h0_smoke.sh cm-0607"
    Cm0608EnvDetect =>
      "bash /workspace/bitbot/scripts/host_h0_smoke.sh cm-0608"
    Cm2175BoxClock =>
      "bash /workspace/bitbot/scripts/host_h0_smoke.sh cm-2175"
  }
}

///|
/// Schedule/run H0 intent against current backend. Mock and Live both leave
/// `i_claimed=false`. Live records an audit span pointing at the artifacts dir.
pub fn HostAbi::run_h0_probe(self : HostAbi, intent : H0Intent) -> H0ProbeRecord {
  let sub = intent.artifact_subdir()
  let artifact_dir = host_artifacts_dir() + "/" + sub
  let backend_kind = self.backend_kind()
  let note = match self.backend {
    Mock =>
      "Mock backend — kernel-contract only; I not claimed (run Host smoke for I evidence)"
    Live(_) =>
      "Live backend skeleton — Host smoke script must produce real artifacts; I not claimed here"
  }
  self.effects.push("h0_probe:" + intent.cm_id() + ":" + backend_kind)
  match self.backend {
    Live(_) =>
      self.record_audit(
        AuditSpan::make(
          "h0_probe:" + intent.cm_id(),
          artifact_path=Some(artifact_dir),
          ok=true,
          detail=note,
        ),
      )
    Mock => ()
  }
  {
    intent,
    backend_kind,
    i_claimed: false,
    artifact_dir,
    evidence_cmd_hint: h0_evidence_cmd_hint(intent),
    note,
  }
}

///|
/// Run all three H0 intents; I never claimed by this helper.
pub fn HostAbi::run_h0_wave(self : HostAbi) -> Array[H0ProbeRecord] {
  let intents : Array[H0Intent] = [
    Cm0607BoxDoctor,
    Cm0608EnvDetect,
    Cm2175BoxClock,
  ]
  let out : Array[H0ProbeRecord] = []
  for intent in intents {
    out.push(self.run_h0_probe(intent))
  }
  out
}

///|
/// True iff every record leaves I unclaimed (skeleton invariant).
pub fn h0_wave_i_unclaimed(records : Array[H0ProbeRecord]) -> Bool {
  for r in records {
    if r.i_claimed {
      return false
    }
  }
  true
}
