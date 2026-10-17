///|
/// CM-2110: slides-executor skill — executor skill distinct from slides;
/// Read SKILL before task; not confused with slides.

///|
pub fn slides_executor_skill_name() -> String {
  "slides-executor"
}

///|
/// SKILL.md body for slides-executor (must be Read before performing a task).
pub fn slides_executor_skill_md() -> String {
  "# slides-executor\n\nExecutor skill for driving slide tooling and runbooks.\n\nDistinct from `slides` (deck production / office-pptx).\nRead this SKILL before the task; do not confuse with slides.\n"
}

///|
/// Path where slides-executor SKILL.md lives (directory distinct from slides).
pub fn slides_executor_skill_path() -> String {
  skill_ref_path(Managed, slides_executor_skill_name())
}

///|
/// Path where slides SKILL.md lives (for distinctness checks).
pub fn slides_skill_path() -> String {
  skill_ref_path(Managed, slides_skill_name())
}

///|
/// CM-2110: managed catalog entry for slides-executor (alongside slides).
pub fn slides_executor_managed_skill() -> ManagedSkill {
  {
    name: slides_executor_skill_name(),
    description: "Executor skill for slide tooling; distinct from slides deck production.",
    skill_md: slides_executor_skill_md(),
  }
}

///|
/// Seed a catalog that lists both slides and slides-executor as distinct skills.
pub fn ManagedCatalog::seed_with_slides_pair(self : ManagedCatalog) -> Unit {
  // slides (deck production) — align with CM-1807 name.
  self.skills.push({
    name: slides_skill_name(),
    description: "Produce openable pptx decks (office-pptx).",
    skill_md: "# slides\n\nProduce pptx decks. Not the slides-executor runbook.\n",
  })
  self.skills.push(slides_executor_managed_skill())
}

///|
/// True when executor and slides are distinct names, paths, and SKILL bodies.
pub fn slides_executor_distinct_from_slides() -> Bool {
  slides_executor_skill_name() != slides_skill_name() &&
  slides_executor_skill_path() != slides_skill_path() &&
  !slides_executor_skill_md().contains("# slides\n") &&
  slides_executor_skill_md().contains("slides-executor") &&
  slides_executor_skill_md().contains("Distinct from")
}

///|
/// CM-2110: Read SKILL before task — load slides-executor body; refuse if unread.
pub(all) struct SlidesExecutorContext {
  skill_name : String
  skill_md : String
  mut skill_read : Bool
}

///|
pub fn SlidesExecutorContext::new() -> SlidesExecutorContext {
  {
    skill_name: slides_executor_skill_name(),
    skill_md: slides_executor_skill_md(),
    skill_read: false,
  }
}

///|
/// Read SKILL.md before performing an executor task.
pub fn SlidesExecutorContext::read_skill_before_task(
  self : SlidesExecutorContext,
) -> Result[String, String] {
  if self.skill_name != slides_executor_skill_name() {
    return Err("slides-executor context name mismatch")
  }
  if self.skill_md.length() == 0 {
    return Err("slides-executor SKILL.md empty")
  }
  self.skill_read = true
  Ok(self.skill_md)
}

///|
/// Perform an executor task only after SKILL was Read; never as slides.
pub fn SlidesExecutorContext::run_executor_task(
  self : SlidesExecutorContext,
  task~ : String,
) -> Result[String, String] {
  if !self.skill_read {
    return Err("must Read slides-executor SKILL before task")
  }
  if task.length() == 0 {
    return Err("slides-executor task required")
  }
  // Guard: do not treat this as the slides deck-production skill.
  if self.skill_name == slides_skill_name() {
    return Err("confused with slides; use slides-executor")
  }
  Ok("slides-executor ran: " + task)
}

///|
/// Resolve which skill applies; must not confuse slides with slides-executor.
pub fn resolve_slides_family_skill(name : String) -> Result[String, String] {
  if name == slides_executor_skill_name() {
    Ok(slides_executor_skill_name())
  } else if name == slides_skill_name() || name == office_pptx_skill_name() {
    Ok(slides_skill_name())
  } else {
    Err("unknown slides-family skill: " + name)
  }
}
