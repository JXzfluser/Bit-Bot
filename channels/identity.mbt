///|
/// CM-2168 / CHAN-04: channel identity — speak as the user; never third-person about the user.

///|
/// Acting identity when delivering on a channel (connector / send-on-behalf).
pub(all) struct ChannelSpeakAsUser {
  /// Canonical user handle / display name to speak as.
  user_handle : String
  /// Optional alternate display name (same person).
  display_name : String?
} derive(Eq, Debug)

///|
pub extend ChannelSpeakAsUser with Eq::{equal, not_equal}

///|
pub extend ChannelSpeakAsUser with Debug::{to_repr}

///|
pub fn ChannelSpeakAsUser::new(
  user_handle : String,
  display_name~ : String? = None,
) -> ChannelSpeakAsUser {
  { user_handle, display_name, }
}

///|
/// Third-person cues about the user that break speak-as-user identity.
pub fn is_third_person_about_user(
  body : String,
  identity : ChannelSpeakAsUser,
) -> Bool {
  let lower = body.to_lower()
  let handle = identity.user_handle.to_lower()
  // Generic third-person about "the user".
  if lower.contains("the user ") ||
    lower.contains("the user'") ||
    lower.contains("as the user") ||
    lower.contains("user wants") ||
    lower.contains("user said") ||
    lower.contains("user asked") ||
    lower.contains("they want you to") ||
    lower.contains("on behalf of the user") {
    return true
  }
  // Referring to the named user in third person (e.g. "Alice wants…").
  if handle.length() > 0 {
    if lower.contains(handle + " wants") ||
      lower.contains(handle + " said") ||
      lower.contains(handle + " asked") ||
      lower.contains(handle + " would like") {
      return true
    }
  }
  match identity.display_name {
    None => ()
    Some(dn) => {
      let d = dn.to_lower()
      if d.length() > 0 &&
        (
          lower.contains(d + " wants") ||
          lower.contains(d + " said") ||
          lower.contains(d + " asked")
        ) {
        return true
      }
    }
  }
  false
}

///|
/// Outcome of planning channel speech under speak-as-user identity.
pub(all) enum ChannelIdentitySpeech {
  SpeakAsUser(body~ : String)
  RejectThirdPerson(reason~ : String)
} derive(Eq, Debug)

///|
pub extend ChannelIdentitySpeech with Eq::{equal, not_equal}

///|
pub extend ChannelIdentitySpeech with Debug::{to_repr}

///|
pub fn ChannelIdentitySpeech::is_speak_as_user(
  self : ChannelIdentitySpeech,
) -> Bool {
  match self {
    SpeakAsUser(_) => true
    RejectThirdPerson(_) => false
  }
}

///|
/// CM-2168: Given speak-as-user When planning outbound Then reject third-person about the user.
pub fn plan_channel_speak_as_user(
  identity : ChannelSpeakAsUser,
  body~ : String,
) -> ChannelIdentitySpeech {
  if identity.user_handle.length() == 0 {
    return RejectThirdPerson(
      reason="speak-as-user requires non-empty user_handle",
    )
  }
  if body.length() == 0 {
    return RejectThirdPerson(reason="empty body")
  }
  if is_third_person_about_user(body, identity) {
    RejectThirdPerson(
      reason="channel identity: must speak as user, not third-person about the user",
    )
  } else {
    SpeakAsUser(body~)
  }
}

///|
/// Assert acceptance helper: Ok only when speech is first-person / as-user.
pub fn assert_not_third_person_about_user(
  identity : ChannelSpeakAsUser,
  body : String,
) -> Result[Unit, String] {
  match plan_channel_speak_as_user(identity, body~) {
    SpeakAsUser(_) => Ok(())
    RejectThirdPerson(reason~) => Err(reason)
  }
}
