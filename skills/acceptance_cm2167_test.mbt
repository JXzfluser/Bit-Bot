///|
/// CM-2167: SkillRef stable reference — Given stable ref When acceptance Then id+source+path.
test "acceptance_CM-2167_skill_ref_stable_id_source_path" {
  let cat = @skills.UnifiedCatalog::with_managed(@skills.ManagedCatalog::seed())
  cat.add_user_skill(@skills.UserSkill::{
    name: "my-workflow",
    description: "user workflow skill",
    skill_md: "# my-workflow\n\nDo the thing.\n",
  })
  let plugin_skills : Array[@skills.PluginSkill] = []
  plugin_skills.push(@skills.PluginSkill::{
    plugin_id: "demo-plugin",
    name: "plugin-helper",
    description: "from plugin",
    skill_md: "# plugin-helper\n",
  })
  cat.install_plugin(plugin_id="demo-plugin", skills=plugin_skills)

  // Managed → id + source + path.
  match cat.skill_ref("routines") {
    Err(e) => fail(e)
    Ok(r) => {
      assert_true(r.is_stable())
      assert_eq(r.id.ns, "managed")
      assert_eq(r.id.name, "routines")
      assert_eq(r.source, @skills.SkillSource::Managed)
      assert_eq(r.path, "/skills/managed/routines/SKILL.md")
      assert_true(r.path.contains("routines"))
      assert_true(r.description.length() > 0)
    }
  }
  // User source path.
  match cat.skill_ref("my-workflow") {
    Err(e) => fail(e)
    Ok(r) => {
      assert_true(r.is_stable())
      assert_eq(r.id.ns, "user")
      assert_eq(r.source, @skills.SkillSource::User)
      assert_eq(r.path, "/skills/user/my-workflow/SKILL.md")
    }
  }
  // Plugin source path includes plugin id.
  match cat.skill_ref("plugin-helper") {
    Err(e) => fail(e)
    Ok(r) => {
      assert_true(r.is_stable())
      assert_eq(r.id.ns, "plugin")
      assert_eq(r.source, @skills.SkillSource::Plugin)
      assert_eq(r.path, "/skills/plugin/demo-plugin/plugin-helper/SKILL.md")
    }
  }
  // Direct constructor still stable.
  let id = @skills.SkillId::{ ns: "managed", name: "agent-email", }
  let direct = @skills.SkillRef::new(
    id,
    @skills.SkillSource::Managed,
    @skills.skill_ref_path(@skills.SkillSource::Managed, "agent-email"),
    description="Claim and manage Grok Bot email",
  )
  assert_true(direct.is_stable())
  assert_eq(direct.id.qualified(), "managed/agent-email")
}
