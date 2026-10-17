///|
/// CM-0303: shared memory — correct scope isolation; no cross-scope read.
test "acceptance_CM-0303_shared_memory_scope_isolation" {
  let store = @memory.SharedMemoryStore::new()
  let team_a = @memory.SharedScopeId::new("team-alpha")
  let team_b = @memory.SharedScopeId::new("team-beta")

  store.put(scope=team_a, key="sprint_goal", value="ship N-batch")
  store.put(scope=team_a, key="owner", value="alice")
  store.put(scope=team_b, key="sprint_goal", value="stabilize M-batch")
  store.put(scope=team_b, key="secret_note", value="beta-only")

  match store.read(scope=team_a, key="sprint_goal") {
    Ok(v) => assert_eq(v, "ship N-batch")
    Err(e) => fail(e)
  }
  match store.read(scope=team_b, key="sprint_goal") {
    Ok(v) => assert_eq(v, "stabilize M-batch")
    Err(e) => fail(e)
  }

  // Cross-scope: team_a must not see beta-only key.
  match store.cross_scope_read(from_scope=team_a, key="secret_note") {
    Err(msg) => {
      assert_true(msg.contains("cross-scope") || msg.contains("denied"))
      assert_true(msg.contains("secret_note") || msg.contains("team-alpha"))
    }
    Ok(_) => fail("cross-scope read of beta-only key must Err")
  }

  // Keys listed per scope only.
  let keys_a = store.keys_in_scope(scope=team_a)
  assert_eq(keys_a.length(), 2)
  let keys_b = store.keys_in_scope(scope=team_b)
  assert_eq(keys_b.length(), 2)
  let mut saw_secret_in_a = false
  for k in keys_a {
    if k == "secret_note" {
      saw_secret_in_a = true
    }
  }
  assert_false(saw_secret_in_a)

  assert_true(store.scopes_isolated(scope_a=team_a, scope_b=team_b))
}
