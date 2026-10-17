///|
/// CM-2178 / PERM-05: when permission missing, guide to Settings — do not pretend connected.

///|
/// Why a surface is missing permission / connection.
pub(all) enum MissingPermissionKind {
  ConnectorNeedsAuth(namespace_~ : String)
  ConnectorNeedsGrant(namespace_~ : String)
  LocalExecutionDisabled
  DeviceToolPermission(tool~ : String)
} derive(Eq, Debug)

///|
pub extend MissingPermissionKind with Eq::{equal, not_equal}

///|
pub extend MissingPermissionKind with Debug::{to_repr}

///|
pub fn MissingPermissionKind::label(self : MissingPermissionKind) -> String {
  match self {
    ConnectorNeedsAuth(namespace_~) => "needs-auth:" + namespace_
    ConnectorNeedsGrant(namespace_~) => "needs-grant:" + namespace_
    LocalExecutionDisabled => "local-execution-disabled"
    DeviceToolPermission(tool~) => "device-tool:" + tool
  }
}

///|
/// Preferred Settings anchor for the missing permission (kernel-contract).
pub fn MissingPermissionKind::settings_anchor(
  self : MissingPermissionKind,
) -> SettingsAnchor {
  match self {
    ConnectorNeedsAuth(_) | ConnectorNeedsGrant(_) => Account
    LocalExecutionDisabled => LocalExecution
    DeviceToolPermission(_) => Computers
  }
}

///|
/// Guide outcome when permission is missing.
pub(all) struct MissingPermissionGuide {
  kind : MissingPermissionKind
  open_settings : OpenSettingsIntent
  /// Must stay false — never pretend the surface is already connected.
  pretends_connected : Bool
  guidance : String
} derive(Eq, Debug)

///|
pub extend MissingPermissionGuide with Eq::{equal, not_equal}

///|
pub extend MissingPermissionGuide with Debug::{to_repr}

///|
pub fn MissingPermissionGuide::guides_to_settings(
  self : MissingPermissionGuide,
) -> Bool {
  if self.pretends_connected {
    return false
  }
  match self.open_settings.validate() {
    Ok(_) => true
    Err(_) => false
  }
}

///|
/// CM-2178: Given missing perm When guiding Then Settings deep-link / open — not pretend connected.
pub fn guide_missing_permission_to_settings(
  kind : MissingPermissionKind,
  entry~ : SettingsEntry = SidebarAccountButton,
) -> MissingPermissionGuide {
  let anchor = kind.settings_anchor()
  let intent = OpenSettingsIntent::open(entry, anchor=Some(anchor))
  let guidance = "Permission missing (" +
    kind.label() +
    "). Open Settings → " +
    anchor.tab().label() +
    " (" +
    anchor.id() +
    ") to connect or grant access. Do not pretend connected."
  { kind, open_settings: intent, pretends_connected: false, guidance, }
}

///|
/// Pretend-connected responses are forbidden when permission is missing.
pub fn is_pretend_connected_guidance(text : String) -> Bool {
  let lower = text.to_lower()
  (
    lower.contains("already connected") ||
    lower.contains("you're connected") ||
    lower.contains("you are connected") ||
    lower.contains("connection ready") ||
    lower.contains("permission granted")
  ) &&
  !(lower.contains("settings") || lower.contains("not connected"))
}

///|
/// Validate assistant guidance for a missing-permission situation.
pub fn validate_missing_permission_guidance(
  guide : MissingPermissionGuide,
  assistant_text~ : String,
) -> Result[Unit, String] {
  if guide.pretends_connected {
    return Err("must not pretend connected when permission missing")
  }
  if is_pretend_connected_guidance(assistant_text) {
    return Err("assistant must not pretend connected; guide to Settings")
  }
  match guide.open_settings.validate() {
    Err(e) => Err(e)
    Ok(_) =>
      if assistant_text.to_lower().contains("settings") ||
        assistant_text.contains(
          settings_deep_link(guide.kind.settings_anchor()),
        ) {
        Ok(())
      } else {
        Err("guidance must point user to Settings")
      }
  }
}
