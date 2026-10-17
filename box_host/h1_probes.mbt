///|
/// H1 probe skeleton (CM-0605 / CM-0802 / CM-2160 / CM-0806).
/// Kernel-facing: schedules/records intents against Mock or Live.
/// Does NOT claim host-integration I-PASS — Bit验证 promotes from Host smoke artifacts.
/// Real evidence: scripts/host_h1_smoke.sh → docs/qa/artifacts/cm-0605-screenshot/ etc.

///|
pub(all) enum H1Intent {
  Cm0605Screenshot
  Cm0802BoxChrome
  Cm2160Navigate
  Cm0806SessionJar
} derive(Eq, Debug)

///|
pub extend H1Intent with Eq::{equal, not_equal}

///|
pub extend H1Intent with Debug::{to_repr}

///|
pub fn H1Intent::cm_id(self : H1Intent) -> String {
  match self {
    Cm0605Screenshot => "CM-0605"
    Cm0802BoxChrome => "CM-0802"
    Cm2160Navigate => "CM-2160"
    Cm0806SessionJar => "CM-0806"
  }
}

///|
pub fn H1Intent::artifact_subdir(self : H1Intent) -> String {
  match self {
    Cm0605Screenshot => "cm-0605-screenshot"
    Cm0802BoxChrome => "cm-0802-box-chrome"
    Cm2160Navigate => "cm-2160-navigate"
    Cm0806SessionJar => "cm-0806-session-jar"
  }
}

///|
/// Record of one H1 probe scheduling attempt (never auto-claims I).
pub(all) struct H1ProbeRecord {
  intent : H1Intent
  backend_kind : String
  /// Always false from this skeleton — only Bit验证 may mark I-PASS.
  i_claimed : Bool
  artifact_dir : String
  evidence_cmd_hint : String
  note : String
} derive(Eq, Debug)

///|
pub extend H1ProbeRecord with Eq::{equal, not_equal}

///|
pub extend H1ProbeRecord with Debug::{to_repr}

///|
pub fn H1ProbeRecord::asserts_i_not_claimed(self : H1ProbeRecord) -> Bool {
  !self.i_claimed
}

///|
fn h1_evidence_cmd_hint(intent : H1Intent) -> String {
  match intent {
    Cm0605Screenshot =>
      "bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0605"
    Cm0802BoxChrome =>
      "bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0802"
    Cm2160Navigate =>
      "bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-2160"
    Cm0806SessionJar =>
      "bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0806"
  }
}

///|
/// Documented path for a real Host-captured LiveDisplay frame (CM-0605).
/// Does not load bytes or claim I — points Bit验证 at smoke artifacts.
pub fn h1_live_frame_artifact_path() -> String {
  host_artifacts_dir() + "/cm-0605-screenshot/live_display.png"
}

///|
/// Schedule/run H1 intent against current backend. Mock and Live both leave
/// `i_claimed=false`. Live records an audit span pointing at the artifacts dir.
pub fn HostAbi::run_h1_probe(self : HostAbi, intent : H1Intent) -> H1ProbeRecord {
  let sub = intent.artifact_subdir()
  let artifact_dir = host_artifacts_dir() + "/" + sub
  let backend_kind = self.backend_kind()
  let note = match self.backend {
    Mock =>
      "Mock backend — kernel-contract only; I not claimed (run Host H1 smoke for I evidence)"
    Live(_) =>
      "Live backend skeleton — Host H1 smoke script must produce real artifacts; I not claimed here"
  }
  self.effects.push("h1_probe:" + intent.cm_id() + ":" + backend_kind)
  match self.backend {
    Live(_) =>
      self.record_audit(
        AuditSpan::make(
          "h1_probe:" + intent.cm_id(),
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
    evidence_cmd_hint: h1_evidence_cmd_hint(intent),
    note,
  }
}

///|
/// Run all four H1 intents; I never claimed by this helper.
pub fn HostAbi::run_h1_wave(self : HostAbi) -> Array[H1ProbeRecord] {
  let intents : Array[H1Intent] = [
    Cm0605Screenshot,
    Cm0802BoxChrome,
    Cm2160Navigate,
    Cm0806SessionJar,
  ]
  let out : Array[H1ProbeRecord] = []
  for intent in intents {
    out.push(self.run_h1_probe(intent))
  }
  out
}

///|
/// True iff every record leaves I unclaimed (skeleton invariant).
pub fn h1_wave_i_unclaimed(records : Array[H1ProbeRecord]) -> Bool {
  for r in records {
    if r.i_claimed {
      return false
    }
  }
  true
}

///|
/// CM-0802 negative path (Live skeleton): Host-side launch guard. Only the
/// box-chrome launcher paths pass; bare chrome / chromium are refused. Mirrors
/// `h1_launch_guard` in scripts/host_h1_smoke.sh. Pure check — never launches.
pub fn box_chrome_launch_guard(command_line : String) -> Result[String, String] {
  let trimmed = command_line.trim().to_owned()
  let argv0 = match trimmed.split(" ").to_array() {
    [] => ""
    parts => parts[0].to_owned()
  }
  if argv0 == "" {
    return Err("refused: empty launch command")
  }
  let allowed : Array[String] = [
    box_chrome_launch_path(),
    "/usr/local/libexec/sand/box-chrome",
    "/opt/sand/sand-host/box-launchers/box-chrome",
    "box-chrome",
  ]
  for a in allowed {
    if argv0 == a {
      return Ok(argv0)
    }
  }
  Err(
    "refused: bare chrome launch '" +
    argv0 +
    "' forbidden; must launch via " +
    box_chrome_launch_path(),
  )
}

///|
/// Live wrapper: records an audit span (ok=false on refusal) so Bit验证 can
/// query refusals. Does not launch anything and does not claim I.
pub fn HostAbi::guard_browser_launch(
  self : HostAbi,
  command_line : String,
) -> Result[String, String] {
  let res = box_chrome_launch_guard(command_line)
  let (ok, detail) = match res {
    Ok(p) => (true, "allowed " + p)
    Err(e) => (false, e)
  }
  self.effects.push(
    "h1_launch_guard:" + (if ok { "allowed" } else { "refused" }),
  )
  match self.backend {
    Live(_) =>
      self.record_audit(
        AuditSpan::make(
          "h1_launch_guard",
          artifact_path=Some(
            host_artifacts_dir() + "/cm-0802-box-chrome/bare_refusal.txt",
          ),
          ok~,
          detail~,
        ),
      )
    Mock => ()
  }
  res
}
