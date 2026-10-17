///|
/// CM-2119: /cursor/stores/<id> — authorized readable; unauthorized path absent.
/// Aligns with CM-0609 StoreMountTable without breaking P.
test "acceptance_CM-2119_store_authorized_mount_unauthorized_absent" {
  let table = @stores.StoreMountTable::empty()
  let auth_id = "store-u-batch-authorized-001"
  let unauth_id = "store-u-batch-unauthorized-999"
  // Unauthorized — path absent.
  assert_false(table.path_exists(@stores.agent_store_mount_path(unauth_id)))
  assert_false(table.path_exists(@stores.agent_store_mount_path(auth_id)))
  match table.mount_path_if_authorized(unauth_id) {
    None => ()
    Some(_) => fail("unauthorized mount must be absent")
  }
  match table.read(unauth_id, "memo.txt") {
    Err(msg) =>
      assert_true(msg.contains("absent") || msg.contains("unauthorized"))
    Ok(_) => fail("unauthorized read must fail")
  }
  // Authorize → path exists and readable.
  let mounted = table.authorize(auth_id)
  assert_eq(mounted, "/cursor/stores/" + auth_id)
  assert_true(table.path_exists(mounted))
  match table.mount_path_if_authorized(auth_id) {
    Some(p) => assert_eq(p, mounted)
    None => fail("authorized store must expose mount")
  }
  match table.put_file(auth_id, "memo.txt", "u-batch-2119") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match table.read(auth_id, "memo.txt") {
    Ok(c) => assert_eq(c, "u-batch-2119")
    Err(e) => fail(e)
  }
  // Unauthorized stays absent after another id is authorized.
  assert_false(table.path_exists("/cursor/stores/" + unauth_id))
  match table.mount_path_if_authorized(unauth_id) {
    None => ()
    Some(_) => fail("unauthorized path must remain absent")
  }
}
