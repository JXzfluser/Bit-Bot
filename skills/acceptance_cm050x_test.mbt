///|
/// CM-0501: list all managed skill names; SKILL.md body readable.
test "acceptance_CM-0501_managed_skills_catalog_readable" {
  let cat = @skills.ManagedCatalog::seed()
  let names = cat.list_names()
  assert_true(names.length() >= 3)
  let mut saw_email = false
  let mut saw_routines = false
  for n in names {
    if n == "agent-email" {
      saw_email = true
    }
    if n == "routines" {
      saw_routines = true
    }
  }
  assert_true(saw_email)
  assert_true(saw_routines)

  match cat.read_skill_md("agent-email") {
    Ok(body) => {
      assert_true(body.contains("agent-email") || body.contains("# "))
      assert_true(body.length() > 0)
    }
    Err(e) => fail(e)
  }
  match cat.read_skill_md("routines") {
    Ok(body) => assert_true(body.contains("routines") || body.length() > 0)
    Err(e) => fail(e)
  }
  match cat.read_skill_md("no-such-skill") {
    Err(_) => ()
    Ok(_) => fail("unknown skill must Err")
  }
}

///|
/// CM-0504: only matching skill Read into context; unrelated NOT in context.
test "acceptance_CM-0504_ondemand_skill_read_no_preload" {
  let cat = @skills.ManagedCatalog::seed()
  let runner = @skills.SkillRunner::new(cat)

  // Task about email → agent-email loaded; routines / source-control absent.
  let ctx = runner.load_for_task("help me claim an email inbox and draft mail")
  assert_true(ctx.contains("agent-email"))
  assert_false(ctx.contains("routines"))
  assert_false(ctx.contains("source-control"))
  assert_true(ctx.loaded_count() >= 1)
  match ctx.bodies.get("agent-email") {
    Some(body) => assert_true(body.length() > 0)
    None => fail("matched skill body must be Read into context")
  }

  // Task about cron/schedule → routines; agent-email absent.
  let ctx2 = runner.load_for_task(
    "create a scheduled cron routine with timezone",
  )
  assert_true(ctx2.contains("routines"))
  assert_false(ctx2.contains("agent-email"))
  assert_false(ctx2.contains("source-control"))

  // Unrelated task → no preload of all skills.
  let ctx3 = runner.load_for_task("what is the weather today")
  assert_false(ctx3.contains("agent-email"))
  assert_false(ctx3.contains("routines"))
  assert_false(ctx3.contains("source-control"))
  assert_eq(ctx3.loaded_count(), 0)
}
