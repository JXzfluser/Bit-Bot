///|
/// CM-2167 / SKILL-05: SkillRef — stable reference with id + source + path.

///|
/// Stable filesystem-style path for a skill body under a source.
pub fn skill_ref_path(
  source : SkillSource,
  name : String,
  plugin_id~ : String? = None,
) -> String {
  match source {
    Managed => "/skills/managed/" + name + "/SKILL.md"
    User => "/skills/user/" + name + "/SKILL.md"
    Plugin => {
      let pid = match plugin_id {
        Some(p) => p
        None => "plugin"
      }
      "/skills/plugin/" + pid + "/" + name + "/SKILL.md"
    }
  }
}

///|
/// CM-2167: stable SkillRef — id + source + path (+ description).
pub(all) struct SkillRef {
  id : SkillId
  source : SkillSource
  path : String
  description : String
} derive(Eq, Debug)

///|
pub extend SkillRef with Eq::{equal, not_equal}

///|
pub extend SkillRef with Debug::{to_repr}

///|
pub fn SkillRef::new(
  id : SkillId,
  source : SkillSource,
  path : String,
  description~ : String = "",
) -> SkillRef {
  { id, source, path, description, }
}

///|
/// Build a stable SkillRef from resolved catalog entry.
pub fn SkillRef::from_resolved(
  resolved : ResolvedSkill,
  plugin_id~ : String? = None,
  description~ : String = "",
) -> SkillRef {
  let ns = match resolved.source {
    Managed => "managed"
    User => "user"
    Plugin => "plugin"
  }
  let id = { ns, name: resolved.name, }
  let path = skill_ref_path(resolved.source, resolved.name, plugin_id~)
  { id, source: resolved.source, path, description, }
}

///|
/// True when ref carries non-empty id (ns/name), source, and path.
pub fn SkillRef::is_stable(self : SkillRef) -> Bool {
  self.id.ns.length() > 0 &&
  self.id.name.length() > 0 &&
  self.path.length() > 0 &&
  self.path.has_prefix("/skills/")
}

///|
/// Resolve a named skill from the unified catalog into a stable SkillRef.
pub fn UnifiedCatalog::skill_ref(
  self : UnifiedCatalog,
  name : String,
) -> Result[SkillRef, String] {
  match self.resolve(name) {
    None => Err("unknown skill for SkillRef: " + name)
    Some(resolved) => {
      let mut plugin_id : String? = None
      let mut description = ""
      match resolved.source {
        User =>
          for s in self.user_skills {
            if s.name == name {
              description = s.description
              break
            }
          }
        Plugin =>
          for s in self.plugin_skills {
            if s.name == name {
              plugin_id = Some(s.plugin_id)
              description = s.description
              break
            }
          }
        Managed =>
          match self.managed.find(name) {
            Some(m) => description = m.description
            None => ()
          }
      }
      Ok(SkillRef::from_resolved(resolved, plugin_id~, description~))
    }
  }
}
