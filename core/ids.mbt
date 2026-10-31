///|
/// The identifiers the kernel hands across its own boundaries.
///
/// These used to be seven types (`TurnId`, `SessionId`, `UserId`,
/// `MachineId`, `RoutineId`, `SkillId`, `SubagentId`). Four of them had no
/// user at all: `MachineId`, `RoutineId`, `SkillId` and `SubagentId` were
/// declared, exported in the package interface, and never referenced
/// anywhere in the tree — the packages that own those concepts
/// (`routines`, `skills`, `agents`) each define their own. `SkillId` was
/// worse than dead: `core::SkillId` and `skills::SkillId` were two
/// different types with the same name, and `core::SessionId` and
/// `memory::SessionId` likewise — a trap for anyone reaching for "the" id
/// type.
///
/// A shared vocabulary only stays shared if it is actually the one people
/// use. Three types, all in use, is a vocabulary; seven with four decoys is
/// a naming collision.
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
