///|
/// CM-2145: Memory API is authoritative; box ordinary files are NOT authoritative for profile writes.
test "acceptance_CM-2145_memory_api_authoritative_not_box_file" {
  let store = @memory.ProfileMemoryStore::new()
  store.open_session(@memory.SessionId::{ value: "sess-2145", })
  // Memory API write succeeds and is authoritative.
  match
    store.write_profile_authoritative(
      @memory.MemoryApi,
      key="title",
      value="engineer",
    ) {
    Err(e) => fail(e)
    Ok(w) => {
      assert_true(w.source.is_authoritative())
      assert_eq(w.key, "title")
      assert_eq(w.value, "engineer")
    }
  }
  let recalled = store.recall_profile(key_prefix=Some("title"), limit=8)
  assert_true(recalled.length() >= 1)
  assert_eq(recalled[0].value, "engineer")
  // Box ordinary file is NOT authoritative — refuse profile write from it.
  let box_path = "/workspace/notes/profile-scratch.txt"
  assert_false(@memory.box_ordinary_file_is_profile_authority(box_path))
  match
    store.write_profile_authoritative(
      @memory.BoxOrdinaryFile(path=box_path),
      key="title",
      value="should-not-win",
    ) {
    Err(m) => {
      assert_true(
        m.contains("not authoritative") || m.contains("ordinary file"),
      )
      assert_true(m.contains(box_path) || m.contains("box"))
    }
    Ok(_) => fail("box ordinary file must not authoritatively write profile")
  }
  // Profile still holds Memory API value (box write did not apply).
  let again = store.recall_profile(key_prefix=Some("title"), limit=8)
  assert_eq(again[0].value, "engineer")
  match @memory.accept_profile_write_source(@memory.MemoryApi) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match
    @memory.accept_profile_write_source(
      @memory.BoxOrdinaryFile(path="/workspace/foo.md"),
    ) {
    Err(_) => ()
    Ok(_) => fail("box file source must be rejected")
  }
}
