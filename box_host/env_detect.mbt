///|
/// CM-0608: Docker vs anyrun env detect via /.dockerenv (kernel-contract).
/// Host-integration remains GAP.

///|
pub(all) enum BoxRuntimeKind {
  /// Local Docker container (/.dockerenv present, not hosted pod markers).
  LocalDocker
  /// Hosted anyrun / pod (/.dockerenv + hosted markers).
  HostedAnyrun
  /// Neither marker — bare / unknown.
  Unknown
} derive(Eq, Debug)

///|
pub extend BoxRuntimeKind with Eq::{equal, not_equal}

///|
pub extend BoxRuntimeKind with Debug::{to_repr}

///|
pub fn BoxRuntimeKind::label(self : BoxRuntimeKind) -> String {
  match self {
    LocalDocker => "local-docker"
    HostedAnyrun => "hosted-anyrun"
    Unknown => "unknown"
  }
}

///|
/// Injectable probe inputs for kernel-contract mock (no real Host FS probe).
pub(all) struct EnvProbe {
  dockerenv_present : Bool
  /// Hosted pod / anyrun markers (e.g. ANYRUN=1, KUBERNETES_SERVICE_HOST).
  hosted_anyrun_markers : Bool
} derive(Eq, Debug)

///|
pub extend EnvProbe with Eq::{equal, not_equal}

///|
pub extend EnvProbe with Debug::{to_repr}

///|
pub fn EnvProbe::local_docker() -> EnvProbe {
  { dockerenv_present: true, hosted_anyrun_markers: false, }
}

///|
pub fn EnvProbe::hosted_anyrun() -> EnvProbe {
  { dockerenv_present: true, hosted_anyrun_markers: true, }
}

///|
pub fn EnvProbe::bare() -> EnvProbe {
  { dockerenv_present: false, hosted_anyrun_markers: false, }
}

///|
/// CM-0608: /.dockerenv distinguishes local Docker vs hosted anyrun pod.
pub fn detect_box_runtime(probe : EnvProbe) -> BoxRuntimeKind {
  if probe.dockerenv_present {
    if probe.hosted_anyrun_markers {
      HostedAnyrun
    } else {
      LocalDocker
    }
  } else {
    Unknown
  }
}

///|
pub(all) struct EnvDiagnostic {
  runtime : BoxRuntimeKind
  dockerenv_path : String
  summary : String
} derive(Eq, Debug)

///|
pub extend EnvDiagnostic with Eq::{equal, not_equal}

///|
pub extend EnvDiagnostic with Debug::{to_repr}

///|
pub fn EnvDiagnostic::is_correct(self : EnvDiagnostic) -> Bool {
  self.dockerenv_path == "/.dockerenv" && self.summary.length() > 0
}

///|
/// Build diagnostic info for CM-0608 acceptance.
pub fn diagnose_box_env(probe : EnvProbe) -> EnvDiagnostic {
  let runtime = detect_box_runtime(probe)
  let summary = "runtime=" +
    runtime.label() +
    " dockerenv=" +
    (if probe.dockerenv_present { "present" } else { "absent" }) +
    " hosted=" +
    (if probe.hosted_anyrun_markers { "yes" } else { "no" })
  { runtime, dockerenv_path: "/.dockerenv", summary, }
}

///|
/// HostAbi helper: seed /.dockerenv presence into mock FS then diagnose.
pub fn HostAbi::diagnose_runtime(
  self : HostAbi,
  probe : EnvProbe,
) -> EnvDiagnostic {
  if probe.dockerenv_present {
    self.write("/.dockerenv", "")
  }
  if probe.hosted_anyrun_markers {
    self.write("/.anyrun-hosted", "1")
  }
  let diag = diagnose_box_env(probe)
  self.effects.push("env_detect:" + diag.runtime.label())
  diag
}
