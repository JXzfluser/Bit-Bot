///|
/// CM-1901 / CM-1902 / CM-1904 / CM-1906: Host Settings kernel-contract (ui_protocol).
/// Kernel-contract only — not host-integration / real-screen PASS.

///|
/// Real Settings entry paths ONLY (CM-1901). Gear / Preferences / per-agent panel ≠ these.
pub(all) enum SettingsEntry {
  SidebarAccountButton
  KeyboardShortcut // Cmd+,
  CommandPalette // "Open settings"
} derive(Eq, Debug)

///|
pub extend SettingsEntry with Eq::{equal, not_equal}

///|
pub extend SettingsEntry with Debug::{to_repr}

///|
pub fn SettingsEntry::label(self : SettingsEntry) -> String {
  match self {
    SidebarAccountButton => "sidebar-account-button"
    KeyboardShortcut => "keyboard-shortcut"
    CommandPalette => "command-palette"
  }
}

///|
/// Ordered Settings tabs (CM-1902). GP-189 adds Phone: 手机配对以前寄在「凭证」里，
/// 用户要找的是「手机」，不是「密钥」—— 页签名就是入口，入口不该让人猜。
pub(all) enum SettingsTab {
  General
  Computer
  Vault
  Phone
  UsageBilling
  Updates
} derive(Eq, Debug)

///|
pub extend SettingsTab with Eq::{equal, not_equal}

///|
pub extend SettingsTab with Debug::{to_repr}

///|
pub fn SettingsTab::label(self : SettingsTab) -> String {
  match self {
    General => "General"
    Computer => "Computer"
    Vault => "Vault"
    Phone => "Phone"
    UsageBilling => "Usage & Billing"
    Updates => "Updates"
  }
}

///|
/// Closed-set Settings deep-link anchors (CM-1902 §2.2).
pub(all) enum SettingsAnchor {
  // General
  Account
  Theme
  Accent
  Language
  SpellCheck
  Microphone
  HardwareAcceleration
  HardwareAccelerationRestart
  NetworkDebugger
  NotificationSoundEnabled
  NotificationSound
  Timezone
  AutoReview
  AutoReviewRules
  SecurityKeys
  // Computer
  LocalExecution
  Computers
  UpdateComputer
  ResetComputer
  // Phone
  Pairing
  // Usage & Billing
  Usage
  Plan
  CancelTrial
  OnDemand
  Billing
  // Updates
  UpdateStatus
  UpdateChannel
  AutomaticUpdates
} derive(Eq, Debug)

///|
pub extend SettingsAnchor with Eq::{equal, not_equal}

///|
pub extend SettingsAnchor with Debug::{to_repr}

///|
/// Map anchor → id= string (closed set).
pub fn SettingsAnchor::id(self : SettingsAnchor) -> String {
  match self {
    Account => "account"
    Theme => "theme"
    Accent => "accent"
    Language => "language"
    SpellCheck => "spell-check"
    Microphone => "microphone"
    HardwareAcceleration => "hardware-acceleration"
    HardwareAccelerationRestart => "hardware-acceleration-restart"
    NetworkDebugger => "network-debugger"
    NotificationSoundEnabled => "notification-sound-enabled"
    NotificationSound => "notification-sound"
    Timezone => "timezone"
    AutoReview => "auto-review"
    AutoReviewRules => "auto-review-rules"
    SecurityKeys => "security-keys"
    LocalExecution => "local-execution"
    Computers => "computers"
    UpdateComputer => "update-computer"
    ResetComputer => "reset-computer"
    Pairing => "pairing"
    Usage => "usage"
    Plan => "plan"
    CancelTrial => "cancel-trial"
    OnDemand => "on-demand"
    Billing => "billing"
    UpdateStatus => "update-status"
    UpdateChannel => "update-channel"
    AutomaticUpdates => "automatic-updates"
  }
}

///|
/// Tab owning this anchor.
pub fn SettingsAnchor::tab(self : SettingsAnchor) -> SettingsTab {
  match self {
    Account
    | Theme
    | Accent
    | Language
    | SpellCheck
    | Microphone
    | HardwareAcceleration
    | HardwareAccelerationRestart
    | NetworkDebugger
    | NotificationSoundEnabled
    | NotificationSound
    | Timezone
    | AutoReview
    | AutoReviewRules
    | SecurityKeys => General
    LocalExecution | Computers | UpdateComputer | ResetComputer => Computer
    Pairing => Phone
    Usage | Plan | CancelTrial | OnDemand | Billing => UsageBilling
    UpdateStatus | UpdateChannel | AutomaticUpdates => Updates
  }
}

///|
/// Full closed set for bijection tests (CM-1902).
pub fn settings_anchors_closed_set() -> Array[SettingsAnchor] {
  [
    Account,
    Theme,
    Accent,
    Language,
    SpellCheck,
    Microphone,
    HardwareAcceleration,
    HardwareAccelerationRestart,
    NetworkDebugger,
    NotificationSoundEnabled,
    NotificationSound,
    Timezone,
    AutoReview,
    AutoReviewRules,
    SecurityKeys,
    LocalExecution,
    Computers,
    UpdateComputer,
    ResetComputer,
    Pairing,
    Usage,
    Plan,
    CancelTrial,
    OnDemand,
    Billing,
    UpdateStatus,
    UpdateChannel,
    AutomaticUpdates,
  ]
}

///|
/// Parse id= string → SettingsAnchor; unknown → Error (never silent).
pub fn parse_settings_anchor(id : String) -> Result[SettingsAnchor, String] {
  for a in settings_anchors_closed_set() {
    if a.id() == id {
      return Ok(a)
    }
  }
  Err("unknown settings anchor id: " + id)
}

///|
/// Sole legal deep-link form: grokbot://app/v1/settings?id=<anchor>
pub fn settings_deep_link(anchor : SettingsAnchor) -> String {
  "grokbot://app/v1/settings?id=" + anchor.id()
}

///|
/// Parse a settings deep link URI; reject non-matching shapes and unknown ids.
pub fn parse_settings_deep_link(uri : String) -> Result[SettingsAnchor, String] {
  let prefix = "grokbot://app/v1/settings?id="
  if !uri.has_prefix(prefix) {
    return Err(
      "settings deep link must be grokbot://app/v1/settings?id=<anchor>",
    )
  }
  let id = uri[prefix.length():].to_owned()
  if id.length() == 0 ||
    id.contains("&") ||
    id.contains("?") ||
    id.contains("/") {
    return Err("malformed settings deep link id")
  }
  parse_settings_anchor(id)
}

///|
/// Open Settings intent (CM-1901); optional anchor for CM-1902 deep link.
pub(all) struct OpenSettingsIntent {
  entry : SettingsEntry
  anchor : SettingsAnchor?
} derive(Eq, Debug)

///|
pub extend OpenSettingsIntent with Eq::{equal, not_equal}

///|
pub extend OpenSettingsIntent with Debug::{to_repr}

///|
pub fn OpenSettingsIntent::open(
  entry : SettingsEntry,
  anchor~ : SettingsAnchor? = None,
) -> OpenSettingsIntent {
  { entry, anchor, }
}

///|
/// Kernel validate: any real SettingsEntry is Ok; fake paths must not construct.
pub fn OpenSettingsIntent::validate(
  self : OpenSettingsIntent,
) -> Result[Unit, String] {
  // Closed entry set — constructing this type already implies a legal entry.
  let _ = self.entry.label()
  match self.anchor {
    None => Ok(())
    Some(a) => {
      // Round-trip must hold for any attached anchor.
      let link = settings_deep_link(a)
      match parse_settings_deep_link(link) {
        Ok(back) =>
          if back == a {
            Ok(())
          } else {
            Err("settings anchor deep-link bijection broken")
          }
        Err(e) => Err(e)
      }
    }
  }
}

///|
/// Forbidden guidance phrases for Settings entry (CM-1901 §1.2).
pub fn is_forbidden_settings_entry_guidance(text : String) -> Bool {
  let lower = text.to_lower()
  lower.contains("gear icon") ||
  lower.contains("gear-icon") ||
  lower.contains("preferences menu") ||
  lower.contains("macos preferences") ||
  lower.contains("system preferences") ||
  // Per-agent info-panel gear is NOT global Settings.
  (
    lower.contains("info panel") &&
    lower.contains("gear") &&
    lower.contains("settings")
  ) ||
  (
    lower.contains("per-agent") &&
    lower.contains("gear") &&
    (lower.contains("global settings") || lower.contains("open settings"))
  )
}

///|
/// Static/policy check: Settings guidance may only describe the three real entries.
pub fn validate_settings_entry_guidance(text : String) -> Result[Unit, String] {
  if is_forbidden_settings_entry_guidance(text) {
    return Err(
      "forbidden Settings entry path (gear/Preferences/per-agent panel ≠ global Settings)",
    )
  }
  Ok(())
}

///|
/// CM-1904: Reset Computer is valid anchor but NOT assistant-preferred vs Update.
pub fn is_assistant_preferred_computer_recovery(
  anchor : SettingsAnchor,
) -> Bool {
  match anchor {
    UpdateComputer => true
    ResetComputer => false
    _ => false
  }
}

///|
/// CM-1904: refuse steering user to Reset when Update is available.
pub fn prefer_update_over_reset(
  suggested : SettingsAnchor,
) -> Result[SettingsAnchor, String] {
  match suggested {
    ResetComputer =>
      Err(
        "reset-computer is not preferred; steer to update-computer (preserve files/logins)",
      )
    UpdateComputer => Ok(UpdateComputer)
    other => Err("not a computer recovery anchor: " + other.id())
  }
}

///|
/// CM-1906: update-channel (app) ≠ update-computer (box instance).
pub fn update_channel_ne_update_computer() -> Bool {
  UpdateChannel != UpdateComputer &&
  UpdateChannel.id() != UpdateComputer.id() &&
  UpdateChannel.tab() == Updates &&
  UpdateComputer.tab() == Computer
}

///|
/// Mock Host Settings UI surface (kernel-contract; no real pixels).
pub(all) struct HostSettingsUiMock {
  mut last_intent : OpenSettingsIntent?
  effects : Array[String]
}

///|
pub fn HostSettingsUiMock::new() -> HostSettingsUiMock {
  { last_intent: None, effects: [], }
}

///|
/// HostSettingsUi.open_settings — Kernel only records intent; Host renders.
pub fn HostSettingsUiMock::open_settings(
  self : HostSettingsUiMock,
  intent : OpenSettingsIntent,
) -> Result[Unit, String] {
  match intent.validate() {
    Err(e) => Err(e)
    Ok(_) => {
      self.last_intent = Some(intent)
      self.effects.push("open_settings:" + intent.entry.label())
      match intent.anchor {
        Some(a) => self.effects.push("anchor:" + a.id())
        None => ()
      }
      Ok(())
    }
  }
}
