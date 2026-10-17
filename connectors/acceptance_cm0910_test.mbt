///|
/// CM-0910: public x search namespace — no user auth; search_posts etc readonly.
test "acceptance_CM-0910_public_x_search_namespace_readonly" {
  let ns = @connectors.XPublicSearchNamespace::new()
  assert_eq(ns.namespace_, @connectors.X_PUBLIC_NAMESPACE)
  assert_eq(ns.namespace_, "x")
  assert_false(ns.requires_user_auth())
  ns.seed_readonly_tools()
  assert_true(ns.all_tools_readonly())
  assert_true(ns.has_tool("search_posts"))
  assert_true(ns.has_tool("search_posts_all"))
  assert_true(ns.has_tool("get_posts_by_id"))
  assert_true(ns.has_tool("search_users"))
  assert_true(ns.has_tool("search_news"))
  let names = ns.list_tool_names()
  assert_true(names.length() >= 5)
  // No auth gate: search works immediately.
  ns.seed_post(id="pub1", text="moonbit public search demo")
  ns.seed_post(id="pub2", text="other topic")
  let hits = ns.search_posts("moonbit")
  assert_eq(hits.length(), 1)
  assert_eq(hits[0].0, "pub1")
  // Write tools refused on public namespace.
  match ns.reject_write_tool("send_chat_message") {
    Err(m) => assert_true(m.contains("readonly") || m.contains("refused"))
    Ok(_) => fail("write tool must be refused on public x")
  }
  match ns.reject_write_tool("search_posts") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  // Distinct from authenticated user-X (CM-0907).
  assert_true(ns.namespace_ != @connectors.USER_X_NAMESPACE)
}
