///|
/// CM-0205: per-agent info panel — fields align with app-ui.md anchors
/// (desktop preview, Routines, Channels, Members, gear settings).
/// Kernel-contract only — not fake real Host pixels.

///|
/// Section keys present on the per-agent info panel (closed set from app-ui.md).
pub(all) enum InfoPanelSection {
  DesktopPreview
  Routines
  Channels
  Members
  GearSettings
} derive(Eq, Debug)

///|
pub extend InfoPanelSection with Eq::{equal, not_equal}

///|
pub extend InfoPanelSection with Debug::{to_repr}

///|
pub fn InfoPanelSection::label(self : InfoPanelSection) -> String {
  match self {
    DesktopPreview => "desktop-preview"
    Routines => "routines"
    Channels => "channels"
    Members => "members"
    GearSettings => "gear-settings"
  }
}

///|
/// Open triggers for the per-agent panel (≠ global Settings).
pub(all) enum InfoPanelOpenTrigger {
  ClickAgentName
  KeyboardShortcut // Cmd+Shift+I
} derive(Eq, Debug)

///|
pub extend InfoPanelOpenTrigger with Eq::{equal, not_equal}

///|
pub extend InfoPanelOpenTrigger with Debug::{to_repr}

///|
/// Kernel-contract snapshot of the per-agent info panel fields.
pub(all) struct PerAgentInfoPanel {
  agent_id : String
  has_desktop_preview : Bool
  has_routines : Bool
  has_channels : Bool
  has_members : Bool
  has_gear_settings : Bool
  open_trigger : InfoPanelOpenTrigger
} derive(Eq, Debug)

///|
pub extend PerAgentInfoPanel with Eq::{equal, not_equal}

///|
pub extend PerAgentInfoPanel with Debug::{to_repr}

///|
/// Build a full panel with all app-ui.md anchor sections present.
pub fn PerAgentInfoPanel::full(
  agent_id~ : String,
  open_trigger~ : InfoPanelOpenTrigger = ClickAgentName,
) -> PerAgentInfoPanel {
  {
    agent_id,
    has_desktop_preview: true,
    has_routines: true,
    has_channels: true,
    has_members: true,
    has_gear_settings: true,
    open_trigger,
  }
}

///|
/// Ordered closed-set of section anchors (app-ui.md).
pub fn info_panel_section_anchors() -> Array[InfoPanelSection] {
  [DesktopPreview, Routines, Channels, Members, GearSettings]
}

///|
/// CM-0205: panel fields must include every app-ui.md anchor section.
pub fn PerAgentInfoPanel::fields_align_with_app_ui(
  self : PerAgentInfoPanel,
) -> Bool {
  self.has_desktop_preview &&
  self.has_routines &&
  self.has_channels &&
  self.has_members &&
  self.has_gear_settings
}

///|
/// Gear opens per-agent settings (avatar/name/title/description/notifications),
/// not global Settings (CM-1901 separation).
pub fn PerAgentInfoPanel::gear_is_per_agent_not_global(
  self : PerAgentInfoPanel,
) -> Bool {
  self.has_gear_settings
}

///|
/// Host mock for kernel-contract evidence (not real pixels).
pub(all) struct HostInfoPanelMock {
  mut last_opened : PerAgentInfoPanel?
}

///|
pub fn HostInfoPanelMock::new() -> HostInfoPanelMock {
  { last_opened: None, }
}

///|
pub fn HostInfoPanelMock::open(
  self : HostInfoPanelMock,
  panel : PerAgentInfoPanel,
) -> Result[Unit, String] {
  guard panel.fields_align_with_app_ui() else {
    Err("info panel missing app-ui.md anchor fields")
  }
  self.last_opened = Some(panel)
  Ok(())
}

///|
pub fn HostInfoPanelMock::last_agent_id(self : HostInfoPanelMock) -> String? {
  match self.last_opened {
    Some(p) => Some(p.agent_id)
    None => None
  }
}
