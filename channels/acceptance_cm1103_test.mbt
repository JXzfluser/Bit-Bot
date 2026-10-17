///|
/// CM-1103: personal bot only DMs owner; shared-channel politely refused + share hint.
test "acceptance_CM-1103_personal_slack_owner_dm_only" {
  let bot = @channels.PersonalSlackBot::new(owner_user_id="Uowner")
  let dm = @channels.parse_channel_address(bot.owner_dm_address())
  assert_true(dm.is_dm())
  match bot.try_send(dm, text="hello owner") {
    @channels.SentDm(owner_id~, text~) => {
      assert_eq(owner_id, "Uowner")
      assert_eq(text, "hello owner")
    }
    @channels.RefusedSharedChannel(_) => fail("owner DM must send")
  }
  let shared = @channels.parse_channel_address("slack:Cshared")
  assert_true(shared.is_toplevel())
  match bot.try_send(shared, text="post to channel") {
    @channels.RefusedSharedChannel(hint~) => {
      assert_true(hint.contains("share") || hint.contains("Share"))
      assert_true(
        hint.contains("owner") ||
        hint.contains("DM") ||
        hint.contains("personal"),
      )
    }
    @channels.SentDm(_) => fail("shared channel must be refused")
  }
  let thread = @channels.parse_channel_address("slack:Cshared:111.222")
  match bot.try_send(thread, text="thread reply") {
    r => {
      assert_false(r.is_sent())
      assert_true(r.is_polite_refuse())
      match r.refuse_hint() {
        Some(h) => assert_true(h.contains("share") || h.contains("Share"))
        None => fail("refuse must carry share hint")
      }
    }
  }
  let other_dm = @channels.parse_channel_address("slack:Uother")
  match bot.try_send(other_dm, text="nope") {
    r => assert_false(r.is_sent())
  }
}
