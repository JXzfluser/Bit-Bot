///|
test "disk_store_host_data_root_contract" {
  assert_eq(@stores.host_data_root(), "/workspace/data")
  assert_eq(@stores.host_chats_dir(), "/workspace/data/chats")
  assert_eq(@stores.host_memory_dir(), "/workspace/data/memory")
  assert_eq(@stores.host_journal_dir(), "/workspace/data/journal")
  assert_eq(@stores.host_routines_dir(), "/workspace/data/routines")
  assert_eq(@stores.host_connectors_dir(), "/workspace/data/connectors")
  assert_eq(@stores.host_audit_dir(), "/workspace/data/audit")
}

///|
test "disk_store_per_agent_paths" {
  assert_eq(
    @stores.disk_chat_path("demo-agent"),
    "/workspace/data/chats/demo-agent.json",
  )
  assert_eq(
    @stores.disk_memory_path("demo-agent"),
    "/workspace/data/memory/demo-agent.json",
  )
  assert_eq(
    @stores.disk_connector_path("slack"),
    "/workspace/data/connectors/slack.json",
  )
}

///|
test "disk_store_path_policy_under_workspace_data" {
  assert_true(@stores.is_host_data_path("/workspace/data"))
  assert_true(@stores.is_host_data_path("/workspace/data/chats/x.json"))
  assert_false(@stores.is_host_data_path("/tmp/evil"))
  assert_false(@stores.is_host_data_path("/workspace/other"))
  let c = @stores.DiskStoreContract::product_default()
  assert_eq(c.data_root, "/workspace/data")
  assert_true(c.accepts_path("/workspace/data/audit/20261017.jsonl"))
  assert_false(c.accepts_path("/etc/passwd"))
}
