///|
/// CM-0504: on-demand skill context — only matching skills are Read in.
pub(all) struct SkillContext {
  loaded_names : Array[String]
  bodies : Map[String, String]
}

///|
pub fn SkillContext::empty() -> SkillContext {
  { loaded_names: [], bodies: Map([]), }
}

///|
pub fn SkillContext::contains(self : SkillContext, name : String) -> Bool {
  for n in self.loaded_names {
    if n == name {
      return true
    }
  }
  false
}

///|
pub fn SkillContext::loaded_count(self : SkillContext) -> Int32 {
  self.loaded_names.length()
}

///|
fn is_sep_code(c : UInt16) -> Bool {
  c == ' ' ||
  c == '\t' ||
  c == '\n' ||
  c == ',' ||
  c == '.' ||
  c == ';' ||
  c == ':' ||
  c == '/' ||
  c == '-'
}

///|
fn tokenize(s : String) -> Array[String] {
  let out : Array[String] = []
  let mut start = -1
  let mut i = 0
  while i < s.length() {
    let c = s[i]
    if is_sep_code(c) {
      if start >= 0 {
        out.push(s[start:i].to_owned())
        start = -1
      }
    } else if start < 0 {
      start = i
    }
    i = i + 1
  }
  if start >= 0 {
    out.push(s[start:].to_owned())
  }
  out
}

///|
/// Description matches task when they share a significant (>=4 char) token.
fn description_matches(description : String, task : String) -> Bool {
  let desc = description.to_lower()
  let tokens = tokenize(task.to_lower())
  for tok in tokens {
    if tok.length() < 4 {
      continue
    }
    if desc.contains(tok) {
      return true
    }
  }
  false
}

///|
/// On-demand loader: only skills whose description matches the task enter context.
/// Unrelated skills are NOT Read / NOT present in context (CM-0504).
pub(all) struct SkillRunner {
  catalog : ManagedCatalog
}

///|
pub fn SkillRunner::new(catalog : ManagedCatalog) -> SkillRunner {
  { catalog, }
}

///|
pub fn SkillRunner::load_for_task(
  self : SkillRunner,
  task_desc : String,
) -> SkillContext {
  let ctx = SkillContext::empty()
  for s in self.catalog.skills {
    if description_matches(s.description, task_desc) {
      ctx.loaded_names.push(s.name)
      ctx.bodies.set(s.name, s.skill_md)
    }
  }
  ctx
}
