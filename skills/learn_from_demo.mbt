///|
/// CM-1808: learn-from-demonstration — crystallize into skill draft.

///|
pub fn learn_from_demonstration_skill_name() -> String {
  "learn-from-demonstration"
}

///|
/// One observed demonstration step (UI / tool / narration).
pub(all) struct DemoStep {
  kind : String
  detail : String
} derive(Eq, Debug)

///|
pub extend DemoStep with Eq::{equal, not_equal}

///|
pub extend DemoStep with Debug::{to_repr}

///|
/// Recorded demonstration session.
pub(all) struct Demonstration {
  title : String
  steps : Array[DemoStep]
} derive(Eq, Debug)

///|
pub extend Demonstration with Eq::{equal, not_equal}

///|
pub extend Demonstration with Debug::{to_repr}

///|
pub fn Demonstration::of(
  title~ : String,
  steps~ : Array[DemoStep],
) -> Demonstration {
  { title, steps, }
}

///|
/// CM-1808: crystallize a demonstration into a skill draft (SKILL.md-shaped).
pub fn crystallize_demonstration_to_skill_draft(
  demo : Demonstration,
  skill_name~ : String = "",
) -> Result[SkillMdDraft, String] {
  if demo.steps.length() == 0 {
    return Err("learn-from-demonstration requires at least one step")
  }
  if demo.title.length() == 0 {
    return Err("demonstration title must not be empty")
  }
  let name = if skill_name.length() > 0 {
    skill_name
  } else {
    "learned-" +
    demo.title.to_lower().replace(old=" ", new="-").replace(old="/", new="-")
  }
  if name.length() == 0 {
    return Err("skill name must not be empty")
  }
  let sb = StringBuilder()
  sb.write_string("Learned from demonstration: ")
  sb.write_string(demo.title)
  sb.write_string("\n\n## Steps\n")
  let mut i = 1
  for step in demo.steps {
    sb.write_string(i.to_string())
    sb.write_string(". [")
    sb.write_string(step.kind)
    sb.write_string("] ")
    sb.write_string(step.detail)
    sb.write_string("\n")
    i = i + 1
  }
  sb.write_string("\nFollow these steps; stop before irreversible actions.\n")
  let draft = SkillMdDraft::{
    name,
    description: "Skill crystallized from demonstration: " + demo.title,
    body: sb.to_string(),
  }
  // Validate via skill-authoring compliance (CM-0506 contract reused).
  match validate_skill_md(draft.to_skill_md()) {
    Err(e) => Err(e)
    Ok(_) => Ok(draft)
  }
}

///|
/// Produce SKILL.md text from a demonstration (draft artifact).
pub fn Demonstration::to_skill_md_draft(
  self : Demonstration,
  skill_name~ : String = "",
) -> Result[String, String] {
  match crystallize_demonstration_to_skill_draft(self, skill_name~) {
    Err(e) => Err(e)
    Ok(d) => Ok(d.to_skill_md())
  }
}
