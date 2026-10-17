///|
/// CM-1404: [room "…"] turns — no private-DM assumptions leaked.
/// Room turns follow group-chat-turns discipline.

///|
pub(all) struct RoomTurn {
  room_name : String
  speaker_id : String
  body : String
  /// True when this turn is tagged [room "…"] (group context).
  is_room : Bool
} derive(Eq, Debug)

///|
pub extend RoomTurn with Eq::{equal, not_equal}

///|
pub extend RoomTurn with Debug::{to_repr}

///|
/// Format the hidden cue tag for a room turn.
pub fn room_cue_tag(room_name : String) -> String {
  "[room \"" + room_name + "\"]"
}

///|
/// Parse room name from a leading [room "name"] cue.
pub fn parse_room_cue(raw : String) -> Result[String, String] {
  let prefix = "[room \""
  let suffix = "\"]"
  if !raw.has_prefix(prefix) {
    return Err("not a room cue")
  }
  let after = raw[prefix.length():].to_owned()
  if !after.contains(suffix) {
    return Err("malformed room cue")
  }
  let mut name = ""
  let mut i = 0
  while i + 2 <= after.length() {
    let two = after[i:i + 2].to_owned()
    if two == suffix {
      name = after[0:i].to_owned()
      break
    }
    i = i + 1
  }
  if name.length() == 0 {
    return Err("malformed room cue")
  }
  Ok(name)
}

///|
/// Private-DM assumption phrases that must not leak into room turns.
pub fn private_dm_assumption_phrases() -> Array[String] {
  [
    "just between us", "in our private chat", "this DM", "only you can see", "as we discussed privately",
  ]
}

///|
/// True when body leaks a private-DM assumption into a room turn.
pub fn leaks_private_dm_assumption(body : String) -> Bool {
  for p in private_dm_assumption_phrases() {
    if body.contains(p) {
      return true
    }
  }
  false
}

///|
/// Build a room turn; reject bodies that leak private-DM assumptions.
pub fn open_room_turn(
  room_name~ : String,
  speaker_id~ : String,
  body~ : String,
) -> Result[RoomTurn, String] {
  if room_name.length() == 0 {
    return Err("room name required")
  }
  if leaks_private_dm_assumption(body) {
    return Err("room turn must not leak private-DM assumptions")
  }
  Ok({ room_name, speaker_id, body, is_room: true, })
}

///|
/// Open from a raw cue prefix + body; cue must be [room "…"].
pub fn open_room_turn_from_cue(
  cue_and_body~ : String,
  speaker_id~ : String,
) -> Result[RoomTurn, String] {
  match parse_room_cue(cue_and_body) {
    Err(e) => Err(e)
    Ok(room_name) => {
      let tag = room_cue_tag(room_name)
      let body = if cue_and_body.has_prefix(tag) {
        cue_and_body[tag.length():].to_owned()
      } else {
        cue_and_body
      }
      open_room_turn(room_name~, speaker_id~, body~)
    }
  }
}

///|
/// Room turn is group context — never treat as private DM.
pub fn RoomTurn::is_private_dm(self : RoomTurn) -> Bool {
  let _ = self
  false
}
