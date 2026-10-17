///|
/// CM-2107: UninstallPlugin — namespace gone from GetDynamicTools after uninstall.
test "acceptance_CM-2107_uninstall_plugin_namespace_gone" {
  let reg = @connectors.PluginRegistry::seed_demo()
  let cat = @tools.DynamicCatalog::empty()
  match reg.install("plugin-slides") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_true(reg.is_installed("plugin-slides"))
  assert_true(reg.namespace_usable("user-Slides"))
  match reg.mcp_namespace_for("plugin-slides") {
    Some(ns) => assert_eq(ns, "user-Slides")
    None => fail("mcp namespace required")
  }
  cat.register(
    {
      namespace_: "user-Slides",
      name: "make_deck",
      description: "Make a slide deck",
      input_schema_json: "{\"type\":\"object\"}",
      truncated: false,
    },
    full_description="Make a slide deck from an outline.",
  )
  assert_true(cat.has_namespace("user-Slides"))
  let listed = cat.discover(ns=Some("user-Slides"))
  assert_true(listed.length() >= 1)
  assert_true(cat.list_namespaces().length() >= 1)

  match reg.uninstall("plugin-slides") {
    Ok(ns) => assert_eq(ns, "user-Slides")
    Err(e) => fail(e)
  }
  assert_false(reg.is_installed("plugin-slides"))
  assert_false(reg.namespace_usable("user-Slides"))
  assert_eq(reg.namespace_status("user-Slides"), @connectors.Unavailable)
  let removed = cat.remove_namespace("user-Slides")
  assert_true(removed >= 1)
  assert_false(cat.has_namespace("user-Slides"))
  let after = cat.discover(ns=Some("user-Slides"))
  assert_eq(after.length(), 0)
  for ns in reg.ready_namespaces() {
    assert_false(ns == "user-Slides")
  }
}
