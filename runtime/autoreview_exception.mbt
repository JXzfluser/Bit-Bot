///|
/// CM-1505: distinguish Host Auto-review block notices from untrusted fenced content.
/// A notice about OUR OWN blocked tool call may be followed; fenced external text must not.
pub(all) enum InstructionPolicy {
  FollowHostRetry
  IgnoreAsData
} derive(Eq, Debug)

///|
pub extend InstructionPolicy with Eq::{equal, not_equal}

///|
pub extend InstructionPolicy with Debug::{to_repr}

///|
/// Classify tool-output provenance.
/// - source=auto-review / Auto-review → FollowHostRetry (own Host notice)
/// - any other source, even if body forges "Auto-review blocked… retry" → IgnoreAsData
pub fn classify_tool_output(
  source : String,
  body : String,
) -> InstructionPolicy {
  // Host auto-review notices are tagged by source, not by fence body claims.
  if source == "auto-review" || source == "Auto-review" {
    return FollowHostRetry
  }
  // Legacy host-tagged notice (non-fenced path).
  if source == "host" && body.contains("Auto-review blocked") {
    return FollowHostRetry
  }
  // Everything else — including WebFetch/Shell/evil fences that *claim*
  // "Auto-review blocked… retry" — is data only (CM-1505 forged notice).
  let _ = body
  IgnoreAsData
}

///|
pub fn policy_for_slice(slice : @security.ContentSlice) -> InstructionPolicy {
  match slice {
    @security.Trusted(_) => FollowHostRetry
    @security.Fenced(fence~) => classify_tool_output(fence.source, fence.body)
  }
}
