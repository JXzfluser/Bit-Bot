///|
pub(all) struct TurnId {
  value : String
} derive(Eq, Debug)

///|
pub extend TurnId with Eq::{equal, not_equal}

///|
pub extend TurnId with Debug::{to_repr}

///|
pub(all) struct SessionId {
  value : String
} derive(Eq, Debug)

///|
pub extend SessionId with Eq::{equal, not_equal}

///|
pub extend SessionId with Debug::{to_repr}

///|
pub(all) struct UserId {
  value : String
} derive(Eq, Debug)

///|
pub extend UserId with Eq::{equal, not_equal}

///|
pub extend UserId with Debug::{to_repr}

///|
pub(all) struct MachineId {
  value : String
} derive(Eq, Debug)

///|
pub extend MachineId with Eq::{equal, not_equal}

///|
pub extend MachineId with Debug::{to_repr}

///|
pub(all) struct RoutineId {
  value : String
} derive(Eq, Debug)

///|
pub extend RoutineId with Eq::{equal, not_equal}

///|
pub extend RoutineId with Debug::{to_repr}

///|
pub(all) struct SkillId {
  value : String
} derive(Eq, Debug)

///|
pub extend SkillId with Eq::{equal, not_equal}

///|
pub extend SkillId with Debug::{to_repr}

///|
pub(all) struct SubagentId {
  value : String
} derive(Eq, Debug)

///|
pub extend SubagentId with Eq::{equal, not_equal}

///|
pub extend SubagentId with Debug::{to_repr}

///|
pub fn TurnId::new(value : String) -> TurnId {
  { value, }
}

///|
pub fn SessionId::new(value : String) -> SessionId {
  { value, }
}

///|
pub fn UserId::new(value : String) -> UserId {
  { value, }
}
