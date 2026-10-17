///|
/// H4 probe skeleton (CM-2163 / 2164 / 1105 / 2109 / 2120 / 2146 / 1703) — Wave H4 MCP/OAuth/出网.
/// Authority: docs/host-integration-interface-gaps.md §4.
/// Kernel-facing: schedules/records intents against Mock or Live.
/// Does NOT claim host-integration I-PASS — Bit验证 promotes from Host smoke artifacts.
/// Real evidence: scripts/host_h4_smoke.sh → docs/qa/artifacts/cm-XXXX-*/.
/// Batch-1 READY: 2163 + 2164 (Host FS). OAuth/browser/fetch intents are plan-only until later batch.

///|
pub(all) enum H4Intent {
  Cm2163McpFileExpand
  Cm2164McpWriteToFile
  Cm1105SlackConnect
  Cm2109FinanceOauth
  Cm2120OutlookOauth
  Cm2146AppVsUserBrowser
  Cm1703FetchPublicFallback
} derive(Eq, Debug)

///|
pub extend H4Intent with Eq::{equal, not_equal}

///|
pub extend H4Intent with Debug::{to_repr}

///|
pub fn H4Intent::cm_id(self : H4Intent) -> String {
  match self {
    Cm2163McpFileExpand => "CM-2163"
    Cm2164McpWriteToFile => "CM-2164"
    Cm1105SlackConnect => "CM-1105"
    Cm2109FinanceOauth => "CM-2109"
    Cm2120OutlookOauth => "CM-2120"
    Cm2146AppVsUserBrowser => "CM-2146"
    Cm1703FetchPublicFallback => "CM-1703"
  }
}

///|
pub fn H4Intent::artifact_subdir(self : H4Intent) -> String {
  match self {
    Cm2163McpFileExpand => "cm-2163-mcp-file-expand"
    Cm2164McpWriteToFile => "cm-2164-mcp-write-to-file"
    Cm1105SlackConnect => "cm-1105-slack-connect"
    Cm2109FinanceOauth => "cm-2109-finance-oauth"
    Cm2120OutlookOauth => "cm-2120-outlook-oauth"
    Cm2146AppVsUserBrowser => "cm-2146-app-vs-user-browser"
    Cm1703FetchPublicFallback => "cm-1703-fetch-public-fallback"
  }
}

///|
/// Batch-1 Host-FS intents (2163/2164) vs later OAuth/browser/fetch.
pub fn H4Intent::is_batch1_host_fs(self : H4Intent) -> Bool {
  match self {
    Cm2163McpFileExpand | Cm2164McpWriteToFile => true
    _ => false
  }
}

///|
fn h4_evidence_cmd_hint(intent : H4Intent) -> String {
  match intent {
    Cm2163McpFileExpand =>
      "bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2163"
    Cm2164McpWriteToFile =>
      "bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2164"
    Cm1105SlackConnect =>
      "bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-1105"
    Cm2109FinanceOauth =>
      "bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2109"
    Cm2120OutlookOauth =>
      "bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2120"
    Cm2146AppVsUserBrowser =>
      "bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2146"
    Cm1703FetchPublicFallback =>
      "bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-1703"
  }
}

///|
/// Live-only IO evidence record (G-H4-1 / §4.2). i_claimed always false here.
pub(all) struct H4IoEvidence {
  cm_id : String
  intent : H4Intent
  backend_kind : String
  /// CM-2163 / 2164
  file_ref : String?
  injected_bytes : Int32?
  result_path : String?
  path_sha256 : String?
  /// Must be false when set (chat must not absorb LARGE_PAYLOAD / PAYLOAD).
  chat_has_payload_marker : Bool?
  /// CM-1105 / 2109 / 2120
  oauth_provider : String?
  namespace_before : String?
  namespace_after : String?
  oauth_callback_observed : Bool?
  /// CM-2146
  identity_mode : String?
  browser_session_switched : Bool?
  user_profile_dir : String?
  /// CM-1703
  primary_status : Int32?
  fallback_kind : String?
  /// Must be false when set (no credential bypass as public fallback).
  credential_bypass : Bool?
  /// Shared
  artifact_dir : String
  evidence_cmd_hint : String
  audit_span_id : String
  /// Always false from this skeleton — only Bit验证 may mark I-PASS.
  i_claimed : Bool
  note : String
} derive(Eq, Debug)

///|
pub extend H4IoEvidence with Eq::{equal, not_equal}

///|
pub extend H4IoEvidence with Debug::{to_repr}

///|
pub fn H4IoEvidence::asserts_i_not_claimed(self : H4IoEvidence) -> Bool {
  !self.i_claimed
}

///|
/// Schedule/run H4 intent. Mock and Live both leave i_claimed=false.
/// Live records an audit span pointing at the artifacts dir.
/// Field slots for 2163/2164 are filled with probe plan values;
/// Host smoke overwrites real inject/write evidence in artifacts.
pub fn HostAbi::run_h4_probe(
  self : HostAbi,
  intent : H4Intent,
) -> H4IoEvidence {
  let sub = intent.artifact_subdir()
  let artifact_dir = host_artifacts_dir() + "/" + sub
  let backend_kind = self.backend_kind()
  let note = match self.backend {
    Mock =>
      "Mock backend — kernel-contract only; I not claimed (run Host H4 smoke for I evidence)"
    Live(_) =>
      if intent.is_batch1_host_fs() {
        "Live backend — Host H4 smoke must prove real Host FS $file:/write_to_file; I not claimed here"
      } else {
        "Live backend skeleton — OAuth/browser/fetch not READY this batch; smoke may NOT_READY; I not claimed"
      }
  }
  let span_id = "h4:" + intent.cm_id() + ":" + backend_kind
  self.effects.push("h4_probe:" + intent.cm_id() + ":" + backend_kind)
  match self.backend {
    Live(_) =>
      self.record_audit(
        AuditSpan::make(
          "h4_probe:" + intent.cm_id(),
          artifact_path=Some(artifact_dir),
          ok=true,
          detail=note,
        ),
      )
    Mock => ()
  }
  let mut file_ref : String? = None
  let mut injected_bytes : Int32? = None
  let mut result_path : String? = None
  let path_sha256 : String? = None
  let mut chat_has_payload_marker : Bool? = None
  let mut oauth_provider : String? = None
  let mut namespace_before : String? = None
  let namespace_after : String? = None
  let oauth_callback_observed : Bool? = None
  let mut identity_mode : String? = None
  let browser_session_switched : Bool? = None
  let user_profile_dir : String? = None
  let mut primary_status : Int32? = None
  let mut fallback_kind : String? = None
  let mut credential_bypass : Bool? = None
  match intent {
    Cm2163McpFileExpand => {
      // Plan: Host FS $file: expand; smoke fills injected_bytes / chat assert.
      file_ref = Some("$" + "file:/workspace/h4-mcp-big-body.txt")
      chat_has_payload_marker = Some(false)
      // Live smoke fills injected_bytes from real Host read; skeleton leaves None on Mock plan.
      match self.backend {
        Live(_) => ()
        Mock => ()
      }
    }
    Cm2164McpWriteToFile => {
      result_path = Some("/workspace/agent-tools/h4-loopback-echo.txt")
      chat_has_payload_marker = Some(false)
    }
    Cm1105SlackConnect => {
      oauth_provider = Some("slack")
      namespace_before = Some("NeedsAuth")
    }
    Cm2109FinanceOauth => {
      oauth_provider = Some("finance")
      namespace_before = Some("NeedsAuth")
    }
    Cm2120OutlookOauth => {
      oauth_provider = Some("outlook")
      namespace_before = Some("NeedsAuth")
    }
    Cm2146AppVsUserBrowser => {
      identity_mode = Some("UserRequired")
    }
    Cm1703FetchPublicFallback => {
      primary_status = Some(403)
      fallback_kind = Some("curl")
      credential_bypass = Some(false)
    }
  }
  {
    cm_id: intent.cm_id(),
    intent,
    backend_kind,
    file_ref,
    injected_bytes,
    result_path,
    path_sha256,
    chat_has_payload_marker,
    oauth_provider,
    namespace_before,
    namespace_after,
    oauth_callback_observed,
    identity_mode,
    browser_session_switched,
    user_profile_dir,
    primary_status,
    fallback_kind,
    credential_bypass,
    artifact_dir,
    evidence_cmd_hint: h4_evidence_cmd_hint(intent),
    audit_span_id: span_id,
    i_claimed: false,
    note,
  }
}

///|
/// Run all seven H4 intents; I never claimed by this helper.
pub fn HostAbi::run_h4_wave(self : HostAbi) -> Array[H4IoEvidence] {
  let intents : Array[H4Intent] = [
    Cm2163McpFileExpand,
    Cm2164McpWriteToFile,
    Cm1105SlackConnect,
    Cm2109FinanceOauth,
    Cm2120OutlookOauth,
    Cm2146AppVsUserBrowser,
    Cm1703FetchPublicFallback,
  ]
  let out : Array[H4IoEvidence] = []
  for intent in intents {
    out.push(self.run_h4_probe(intent))
  }
  out
}

///|
/// Run batch-1 Host-FS intents only (2163 + 2164).
pub fn HostAbi::run_h4_batch1(self : HostAbi) -> Array[H4IoEvidence] {
  let intents : Array[H4Intent] = [Cm2163McpFileExpand, Cm2164McpWriteToFile]
  let out : Array[H4IoEvidence] = []
  for intent in intents {
    out.push(self.run_h4_probe(intent))
  }
  out
}

///|
/// True iff every record leaves I unclaimed (skeleton invariant).
pub fn h4_wave_i_unclaimed(records : Array[H4IoEvidence]) -> Bool {
  for r in records {
    if r.i_claimed {
      return false
    }
  }
  true
}
