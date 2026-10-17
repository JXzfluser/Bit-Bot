///|
/// CM-0501: managed skill entry with readable SKILL.md body.
pub(all) struct ManagedSkill {
  name : String
  description : String
  skill_md : String
} derive(Eq, Debug)

///|
pub extend ManagedSkill with Eq::{equal, not_equal}

///|
pub extend ManagedSkill with Debug::{to_repr}

///|
/// Managed skills catalog (system-hosted; always listable).
pub(all) struct ManagedCatalog {
  skills : Array[ManagedSkill]
}

///|
pub fn ManagedCatalog::empty() -> ManagedCatalog {
  { skills: [], }
}

///|
/// Seed representative managed skills (agent-email, routines, …).
pub fn ManagedCatalog::seed() -> ManagedCatalog {
  let cat = ManagedCatalog::empty()
  cat.skills.push({
    name: "agent-email",
    description: "Claim and manage Grok Bot email inboxes; draft and search mail.",
    skill_md: "# agent-email\n\nUse ListEmailInboxes / ClaimEmailInbox / DraftExternalMessage.\n",
  })
  cat.skills.push({
    name: "routines",
    description: "Create and manage scheduled routines with cron and timezone.",
    skill_md: "# routines\n\nUse CreateRoutine / ValidateCron / PauseResume.\n",
  })
  cat.skills.push({
    name: "source-control",
    description: "Git commit, branch, and pull-request workflows on the box.",
    skill_md: "# source-control\n\nPrefer origin PR tools; never force-push without confirmation.\n",
  })
  cat
}

///|
/// CM-0501: list all managed skill names.
pub fn ManagedCatalog::list_names(self : ManagedCatalog) -> Array[String] {
  let out : Array[String] = []
  for s in self.skills {
    out.push(s.name)
  }
  out
}

///|
/// CM-0501: SKILL.md body readable by name.
pub fn ManagedCatalog::read_skill_md(
  self : ManagedCatalog,
  name : String,
) -> Result[String, String] {
  for s in self.skills {
    if s.name == name {
      return Ok(s.skill_md)
    }
  }
  Err("unknown managed skill: " + name)
}

///|
pub fn ManagedCatalog::find(
  self : ManagedCatalog,
  name : String,
) -> ManagedSkill? {
  for s in self.skills {
    if s.name == name {
      return Some(s)
    }
  }
  None
}

///|
pub fn ManagedCatalog::len(self : ManagedCatalog) -> Int32 {
  self.skills.length()
}

///|
/// CM-0502 / CM-0503: skill source used for priority ranking.
pub(all) enum SkillSource {
  Managed
  User
  Plugin
} derive(Eq, Debug)

///|
pub extend SkillSource with Eq::{equal, not_equal}

///|
pub extend SkillSource with Debug::{to_repr}

///|
/// Priority rank: higher wins. User(3) > Plugin(2) > Managed(1).
pub fn SkillSource::priority_rank(self : SkillSource) -> Int32 {
  match self {
    User => 3
    Plugin => 2
    Managed => 1
  }
}

///|
/// CM-0502: user-authored skill entry.
pub(all) struct UserSkill {
  name : String
  description : String
  skill_md : String
} derive(Eq, Debug)

///|
pub extend UserSkill with Eq::{equal, not_equal}

///|
pub extend UserSkill with Debug::{to_repr}

///|
/// CM-0503: plugin-bundled skill entry.
pub(all) struct PluginSkill {
  plugin_id : String
  name : String
  description : String
  skill_md : String
} derive(Eq, Debug)

///|
pub extend PluginSkill with Eq::{equal, not_equal}

///|
pub extend PluginSkill with Debug::{to_repr}

///|
/// Unified catalog: managed + user + plugin with clear priority.
pub(all) struct UnifiedCatalog {
  managed : ManagedCatalog
  user_skills : Array[UserSkill]
  plugin_skills : Array[PluginSkill]
  /// Installed plugin ids (CM-0503).
  installed_plugins : Array[String]
}

///|
pub fn UnifiedCatalog::empty() -> UnifiedCatalog {
  {
    managed: ManagedCatalog::empty(),
    user_skills: [],
    plugin_skills: [],
    installed_plugins: [],
  }
}

///|
pub fn UnifiedCatalog::with_managed(managed : ManagedCatalog) -> UnifiedCatalog {
  { managed, user_skills: [], plugin_skills: [], installed_plugins: [], }
}

///|
/// CM-0502: register / load a user skill.
pub fn UnifiedCatalog::add_user_skill(
  self : UnifiedCatalog,
  skill : UserSkill,
) -> Unit {
  // Replace existing same name.
  let mut i = 0
  while i < self.user_skills.length() {
    if self.user_skills[i].name == skill.name {
      self.user_skills[i] = skill
      return
    }
    i = i + 1
  }
  self.user_skills.push(skill)
}

///|
/// CM-0502: user skills catalog loadable.
pub fn UnifiedCatalog::list_user_names(self : UnifiedCatalog) -> Array[String] {
  let out : Array[String] = []
  for s in self.user_skills {
    out.push(s.name)
  }
  out
}

///|
pub fn UnifiedCatalog::read_user_skill_md(
  self : UnifiedCatalog,
  name : String,
) -> Result[String, String] {
  for s in self.user_skills {
    if s.name == name {
      return Ok(s.skill_md)
    }
  }
  Err("unknown user skill: " + name)
}

///|
/// CM-0503: install a plugin — its skills appear afterwards.
pub fn UnifiedCatalog::install_plugin(
  self : UnifiedCatalog,
  plugin_id~ : String,
  skills~ : Array[PluginSkill],
) -> Unit {
  // Mark installed.
  let mut already = false
  for p in self.installed_plugins {
    if p == plugin_id {
      already = true
      break
    }
  }
  if !already {
    self.installed_plugins.push(plugin_id)
  }
  for s in skills {
    // Replace same plugin+name if present.
    let mut replaced = false
    let mut i = 0
    while i < self.plugin_skills.length() {
      if self.plugin_skills[i].plugin_id == s.plugin_id &&
        self.plugin_skills[i].name == s.name {
        self.plugin_skills[i] = s
        replaced = true
        break
      }
      i = i + 1
    }
    if !replaced {
      self.plugin_skills.push(s)
    }
  }
}

///|
pub fn UnifiedCatalog::is_plugin_installed(
  self : UnifiedCatalog,
  plugin_id : String,
) -> Bool {
  for p in self.installed_plugins {
    if p == plugin_id {
      return true
    }
  }
  false
}

///|
/// CM-0503: plugin skill names visible after install.
pub fn UnifiedCatalog::list_plugin_skill_names(
  self : UnifiedCatalog,
) -> Array[String] {
  let out : Array[String] = []
  for s in self.plugin_skills {
    out.push(s.name)
  }
  out
}

///|
pub fn UnifiedCatalog::has_plugin_skill(
  self : UnifiedCatalog,
  name : String,
) -> Bool {
  for s in self.plugin_skills {
    if s.name == name {
      return true
    }
  }
  false
}

///|
/// Resolved skill body + winning source (CM-0502 priority rules).
pub(all) struct ResolvedSkill {
  name : String
  source : SkillSource
  skill_md : String
} derive(Eq, Debug)

///|
pub extend ResolvedSkill with Eq::{equal, not_equal}

///|
pub extend ResolvedSkill with Debug::{to_repr}

///|
/// CM-0502: resolve by name with User > Plugin > Managed priority.
pub fn UnifiedCatalog::resolve(
  self : UnifiedCatalog,
  name : String,
) -> ResolvedSkill? {
  for s in self.user_skills {
    if s.name == name {
      return Some({ name, source: User, skill_md: s.skill_md, })
    }
  }
  for s in self.plugin_skills {
    if s.name == name {
      return Some({ name, source: Plugin, skill_md: s.skill_md, })
    }
  }
  match self.managed.find(name) {
    Some(m) => Some({ name, source: Managed, skill_md: m.skill_md, })
    None => None
  }
}

///|
/// Documented priority rule string for acceptance.
pub fn skill_priority_rule() -> String {
  "User > Plugin > Managed"
}

///|
pub fn SkillSource::beats(self : SkillSource, other : SkillSource) -> Bool {
  self.priority_rank() > other.priority_rank()
}

///|
/// CM-0505: UpdateSkill — rewrite a writable (user) skill body.
/// Managed skills are not writable via UpdateSkill.
pub fn UnifiedCatalog::update_skill(
  self : UnifiedCatalog,
  name : String,
  new_body : String,
) -> Result[Unit, String] {
  let mut i = 0
  while i < self.user_skills.length() {
    if self.user_skills[i].name == name {
      let old = self.user_skills[i]
      self.user_skills[i] = {
        name: old.name,
        description: old.description,
        skill_md: new_body,
      }
      return Ok(())
    }
    i = i + 1
  }
  Err("UpdateSkill: not a writable user skill: " + name)
}

///|
/// CM-0505: body that the next trigger / resolve will use.
pub fn UnifiedCatalog::next_trigger_body(
  self : UnifiedCatalog,
  name : String,
) -> Result[String, String] {
  match self.resolve(name) {
    Some(r) => Ok(r.skill_md)
    None => Err("unknown skill for trigger: " + name)
  }
}
