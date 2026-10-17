///|
/// CM-0502: user skills catalog loadable; priority rules clear (User > Plugin > Managed).
test "acceptance_CM-0502_user_skills_load_with_priority" {
  let cat = @skills.UnifiedCatalog::with_managed(@skills.ManagedCatalog::seed())
  cat.add_user_skill(@skills.UserSkill::{
    name: "my-workflow",
    description: "User custom triage workflow.",
    skill_md: "# my-workflow\n\nUser authored steps.\n",
  })
  // Same name as managed "routines" — user wins.
  cat.add_user_skill(@skills.UserSkill::{
    name: "routines",
    description: "User override of routines skill.",
    skill_md: "# routines\n\nUSER_OVERRIDE_BODY\n",
  })
  let names = cat.list_user_names()
  assert_true(names.length() >= 2)
  match cat.read_user_skill_md("my-workflow") {
    Ok(body) =>
      assert_true(
        body.contains("User authored") || body.contains("my-workflow"),
      )
    Err(e) => fail(e)
  }
  assert_eq(@skills.skill_priority_rule(), "User > Plugin > Managed")
  assert_true(@skills.User.beats(@skills.Plugin))
  assert_true(@skills.Plugin.beats(@skills.Managed))
  assert_true(@skills.User.beats(@skills.Managed))
  match cat.resolve("routines") {
    Some(r) => {
      assert_eq(r.source, @skills.User)
      assert_true(r.skill_md.contains("USER_OVERRIDE_BODY"))
    }
    None => fail("routines must resolve")
  }
  match cat.resolve("agent-email") {
    Some(r) => assert_eq(r.source, @skills.Managed)
    None => fail("managed agent-email must resolve")
  }
  match cat.resolve("my-workflow") {
    Some(r) => assert_eq(r.source, @skills.User)
    None => fail("user skill must load")
  }
}

///|
/// CM-0503: plugin skills appear after plugin install (connectors + catalog).
test "acceptance_CM-0503_plugin_skills_appear_after_install" {
  let reg = @connectors.PluginRegistry::seed_demo()
  let cat = @skills.UnifiedCatalog::with_managed(@skills.ManagedCatalog::seed())
  // Before install — plugin skill absent.
  assert_false(cat.has_plugin_skill("slides-quickstart"))
  assert_false(reg.is_installed("plugin-slides"))
  match reg.install("plugin-slides") {
    Ok(specs) => {
      assert_true(specs.length() >= 1)
      let plugin_skills : Array[@skills.PluginSkill] = []
      for s in specs {
        plugin_skills.push(@skills.PluginSkill::{
          plugin_id: "plugin-slides",
          name: s.name,
          description: s.description,
          skill_md: s.skill_md,
        })
      }
      cat.install_plugin(plugin_id="plugin-slides", skills=plugin_skills)
    }
    Err(e) => fail(e)
  }
  assert_true(reg.is_installed("plugin-slides"))
  assert_true(cat.is_plugin_installed("plugin-slides"))
  assert_true(cat.has_plugin_skill("slides-quickstart"))
  let names = cat.list_plugin_skill_names()
  let mut saw = false
  for n in names {
    if n == "slides-quickstart" {
      saw = true
    }
  }
  assert_true(saw)
  match cat.resolve("slides-quickstart") {
    Some(r) => {
      assert_eq(r.source, @skills.Plugin)
      assert_true(r.skill_md.contains("slides") || r.skill_md.length() > 0)
    }
    None => fail("plugin skill must appear after install")
  }
}
