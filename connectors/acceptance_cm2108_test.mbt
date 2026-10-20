///|
/// CM-2108: GetPlugin — returns id + skills list.
test "acceptance_CM-2108_get_plugin_metadata_and_skills" {
  let reg = @connectors.PluginRegistry::seed_demo()
  match reg.get_plugin("plugin-slides") {
    Err(e) => fail(e)
    Ok(meta) => {
      assert_eq(meta.id, "plugin-slides")
      assert_true(meta.display_name.length() > 0)
      assert_true(meta.skills.length() >= 1)
      let names = meta.skill_names()
      let mut saw = false
      for n in names {
        if n == "slides-quickstart" {
          saw = true
        }
      }
      assert_true(saw)
      assert_eq(meta.mcp_namespace, "user-Slides")
    }
  }
  match reg.get_plugin("plugin-calendar") {
    Err(e) => fail(e)
    Ok(meta) => {
      assert_eq(meta.id, "plugin-calendar")
      assert_true(meta.skills.length() >= 1)
      assert_eq(meta.skill_names()[0], "calendar-sync")
    }
  }
  match reg.get_plugin("plugin-does-not-exist") {
    Err(msg) => assert_true(msg.contains("unknown"))
    Ok(_) => fail("unknown plugin must Err")
  }
  // GP-A3: declared MCP tools ride along in metadata.
  match reg.get_plugin("plugin-slides") {
    Err(e) => fail(e)
    Ok(meta) => {
      let tools = meta.tool_names()
      assert_true(tools.length() >= 2)
      let mut saw_deck = false
      for t in tools {
        if t == "make_deck" {
          saw_deck = true
        }
      }
      assert_true(saw_deck)
    }
  }
}
