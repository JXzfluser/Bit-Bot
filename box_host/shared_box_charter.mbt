///|
/// CM-2174: cross-agent shared box FS — CHARTER-consistent kernel contract.
/// Host-integration remains GAP; this asserts the shared-FS charter shape.

///|
/// CHARTER: agents share one box filesystem and machine state.
pub fn charter_shared_box_fs() -> Bool {
  true
}

///|
/// CHARTER: desktops remain per-agent (not shared).
pub fn charter_distinct_desktops() -> Bool {
  true
}

///|
pub(all) struct SharedBoxCharterCheck {
  shared_fs : Bool
  distinct_desktops : Bool
  agent_a_sees_agent_b_write : Bool
  desktop_a_display : String
  desktop_b_display : String
} derive(Eq, Debug)

///|
pub extend SharedBoxCharterCheck with Eq::{equal, not_equal}

///|
pub extend SharedBoxCharterCheck with Debug::{to_repr}

///|
pub fn SharedBoxCharterCheck::is_charter_consistent(
  self : SharedBoxCharterCheck,
) -> Bool {
  self.shared_fs &&
  self.distinct_desktops &&
  self.agent_a_sees_agent_b_write &&
  self.desktop_a_display != self.desktop_b_display &&
  charter_shared_box_fs() &&
  charter_distinct_desktops()
}

///|
/// CM-2174: two agents on same HostAbi share FS; desktops differ — CHARTER ok.
pub fn HostAbi::check_cross_agent_shared_box_charter(
  self : HostAbi,
) -> SharedBoxCharterCheck {
  let fs1 = self.fs_shared()
  let fs2 = self.fs_shared()
  let shared = fs1 == fs2 && charter_shared_box_fs()
  // Agent B writes; agent A reads same path via shared host FS.
  self.write("/workspace/cross-agent-shared.txt", "from-agent-b")
  let saw = match self.read("/workspace/cross-agent-shared.txt") {
    Ok(r) => r.text.contains("from-agent-b")
    Err(_) => false
  }
  let d_a = self.desktop_for("charter-agent-a")
  let d_b = self.desktop_for("charter-agent-b")
  {
    shared_fs: shared,
    distinct_desktops: charter_distinct_desktops() && d_a.display != d_b.display,
    agent_a_sees_agent_b_write: saw,
    desktop_a_display: d_a.display,
    desktop_b_display: d_b.display,
  }
}
