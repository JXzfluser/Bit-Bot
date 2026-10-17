///|
/// Marks untrusted external content so the runtime never treats it as instruction.
/// Fence parsing lives in parse.mbt; this file only holds the shared type (CAP-072).
pub(all) struct UntrustedFence {
  source : String
  body : String
  marker_id : String
} derive(Eq, Debug)

///|
pub extend UntrustedFence with Eq::{equal, not_equal}

///|
pub extend UntrustedFence with Debug::{to_repr}

///|
pub fn UntrustedFence::wrap(source : String, body : String) -> UntrustedFence {
  { source, body, marker_id: "cursor_untrusted_data", }
}

///|
pub fn UntrustedFence::is_instructional(_self : UntrustedFence) -> Bool {
  false
}
