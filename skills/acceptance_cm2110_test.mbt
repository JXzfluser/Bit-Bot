///|
/// CM-2110: slides-executor skill — executor distinct from slides; Read SKILL before task.
test "acceptance_CM-2110_slides_executor_skill_distinct_from_slides" {
  assert_eq(@skills.slides_executor_skill_name(), "slides-executor")
  assert_eq(@skills.slides_skill_name(), "slides")
  assert_true(@skills.slides_executor_distinct_from_slides())
  assert_true(
    @skills.slides_executor_skill_path() != @skills.slides_skill_path(),
  )
  assert_true(@skills.slides_executor_skill_path().contains("slides-executor"))
  assert_true(@skills.slides_skill_path().contains("/slides/"))
  // Catalog lists both; names not confused.
  let cat = @skills.ManagedCatalog::empty()
  cat.seed_with_slides_pair()
  assert_eq(cat.len(), 2)
  let mut slides_md = ""
  let mut exec_md = ""
  match cat.read_skill_md("slides-executor") {
    Err(e) => fail(e)
    Ok(md) => {
      assert_true(md.contains("slides-executor"))
      assert_true(md.contains("Distinct from") || md.contains("distinct"))
      exec_md = md
    }
  }
  match cat.read_skill_md("slides") {
    Err(e) => fail(e)
    Ok(md) => {
      assert_true(md.contains("slides") || md.contains("pptx"))
      slides_md = md
    }
  }
  assert_true(slides_md != exec_md)
  // Read SKILL before task.
  let ctx = @skills.SlidesExecutorContext::new()
  match ctx.run_executor_task(task="advance slide 2") {
    Err(m) => assert_true(m.contains("Read") || m.contains("SKILL"))
    Ok(_) => fail("must not run before Read SKILL")
  }
  match ctx.read_skill_before_task() {
    Err(e) => fail(e)
    Ok(md) => {
      assert_true(md.contains("slides-executor"))
      assert_true(md.length() > 0)
    }
  }
  match ctx.run_executor_task(task="advance slide 2") {
    Err(e) => fail(e)
    Ok(out) => {
      assert_true(out.contains("slides-executor"))
      assert_true(out.contains("advance slide 2"))
    }
  }
  // Resolver keeps families distinct.
  match @skills.resolve_slides_family_skill("slides-executor") {
    Ok(n) => assert_eq(n, "slides-executor")
    Err(e) => fail(e)
  }
  match @skills.resolve_slides_family_skill("slides") {
    Ok(n) => assert_eq(n, "slides")
    Err(e) => fail(e)
  }
  let mut exec_name = ""
  let mut slides_name = ""
  match @skills.resolve_slides_family_skill("slides-executor") {
    Ok(n) => exec_name = n
    Err(e) => fail(e)
  }
  match @skills.resolve_slides_family_skill("slides") {
    Ok(n) => slides_name = n
    Err(e) => fail(e)
  }
  assert_true(exec_name != slides_name)
}
