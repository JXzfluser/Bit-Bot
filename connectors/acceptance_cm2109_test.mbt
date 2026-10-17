///|
/// CM-2109: user-Finance connector — needsAuth; unauth cannot call; after auth usable.
test "acceptance_CM-2109_user_finance_connector_needs_auth" {
  let fin = @connectors.FinanceConnector::new()
  assert_eq(fin.namespace_, @connectors.USER_FINANCE_NAMESPACE)
  assert_eq(fin.namespace_, "user-Finance")
  assert_true(fin.is_needs_auth())
  assert_eq(fin.auth_status(), @connectors.NeedsAuth)
  assert_false(fin.is_usable())
  fin.seed_stub_tools()
  assert_true(fin.has_tool("list_accounts"))
  assert_true(fin.has_tool("get_balance"))
  assert_true(fin.has_tool("list_transactions"))
  assert_true(fin.list_tool_names().length() >= 3)
  // Unauth cannot call.
  match fin.call_tool(name="list_accounts") {
    Err(msg) =>
      assert_true(msg.contains("needsAuth") || msg.contains("unavailable"))
    Ok(_) => fail("list_accounts must fail while NeedsAuth")
  }
  match fin.call_tool(name="get_balance", account_id="acct-1") {
    Err(msg) =>
      assert_true(msg.contains("needsAuth") || msg.contains("unavailable"))
    Ok(_) => fail("get_balance must fail while NeedsAuth")
  }
  // After auth → usable (stub tool set; full set TBD).
  match fin.authenticate() {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_false(fin.is_needs_auth())
  assert_eq(fin.auth_status(), @connectors.Ready)
  assert_true(fin.is_usable())
  fin.seed_balance(account_id="acct-1", balance="42.50")
  match fin.call_tool(name="list_accounts") {
    Err(e) => fail(e)
    Ok(s) => assert_true(s.contains("acct-1"))
  }
  match fin.call_tool(name="get_balance", account_id="acct-1") {
    Err(e) => fail(e)
    Ok(b) => assert_eq(b, "42.50")
  }
  match fin.call_tool(name="list_transactions") {
    Err(e) => fail(e)
    Ok(_) => ()
  }
  // Wire into DynamicCatalog — namespace visible after seed.
  let cat = @tools.DynamicCatalog::empty()
  for t in fin.tools {
    cat.register(
      {
        namespace_: fin.namespace_,
        name: t.name,
        description: t.description,
        input_schema_json: "{\"type\":\"object\"}",
        truncated: false,
      },
      full_description=t.description,
    )
  }
  assert_true(cat.has_namespace("user-Finance"))
  let listed = cat.discover(ns=Some("user-Finance"))
  assert_eq(listed.length(), fin.list_tool_names().length())
}
