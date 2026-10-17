///|
/// CM-1405: Members panel — group member list in info panel; matches app-ui.
/// Kernel-contract only (not real Host pixels).

///|
/// One row in the Members panel (app-ui info panel Members section).
pub(all) struct MembersPanelRow {
  agent_id : String
  display_name : String
  role : String
} derive(Eq, Debug)

///|
pub extend MembersPanelRow with Eq::{equal, not_equal}

///|
pub extend MembersPanelRow with Debug::{to_repr}

///|
/// Kernel-contract Members panel snapshot (info panel Members section).
pub(all) struct MembersPanel {
  /// Must align with InfoPanelSection::Members / has_members.
  section_anchor : String
  group_id : String
  rows : Array[MembersPanelRow]
} derive(Eq, Debug)

///|
pub extend MembersPanel with Eq::{equal, not_equal}

///|
pub extend MembersPanel with Debug::{to_repr}

///|
pub fn members_panel_app_ui_anchor() -> String {
  "members"
}

///|
/// Build Members panel from TeammateDirectory (CM-1401 + CM-1405).
pub fn MembersPanel::from_directory(
  dir : TeammateDirectory,
  group_id~ : String,
) -> MembersPanel {
  let rows : Array[MembersPanelRow] = []
  for m in dir.members {
    rows.push({ agent_id: m.id, display_name: m.name, role: m.boundary.role, })
  }
  { section_anchor: members_panel_app_ui_anchor(), group_id, rows, }
}

///|
/// CM-1405: panel matches app-ui Members section anchor + lists directory members.
pub fn MembersPanel::matches_app_ui(self : MembersPanel) -> Bool {
  self.section_anchor == members_panel_app_ui_anchor() &&
  self.section_anchor == @ui_protocol.InfoPanelSection::Members.label()
}

///|
pub fn MembersPanel::member_ids(self : MembersPanel) -> Array[String] {
  let out : Array[String] = []
  for r in self.rows {
    out.push(r.agent_id)
  }
  out
}

///|
pub fn MembersPanel::contains(self : MembersPanel, agent_id : String) -> Bool {
  for r in self.rows {
    if r.agent_id == agent_id {
      return true
    }
  }
  false
}

///|
/// Host mock: open Members panel only when app-ui aligned and info panel has Members.
pub(all) struct HostMembersPanelMock {
  mut last : MembersPanel?
}

///|
pub fn HostMembersPanelMock::new() -> HostMembersPanelMock {
  { last: None, }
}

///|
pub fn HostMembersPanelMock::open(
  self : HostMembersPanelMock,
  panel : MembersPanel,
  info : @ui_protocol.PerAgentInfoPanel,
) -> Result[Unit, String] {
  if !info.has_members {
    return Err("info panel missing Members section")
  }
  if !panel.matches_app_ui() {
    return Err("Members panel does not match app-ui anchor")
  }
  self.last = Some(panel)
  Ok(())
}

///|
pub fn HostMembersPanelMock::last_ids(
  self : HostMembersPanelMock,
) -> Array[String] {
  match self.last {
    None => []
    Some(p) => p.member_ids()
  }
}
