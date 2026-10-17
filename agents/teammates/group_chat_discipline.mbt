///|
/// CM-2004: hidden [room] cue triggers group-chat-turns discipline.
/// Extends room turns (CM-1404) without modifying room_turn.mbt.

///|
/// Discipline rules activated when a [room "…"] cue is present.
pub(all) struct GroupChatDiscipline {
  room_name : String
  /// Cue was parsed from a hidden [room] prefix.
  cue_triggered : Bool
  /// Must not leak private-DM assumptions (CM-1404).
  forbids_private_assumptions : Bool
  /// Address the room collectively; no 1:1 tone.
  collective_address : Bool
  /// Do not treat the turn as a private DM.
  treat_as_private_dm : Bool
} derive(Eq, Debug)

///|
pub extend GroupChatDiscipline with Eq::{equal, not_equal}

///|
pub extend GroupChatDiscipline with Debug::{to_repr}

///|
pub fn GroupChatDiscipline::is_active(self : GroupChatDiscipline) -> Bool {
  self.cue_triggered &&
  self.forbids_private_assumptions &&
  self.collective_address &&
  !self.treat_as_private_dm
}

///|
/// Detect whether raw inbound text carries a hidden [room] cue.
pub fn has_room_cue(raw : String) -> Bool {
  raw.has_prefix("[room \"") || raw.contains("[room \"")
}

///|
/// CM-2004: parse hidden [room] cue → activate group-chat-turns discipline.
pub fn trigger_group_chat_discipline(
  cue_and_body~ : String,
) -> Result[GroupChatDiscipline, String] {
  match parse_room_cue(cue_and_body) {
    Err(e) => Err(e)
    Ok(room_name) =>
      Ok({
        room_name,
        cue_triggered: true,
        forbids_private_assumptions: true,
        collective_address: true,
        treat_as_private_dm: false,
      })
  }
}

///|
/// Apply discipline to a body: reject private-DM leaks; open a room turn.
pub fn apply_group_chat_discipline(
  cue_and_body~ : String,
  speaker_id~ : String,
) -> Result[(GroupChatDiscipline, RoomTurn), String] {
  match trigger_group_chat_discipline(cue_and_body~) {
    Err(e) => Err(e)
    Ok(disc) => {
      if !disc.is_active() {
        return Err("group-chat-turns discipline not active")
      }
      match open_room_turn_from_cue(cue_and_body~, speaker_id~) {
        Err(e) => Err(e)
        Ok(turn) => {
          if turn.is_private_dm() {
            return Err("room cue must not yield private DM")
          }
          if leaks_private_dm_assumption(turn.body) {
            return Err("group-chat-turns: private assumption leak")
          }
          Ok((disc, turn))
        }
      }
    }
  }
}

///|
pub fn group_chat_turns_skill_name() -> String {
  "group-chat-turns"
}
