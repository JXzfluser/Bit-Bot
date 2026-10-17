///|
/// CM-0506: skill-authoring meta-skill — produce compliant SKILL.md.

///|
pub fn skill_authoring_name() -> String {
  "skill-authoring"
}

///|
/// Minimal compliant SKILL.md frontmatter + body.
pub(all) struct SkillMdDraft {
  name : String
  description : String
  body : String
} derive(Eq, Debug)

///|
pub extend SkillMdDraft with Eq::{equal, not_equal}

///|
pub extend SkillMdDraft with Debug::{to_repr}

///|
/// Render compliant SKILL.md text (YAML frontmatter + markdown body).
pub fn SkillMdDraft::to_skill_md(self : SkillMdDraft) -> String {
  "---\n" +
  "name: " +
  self.name +
  "\n" +
  "description: " +
  self.description +
  "\n" +
  "---\n\n" +
  "# " +
  self.name +
  "\n\n" +
  self.body +
  "\n"
}

///|
/// CM-0506: validate SKILL.md compliance (frontmatter name/description + heading).
pub fn validate_skill_md(text : String) -> Result[Unit, String] {
  if !text.has_prefix("---\n") {
    return Err("SKILL.md must start with YAML frontmatter ---")
  }
  if !text.contains("name: ") {
    return Err("SKILL.md frontmatter missing name:")
  }
  if !text.contains("description: ") {
    return Err("SKILL.md frontmatter missing description:")
  }
  // Closing frontmatter fence.
  let rest = text[4:].to_owned()
  if !rest.contains("---\n") {
    return Err("SKILL.md frontmatter not closed")
  }
  if !text.contains("# ") {
    return Err("SKILL.md body must include a markdown heading")
  }
  // Extract name value crudely for non-empty check.
  let name_marker = "name: "
  let mut at = -1
  let last = text.length() - name_marker.length()
  if last >= 0 {
    for i = 0; i <= last; i = i + 1 {
      if text[i:i + name_marker.length()].to_owned() == name_marker {
        at = i
        break
      }
    }
  }
  if at < 0 {
    return Err("SKILL.md name: not found")
  }
  let from = at + name_marker.length()
  let mut end = from
  while end < text.length() {
    let ch = text[end:end + 1].to_owned()
    if ch == "\n" {
      break
    }
    end = end + 1
  }
  let name_val = text[from:end].to_owned().trim().to_owned()
  if name_val.length() == 0 {
    return Err("SKILL.md name must be non-empty")
  }
  Ok(())
}

///|
/// Meta-skill that authors a new user skill SKILL.md (CM-0506).
pub(all) struct SkillAuthoring {
  meta_skill_md : String
}

///|
pub fn SkillAuthoring::seed() -> SkillAuthoring {
  let meta = SkillMdDraft::{
    name: skill_authoring_name(),
    description: "Create and write compliant user skills as SKILL.md files.",
    body: "Use this meta-skill to draft name, description, and instructions.\nValidate with validate_skill_md before saving.",
  }
  { meta_skill_md: meta.to_skill_md(), }
}

///|
pub fn SkillAuthoring::meta_body(self : SkillAuthoring) -> String {
  self.meta_skill_md
}

///|
/// Produce a compliant SKILL.md for a new skill from authoring inputs.
pub fn SkillAuthoring::produce_skill_md(
  self : SkillAuthoring,
  name : String,
  description : String,
  instructions : String,
) -> Result[String, String] {
  let _ = self
  if name.length() == 0 {
    return Err("skill name must not be empty")
  }
  if description.length() == 0 {
    return Err("skill description must not be empty")
  }
  if instructions.length() == 0 {
    return Err("skill instructions must not be empty")
  }
  let draft = SkillMdDraft::{ name, description, body: instructions, }
  let text = draft.to_skill_md()
  match validate_skill_md(text) {
    Err(e) => Err(e)
    Ok(_) => Ok(text)
  }
}
