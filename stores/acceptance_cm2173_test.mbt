///|
/// CM-2173: Store R/W via ordinary file tools — Given R/W When acceptance Then path policy.
/// Aligns with StoreMountTable (CM-0609 / CM-2119); keep U/P store tests green.
test "acceptance_CM-2173_store_read_write_via_ordinary_file_tools" {
  let table = @stores.StoreMountTable::empty()
  let store_id = "store-x-batch-2173"
  let unauth = "store-x-batch-unauth"
  // Unauthorized path rejected by ordinary-tool path policy.
  match
    table.write_via_ordinary_tool(
      @stores.OrdinaryFileTool::Write,
      @stores.agent_store_mount_path(unauth) + "/note.txt",
      "nope",
    ) {
    @stores.Rejected(reason~) =>
      assert_true(
        reason.contains("unauthorized") || reason.contains("path policy"),
      )
    _ => fail("unauthorized write must reject")
  }
  // Authorize mount — same StoreMountTable as CM-0609/2119.
  let mounted = table.authorize(store_id)
  assert_eq(mounted, "/cursor/stores/" + store_id)
  let file_path = mounted + "/memo.txt"
  // Write via ordinary Write tool.
  match
    table.write_via_ordinary_tool(
      @stores.OrdinaryFileTool::Write,
      file_path,
      "x-batch-2173-body",
    ) {
    @stores.WriteOk(path~, tool~) => {
      assert_eq(path, file_path)
      assert_eq(tool, @stores.OrdinaryFileTool::Write)
      assert_true(tool.is_ordinary_file_tool())
      assert_eq(tool.name(), "Write")
    }
    @stores.ReadOk(_) => fail("write must WriteOk")
    @stores.Rejected(reason~) => fail(reason)
  }
  // Read via ordinary Read tool.
  match
    table.read_via_ordinary_tool(@stores.OrdinaryFileTool::Read, file_path) {
    @stores.ReadOk(path~, content~, tool~) => {
      assert_eq(path, file_path)
      assert_eq(content, "x-batch-2173-body")
      assert_eq(tool, @stores.OrdinaryFileTool::Read)
      assert_true(
        @stores.OrdinaryStoreIo::ReadOk(path~, content~, tool~).used_ordinary_tool(),
      )
    }
    @stores.WriteOk(_) => fail("read must ReadOk")
    @stores.Rejected(reason~) => fail(reason)
  }
  // Path policy: non-store path rejected.
  match
    table.read_via_ordinary_tool(
      @stores.OrdinaryFileTool::Read,
      "/workspace/not-a-store.txt",
    ) {
    @stores.Rejected(reason~) =>
      assert_true(
        reason.contains("path policy") || reason.contains("/cursor/stores"),
      )
    _ => fail("non-store path must reject")
  }
  // Wrong tool direction rejected.
  match
    table.read_via_ordinary_tool(@stores.OrdinaryFileTool::Write, file_path) {
    @stores.Rejected(reason~) => assert_true(reason.contains("Write"))
    _ => fail("Write cannot read")
  }
  // Underlying mount still readable via prior StoreMountTable::read (U/P compat).
  match table.read(store_id, "memo.txt") {
    Ok(c) => assert_eq(c, "x-batch-2173-body")
    Err(e) => fail(e)
  }
}
