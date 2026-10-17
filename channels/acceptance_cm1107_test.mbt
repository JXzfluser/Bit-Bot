///|
/// CM-1107: Microsoft Teams channel — inbound/outbound + routine trigger;
/// tenant/team scope correct.
test "acceptance_CM-1107_microsoft_teams_channel_scope" {
  let scope = @channels.TeamsScope::of(
    tenant_id="tenant-A",
    team_id="team-1",
    channel_id=Some("general"),
  )
  assert_eq(scope.to_address(), "teams:tenant-A/team-1/general")
  match @channels.parse_teams_scope("teams:tenant-A/team-1/general") {
    Ok(s) => {
      assert_eq(s.tenant_id, "tenant-A")
      assert_eq(s.team_id, "team-1")
      assert_eq(s.channel_id, Some("general"))
    }
    Err(e) => fail(e)
  }
  // ChannelKind parse via address.
  let addr = @channels.parse_channel_address("teams:tenant-A/team-1/general")
  assert_eq(addr.kind, @channels.Teams)
  assert_eq(addr.reply_hint(), "teams:tenant-A/team-1/general")
  // Session inbound/outbound under correct scope.
  let session = @channels.TeamsChannelSession::connect(scope)
  let inbound : @channels.TeamsInbound = {
    scope,
    message_id: "m1",
    sender: "alice",
    body: "hello teams",
  }
  match session.receive(inbound) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match session.send(scope, body="reply ok") {
    Ok(a) => assert_true(a.contains("tenant-A") && a.contains("team-1"))
    Err(e) => fail(e)
  }
  // Wrong tenant/team rejected.
  let other = @channels.TeamsScope::of(
    tenant_id="tenant-B",
    team_id="team-9",
    channel_id=None,
  )
  match session.send(other, body="leak") {
    Err(m) => assert_true(m.contains("scope") || m.contains("mismatch"))
    Ok(_) => fail("cross-tenant Teams send must Err")
  }
  match @channels.plan_teams_outbound(inbound, other, body="x") {
    @channels.Rejected(reason~) =>
      assert_true(reason.contains("scope") || reason.contains("mismatch"))
    @channels.Deliver(_) => fail("outbound scope mismatch must Reject")
  }
  // Routine trigger wakes on matching tenant/team + event.
  match @channels.TeamsRoutineTrigger::new(scope, "message") {
    Ok(trig) => {
      assert_true(trig.matches_inbound(inbound, "message"))
      assert_false(trig.matches_inbound(inbound, "mention"))
      let foreign : @channels.TeamsInbound = {
        scope: other,
        message_id: "m2",
        sender: "bob",
        body: "nope",
      }
      assert_false(trig.matches_inbound(foreign, "message"))
    }
    Err(e) => fail(e)
  }
}
