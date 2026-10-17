///|
/// CM-0206: per-assistant notification settings — assistant-level notify toggles.
/// Kernel-contract only (Host UI + memory/profile shape); not real Host pixels.

///|
/// Closed set of per-assistant notification toggles (gear settings / profile).
pub(all) enum AssistantNotifyToggle {
  Desktop
  Sound
  MentionsOnly
  Routines
  Channels
} derive(Eq, Debug)

///|
pub extend AssistantNotifyToggle with Eq::{equal, not_equal}

///|
pub extend AssistantNotifyToggle with Debug::{to_repr}

///|
pub fn AssistantNotifyToggle::key(self : AssistantNotifyToggle) -> String {
  match self {
    Desktop => "notify.desktop"
    Sound => "notify.sound"
    MentionsOnly => "notify.mentions-only"
    Routines => "notify.routines"
    Channels => "notify.channels"
  }
}

///|
/// Snapshot of one assistant's notification settings.
pub(all) struct AssistantNotifySettings {
  assistant_id : String
  desktop : Bool
  sound : Bool
  mentions_only : Bool
  routines : Bool
  channels : Bool
} derive(Eq, Debug)

///|
pub extend AssistantNotifySettings with Eq::{equal, not_equal}

///|
pub extend AssistantNotifySettings with Debug::{to_repr}

///|
pub fn AssistantNotifySettings::defaults(
  assistant_id : String,
) -> AssistantNotifySettings {
  {
    assistant_id,
    desktop: true,
    sound: true,
    mentions_only: false,
    routines: true,
    channels: true,
  }
}

///|
pub fn AssistantNotifySettings::get(
  self : AssistantNotifySettings,
  toggle : AssistantNotifyToggle,
) -> Bool {
  match toggle {
    Desktop => self.desktop
    Sound => self.sound
    MentionsOnly => self.mentions_only
    Routines => self.routines
    Channels => self.channels
  }
}

///|
pub fn AssistantNotifySettings::with_toggle(
  self : AssistantNotifySettings,
  toggle : AssistantNotifyToggle,
  enabled : Bool,
) -> AssistantNotifySettings {
  match toggle {
    Desktop =>
      {
        assistant_id: self.assistant_id,
        desktop: enabled,
        sound: self.sound,
        mentions_only: self.mentions_only,
        routines: self.routines,
        channels: self.channels,
      }
    Sound =>
      {
        assistant_id: self.assistant_id,
        desktop: self.desktop,
        sound: enabled,
        mentions_only: self.mentions_only,
        routines: self.routines,
        channels: self.channels,
      }
    MentionsOnly =>
      {
        assistant_id: self.assistant_id,
        desktop: self.desktop,
        sound: self.sound,
        mentions_only: enabled,
        routines: self.routines,
        channels: self.channels,
      }
    Routines =>
      {
        assistant_id: self.assistant_id,
        desktop: self.desktop,
        sound: self.sound,
        mentions_only: self.mentions_only,
        routines: enabled,
        channels: self.channels,
      }
    Channels =>
      {
        assistant_id: self.assistant_id,
        desktop: self.desktop,
        sound: self.sound,
        mentions_only: self.mentions_only,
        routines: self.routines,
        channels: enabled,
      }
  }
}

///|
/// Profile-key form for memory/profile persistence (CM-0206).
pub fn AssistantNotifySettings::to_profile_entries(
  self : AssistantNotifySettings,
) -> Array[(String, String)] {
  let aid = self.assistant_id
  [
    (
      aid + "." + AssistantNotifyToggle::Desktop.key(),
      if self.desktop {
        "1"
      } else {
        "0"
      },
    ),
    (
      aid + "." + AssistantNotifyToggle::Sound.key(),
      if self.sound {
        "1"
      } else {
        "0"
      },
    ),
    (
      aid + "." + AssistantNotifyToggle::MentionsOnly.key(),
      if self.mentions_only {
        "1"
      } else {
        "0"
      },
    ),
    (
      aid + "." + AssistantNotifyToggle::Routines.key(),
      if self.routines {
        "1"
      } else {
        "0"
      },
    ),
    (
      aid + "." + AssistantNotifyToggle::Channels.key(),
      if self.channels {
        "1"
      } else {
        "0"
      },
    ),
  ]
}

///|
/// Host/kernel store: per-assistant notify settings (isolated by assistant_id).
pub(all) struct PerAssistantNotifyStore {
  by_assistant : Map[String, AssistantNotifySettings]
}

///|
pub fn PerAssistantNotifyStore::new() -> PerAssistantNotifyStore {
  { by_assistant: Map([]), }
}

///|
pub fn PerAssistantNotifyStore::get_or_defaults(
  self : PerAssistantNotifyStore,
  assistant_id : String,
) -> AssistantNotifySettings {
  match self.by_assistant.get(assistant_id) {
    Some(s) => s
    None => AssistantNotifySettings::defaults(assistant_id)
  }
}

///|
/// Set one toggle for one assistant; does not affect other assistants.
pub fn PerAssistantNotifyStore::set_toggle(
  self : PerAssistantNotifyStore,
  assistant_id : String,
  toggle : AssistantNotifyToggle,
  enabled : Bool,
) -> AssistantNotifySettings {
  let cur = self.get_or_defaults(assistant_id)
  let next = cur.with_toggle(toggle, enabled)
  self.by_assistant.set(assistant_id, next)
  next
}

///|
pub fn PerAssistantNotifyStore::is_assistant_scoped(
  self : PerAssistantNotifyStore,
  assistant_id : String,
) -> Bool {
  let s = self.get_or_defaults(assistant_id)
  s.assistant_id == assistant_id
}
