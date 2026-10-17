///|
/// CM-0609: /cursor/stores/<id> — authorized readable; unauthorized path absent.
test "acceptance_CM-0609_agent_store_authorized_mount" {
  let table = @stores.StoreMountTable::empty()
  let auth_id = "store-7fa00fec-50c8-4b27-ac76-873cf29fbdca"
  let unauth_id = "store-unauthorized-deadbeef"
  // Before authorize — path absent.
  assert_false(table.path_exists("/cursor/stores/" + auth_id))
  match table.mount_path_if_authorized(auth_id) {
    None => ()
    Some(_) => fail("unauthorized mount must be absent")
  }
  match table.read(auth_id, "notes.txt") {
    Err(msg) =>
      assert_true(msg.contains("absent") || msg.contains("unauthorized"))
    Ok(_) => fail("read before authorize must fail")
  }
  // Authorize → path exists and readable.
  let mounted = table.authorize(auth_id)
  assert_eq(mounted, "/cursor/stores/" + auth_id)
  assert_true(table.path_exists(mounted))
  assert_true(table.path_exists(mounted + "/notes.txt"))
  match table.mount_path_if_authorized(auth_id) {
    Some(p) => assert_eq(p, mounted)
    None => fail("authorized store must expose mount path")
  }
  match table.put_file(auth_id, "notes.txt", "hello-store-0609") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match table.read(auth_id, "notes.txt") {
    Ok(c) => assert_eq(c, "hello-store-0609")
    Err(e) => fail(e)
  }
  // Unauthorized id — path still absent.
  assert_false(table.path_exists("/cursor/stores/" + unauth_id))
  match table.mount_path_if_authorized(unauth_id) {
    None => ()
    Some(_) => fail("unauthorized path must not exist")
  }
}
