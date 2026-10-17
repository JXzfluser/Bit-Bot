///|
/// CM-0907: X/Twitter MCP surface — posts/bookmarks/chat dynamic tools;
/// GetDynamicTools lists; read path testable. Kernel-contract mock.
test "acceptance_CM-0907_x_twitter_mcp_surface_dynamic_tools" {
  let surf = @connectors.XTwitterMcpSurface::new()
  assert_eq(surf.namespace_, @connectors.USER_X_NAMESPACE)
  assert_eq(surf.namespace_, "user-X")
  surf.seed_dynamic_tools()
  assert_true(surf.covers_posts_bookmarks_chat())
  let names = surf.list_tool_names()
  assert_true(names.length() >= 6)
  assert_true(surf.has_tool("get_users_posts"))
  assert_true(surf.has_tool("get_posts_by_id"))
  assert_true(surf.has_tool("get_users_bookmarks"))
  assert_true(surf.has_tool("create_users_bookmark"))
  assert_true(surf.has_tool("get_chat_conversations"))
  assert_true(surf.has_tool("send_chat_message"))
  // Wire into DynamicCatalog — GetDynamicTools lists user-X tools.
  let cat = @tools.DynamicCatalog::empty()
  for t in surf.tools {
    cat.register(
      {
        namespace_: surf.namespace_,
        name: t.name,
        description: t.description,
        input_schema_json: "{\"type\":\"object\"}",
        truncated: false,
      },
      full_description=t.description,
    )
  }
  assert_true(cat.has_namespace("user-X"))
  let listed = cat.discover(ns=Some("user-X"))
  assert_eq(listed.length(), names.length())
  // Read path testable after auth.
  surf.seed_post(id="p1", text="hello from x")
  surf.seed_bookmark("p1")
  surf.seed_chat_thread("c1")
  match surf.read_post("p1") {
    Err(m) => assert_true(m.contains("auth"))
    Ok(_) => fail("read before auth must Err")
  }
  surf.authenticate()
  assert_true(surf.is_authenticated())
  match surf.read_post("p1") {
    Ok(text) => assert_eq(text, "hello from x")
    Err(e) => fail(e)
  }
  match surf.read_bookmarks() {
    Ok(b) => {
      assert_eq(b.length(), 1)
      assert_eq(b[0], "p1")
    }
    Err(e) => fail(e)
  }
  match surf.read_chat_conversations() {
    Ok(c) => {
      assert_eq(c.length(), 1)
      assert_eq(c[0], "c1")
    }
    Err(e) => fail(e)
  }
}
