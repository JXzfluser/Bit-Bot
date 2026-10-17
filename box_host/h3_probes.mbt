///|
/// H3 probe skeleton (CM-2158 / CM-2174 / CM-0705 / CM-0411) — Wave H3 Host FFI.
/// Authority: docs/host-integration-interface-gaps.md §5.
/// Kernel-facing: schedules/records intents against Mock or Live.
/// Does NOT claim host-integration I-PASS — Bit验证 promotes from Host smoke artifacts.
/// Real evidence: scripts/host_h3_smoke.sh → docs/qa/artifacts/cm-XXXX-*/.

///|
pub(all) enum H3Intent {
  Cm2158PackageInstall
  Cm2174SharedBoxFs
  Cm0705DeviceLocalTools
  Cm0411WebhookKeyOpaque
} derive(Eq, Debug)

///|
pub extend H3Intent with Eq::{equal, not_equal}

///|
pub extend H3Intent with Debug::{to_repr}

///|
pub fn H3Intent::cm_id(self : H3Intent) -> String {
  match self {
    Cm2158PackageInstall => "CM-2158"
    Cm2174SharedBoxFs => "CM-2174"
    Cm0705DeviceLocalTools => "CM-0705"
    Cm0411WebhookKeyOpaque => "CM-0411"
  }
}

///|
pub fn H3Intent::artifact_subdir(self : H3Intent) -> String {
  match self {
    Cm2158PackageInstall => "cm-2158-package-install"
    Cm2174SharedBoxFs => "cm-2174-shared-box-fs"
    Cm0705DeviceLocalTools => "cm-0705-device-local-tools"
    Cm0411WebhookKeyOpaque => "cm-0411-webhook-panel"
  }
}

///|
fn h3_evidence_cmd_hint(intent : H3Intent) -> String {
  match intent {
    Cm2158PackageInstall =>
      "bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-2158"
    Cm2174SharedBoxFs =>
      "bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-2174"
    Cm0705DeviceLocalTools =>
      "bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-0705"
    Cm0411WebhookKeyOpaque =>
      "bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-0411"
  }
}

///|
/// Live-only FFI evidence record (G-H3-1 / §5.2). i_claimed always false here.
pub(all) struct H3FfiEvidence {
  cm_id : String
  intent : H3Intent
  backend_kind : String
  /// CM-2158
  package_manager : String?
  shell_pid : Int32?
  shell_exit : Int32?
  /// CM-2174
  agent_a_id : String?
  agent_b_id : String?
  shared_path : String?
  desktop_a_display : String?
  desktop_b_display : String?
  /// CM-0705 — None = true phone path; Some("desktop_no_device_local_tools") = subset
  platform_subset : String?
  permission_card_shown : Bool?
  /// CM-0411
  panel_copy_url_ok : Bool?
  panel_copy_key_ok : Bool?
  tool_read_key_rejected : Bool?
  wake_has_webhook_event : Bool?
  /// Shared
  artifact_dir : String
  evidence_cmd_hint : String
  audit_span_id : String
  /// Always false from this skeleton — only Bit验证 may mark I-PASS.
  i_claimed : Bool
  note : String
} derive(Eq, Debug)

///|
pub extend H3FfiEvidence with Eq::{equal, not_equal}

///|
pub extend H3FfiEvidence with Debug::{to_repr}

///|
pub fn H3FfiEvidence::asserts_i_not_claimed(self : H3FfiEvidence) -> Bool {
  !self.i_claimed
}

///|
/// Documented platform-subset label for CM-0705 path 乙 (G-H3-5).
pub fn h3_platform_subset_desktop_no_device_local_tools() -> String {
  "desktop_no_device_local_tools"
}

///|
/// Schedule/run H3 intent. Mock and Live both leave i_claimed=false.
/// Live records an audit span pointing at the artifacts dir.
/// Field slots for 2158/2174/0705/0411 are filled with probe plan values;
/// Host smoke overwrites real pid/exit/displays/copy receipts in artifacts.
pub fn HostAbi::run_h3_probe(
  self : HostAbi,
  intent : H3Intent,
) -> H3FfiEvidence {
  let sub = intent.artifact_subdir()
  let artifact_dir = host_artifacts_dir() + "/" + sub
  let backend_kind = self.backend_kind()
  let note = match self.backend {
    Mock =>
      "Mock backend — kernel-contract only; I not claimed (run Host H3 smoke for I evidence)"
    Live(_) =>
      "Live backend skeleton — Host H3 smoke must produce real FFI artifacts; I not claimed here"
  }
  let span_id = "h3:" + intent.cm_id() + ":" + backend_kind
  self.effects.push("h3_probe:" + intent.cm_id() + ":" + backend_kind)
  match self.backend {
    Live(_) =>
      self.record_audit(
        AuditSpan::make(
          "h3_probe:" + intent.cm_id(),
          artifact_path=Some(artifact_dir),
          ok=true,
          detail=note,
        ),
      )
    Mock => ()
  }
  let mut package_manager : String? = None
  let shell_pid : Int32? = None
  let shell_exit : Int32? = None
  let mut agent_a_id : String? = None
  let mut agent_b_id : String? = None
  let mut shared_path : String? = None
  let mut desktop_a_display : String? = None
  let mut desktop_b_display : String? = None
  let mut platform_subset : String? = None
  let mut permission_card_shown : Bool? = None
  let panel_copy_url_ok : Bool? = None
  let panel_copy_key_ok : Bool? = None
  let tool_read_key_rejected : Bool? = None
  let wake_has_webhook_event : Bool? = None
  match intent {
    Cm2158PackageInstall => {
      package_manager = Some("npm")
      // Live smoke fills real pid/exit; skeleton leaves None (not mock fake pid).
      match self.backend {
        Live(_) => ()
        Mock => {
          // Mock plan-only: still refuse non-Shell via U gate shape.
          match reject_non_shell_package_install("direct-apt-api") {
            Err(_) => ()
            Ok(_) => ()
          }
        }
      }
    }
    Cm2174SharedBoxFs => {
      agent_a_id = Some("h3-agent-a")
      agent_b_id = Some("h3-agent-b")
      shared_path = Some("/workspace/cross-agent-shared.txt")
      // Plan displays from charter desktop_for — distinct by construction.
      let d_a = self.desktop_for("h3-agent-a")
      let d_b = self.desktop_for("h3-agent-b")
      desktop_a_display = Some(d_a.display)
      desktop_b_display = Some(d_b.display)
    }
    Cm0705DeviceLocalTools => {
      // Default plan: platform subset (desktop Linux box). Smoke writes platform_subset.md.
      platform_subset = Some(h3_platform_subset_desktop_no_device_local_tools())
      permission_card_shown = Some(false)
    }
    Cm0411WebhookKeyOpaque => {
      // Smoke fills panel_copy_* / tool_read / wake fields in artifacts.
      ()
    }
  }
  {
    cm_id: intent.cm_id(),
    intent,
    backend_kind,
    package_manager,
    shell_pid,
    shell_exit,
    agent_a_id,
    agent_b_id,
    shared_path,
    desktop_a_display,
    desktop_b_display,
    platform_subset,
    permission_card_shown,
    panel_copy_url_ok,
    panel_copy_key_ok,
    tool_read_key_rejected,
    wake_has_webhook_event,
    artifact_dir,
    evidence_cmd_hint: h3_evidence_cmd_hint(intent),
    audit_span_id: span_id,
    i_claimed: false,
    note,
  }
}

///|
/// Run all four H3 intents; I never claimed by this helper.
pub fn HostAbi::run_h3_wave(self : HostAbi) -> Array[H3FfiEvidence] {
  let intents : Array[H3Intent] = [
    Cm2158PackageInstall,
    Cm2174SharedBoxFs,
    Cm0705DeviceLocalTools,
    Cm0411WebhookKeyOpaque,
  ]
  let out : Array[H3FfiEvidence] = []
  for intent in intents {
    out.push(self.run_h3_probe(intent))
  }
  out
}

///|
/// True iff every record leaves I unclaimed (skeleton invariant).
pub fn h3_wave_i_unclaimed(records : Array[H3FfiEvidence]) -> Bool {
  for r in records {
    if r.i_claimed {
      return false
    }
  }
  true
}
