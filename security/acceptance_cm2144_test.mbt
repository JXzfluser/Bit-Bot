///|
/// CM-2144: standing permission revoke immediate — Given prior direct-send grant When revoked Then next message needs reconfirm.
test "acceptance_CM-2144_standing_permission_revoke_immediate" {
  let table = @security.StandingPermissionTable::new()
  let g = table.grant_direct_send(id="stand-mail-1", channel="email")
  assert_true(g.active)
  assert_true(table.is_active("stand-mail-1"))
  // While granted → may direct-send.
  match table.attempt_direct_send(grant_id="stand-mail-1", channel="email") {
    @security.AllowedStanding(grant_id~) => assert_eq(grant_id, "stand-mail-1")
    @security.NeedReconfirm(_) => fail("active grant must allow direct-send")
  }
  // Revoke → immediate.
  match table.revoke("stand-mail-1") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_false(table.is_active("stand-mail-1"))
  // Next message needs reconfirm.
  match table.attempt_direct_send(grant_id="stand-mail-1", channel="email") {
    @security.NeedReconfirm(reason~) => {
      assert_true(reason.contains("revoked") || reason.contains("reconfirm"))
      assert_true(
        @security.DirectSendAttempt::NeedReconfirm(reason~).needs_reconfirm(),
      )
    }
    @security.AllowedStanding(_) =>
      fail("after revoke next message must need reconfirm")
  }
}
