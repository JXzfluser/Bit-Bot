///|
/// Host backend selection (G-ABI-1). Mock | Live coexist; Live must not
/// silently fall back to Mock. See docs/host-integration-interface-gaps.md §1.
/// `HostAbi::mock()` is U-only; CI I jobs must construct Live.

///|
/// Stub MCP transport config for Live (real JSON-RPC lands later — G-MCP-*).
pub(all) struct McpTransportConfig {
  /// "stdio" | "http" | "sse" (stub labels only).
  kind : String
  endpoint : String?
} derive(Eq, Debug)

///|
pub extend McpTransportConfig with Eq::{equal, not_equal}

///|
pub extend McpTransportConfig with Debug::{to_repr}

///|
/// Live Host configuration (G-ABI-1).
pub(all) struct LiveHostConfig {
  /// e.g. Some(":1") for desktop capture (CM-0605 I).
  display : String?
  workspace_root : String
  mcp_transport : McpTransportConfig?
  /// Whether real UI automation probes are allowed.
  ui_automation : Bool
} derive(Eq, Debug)

///|
pub extend LiveHostConfig with Eq::{equal, not_equal}

///|
pub extend LiveHostConfig with Debug::{to_repr}

///|
pub fn LiveHostConfig::with_display(
  display : String,
  workspace_root~ : String = "/workspace",
  ui_automation~ : Bool = false,
) -> LiveHostConfig {
  {
    display: Some(display),
    workspace_root,
    mcp_transport: None,
    ui_automation,
  }
}

///|
pub fn LiveHostConfig::default_workspace(
  workspace_root~ : String = "/workspace",
) -> LiveHostConfig {
  {
    display: None,
    workspace_root,
    mcp_transport: None,
    ui_automation: false,
  }
}

///|
pub(all) enum HostBackend {
  /// U / kernel-contract only — `HostAbi::mock()`.
  Mock
  /// I / host-integration — real FFI path; failure must not degrade to Mock.
  Live(LiveHostConfig)
} derive(Eq, Debug)

///|
pub extend HostBackend with Eq::{equal, not_equal}

///|
pub extend HostBackend with Debug::{to_repr}

///|
pub fn HostBackend::label(self : HostBackend) -> String {
  match self {
    Mock => "Mock"
    Live(_) => "Live"
  }
}

///|
pub fn HostBackend::is_live(self : HostBackend) -> Bool {
  match self {
    Mock => false
    Live(_) => true
  }
}

///|
/// CM-0605 / G-SCR: frame provenance. Placeholder never counts as I evidence.
pub(all) enum FrameOrigin {
  Placeholder
  LiveDisplay
} derive(Eq, Debug)

///|
pub extend FrameOrigin with Eq::{equal, not_equal}

///|
pub extend FrameOrigin with Debug::{to_repr}

///|
/// G-ABI-2: audit span for Live side-effects (tool, duration, artifact path).
pub(all) struct AuditSpan {
  tool_name : String
  duration_ms : Int32
  artifact_path : String?
  ok : Bool
  detail : String
} derive(Eq, Debug)

///|
pub extend AuditSpan with Eq::{equal, not_equal}

///|
pub extend AuditSpan with Debug::{to_repr}

///|
pub fn AuditSpan::make(
  tool_name : String,
  duration_ms~ : Int32 = 0,
  artifact_path~ : String? = None,
  ok~ : Bool = true,
  detail~ : String = "",
) -> AuditSpan {
  { tool_name, duration_ms, artifact_path, ok, detail, }
}

///|
/// Convention root for Bit验证 host-integration artifacts (H0+).
pub fn host_artifacts_dir() -> String {
  "/workspace/bitbot/docs/qa/artifacts"
}
