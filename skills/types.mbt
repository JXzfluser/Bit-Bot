///|
pub(all) struct SkillId {
  ns : String
  name : String
} derive(Eq, Debug)

///|
pub extend SkillId with Eq::{not_equal, equal}

///|
pub extend SkillId with Debug::{to_repr}

///|
pub fn SkillId::qualified(self : SkillId) -> String {
  self.ns + "/" + self.name
}

///|
pub(all) struct SkillMeta {
  id : SkillId
  description : String
  enabled : Bool
} derive(Eq, Debug)

///|
pub extend SkillMeta with Eq::{not_equal, equal}

///|
pub extend SkillMeta with Debug::{to_repr}

///|
pub(all) struct SkillCatalog {
  skills : Array[SkillMeta]
} derive(Eq, Debug)

///|
pub extend SkillCatalog with Eq::{not_equal, equal}

///|
pub extend SkillCatalog with Debug::{to_repr}

///|
pub fn SkillCatalog::empty() -> SkillCatalog {
  { skills: [], }
}

///|
pub fn SkillCatalog::register(self : SkillCatalog, skill : SkillMeta) -> Unit {
  self.skills.push(skill)
}

///|
pub fn SkillCatalog::len(self : SkillCatalog) -> Int32 {
  self.skills.length()
}

///|
pub fn SkillCatalog::find(self : SkillCatalog, id : SkillId) -> SkillMeta? {
  for s in self.skills {
    if s.id == id {
      return Some(s)
    }
  }
  None
}
