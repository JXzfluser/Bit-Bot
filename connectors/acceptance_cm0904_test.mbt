///|
/// CM-0904: InstallPlugin / add-connector — after install namespace usable.
test "acceptance_CM-0904_install_plugin_namespace_ready" {
  let reg = @connectors.PluginRegistry::seed_demo()
  assert_false(reg.namespace_usable("user-Slides"))
  assert_eq(reg.namespace_status("user-Slides"), @connectors.Unavailable)
  match reg.mcp_namespace_for("plugin-slides") {
    Some(ns) => assert_eq(ns, "user-Slides")
    None => fail("plugin-slides must declare mcp namespace")
  }
  // Before install — not usable.
  assert_false(reg.is_installed("plugin-slides"))
  match reg.install("plugin-slides") {
    Ok(specs) => assert_true(specs.length() >= 1)
    Err(e) => fail(e)
  }
  assert_true(reg.is_installed("plugin-slides"))
  assert_true(reg.namespace_usable("user-Slides"))
  assert_eq(reg.namespace_status("user-Slides"), @connectors.Ready)
  // add-connector alias also readies namespace.
  let reg2 = @connectors.PluginRegistry::seed_demo()
  match reg2.add_connector("plugin-calendar") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_true(reg2.namespace_usable("user-Calendar"))
  assert_eq(reg2.namespace_status("user-Calendar"), @connectors.Ready)
}
