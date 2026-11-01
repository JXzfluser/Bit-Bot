///|
/// CM-2106: trigger:microsoftTeams — Teams event wakes routine (align CM-1107).
test "acceptance_CM-2106_trigger_microsoft_teams_wakes_routine" {
  assert_eq(@routines.microsoft_teams_trigger_label(), "microsoftTeams")
  assert_eq(@routines.MICROSOFT_TEAMS_TRIGGER, "microsoftTeams")
  assert_true(@routines.Teams.is_microsoft_teams())
  assert_eq(@routines.Teams.label(), "microsoftTeams")
  match
    @routines.MicrosoftTeamsRoutineBinding::new(
      routine_id="rtn-teams-1",
      tenant_id="tenant-A",
      team_id="team-1",
      event_kind="message",
    ) {
    Err(e) => fail(e)
    Ok(binding) => {
      assert_eq(binding.trigger_name(), "microsoftTeams")
      assert_eq(
        binding.as_trigger(),
        @routines.Event(name="microsoftTeams:message"),
      )
      let event = @routines.MicrosoftTeamsEvent::of(
        tenant_id="tenant-A",
        team_id="team-1",
        event_kind="message",
        message_id="m-100",
        body="hello from Teams",
      )
      match @routines.wake_routine_on_microsoft_teams_event(binding, event) {
        @routines.Woke(routine_id~, event_kind~, trigger~) => {
          assert_eq(routine_id, "rtn-teams-1")
          assert_eq(event_kind, "message")
          assert_eq(trigger, "microsoftTeams")
        }
        @routines.Ignored(reason~) => fail("expected wake, got: " + reason)
      }
      // Scope mismatch (CM-1107 tenant/team) must not wake.
      let foreign = @routines.MicrosoftTeamsEvent::of(
        tenant_id="tenant-B",
        team_id="team-9",
        event_kind="message",
      )
      match @routines.wake_routine_on_microsoft_teams_event(binding, foreign) {
        @routines.Ignored(reason~) =>
          assert_true(reason.contains("mismatch") || reason.contains("scope"))
        @routines.Woke(_) => fail("cross-tenant Teams event must not wake")
      }
      // Event kind mismatch.
      let mention = @routines.MicrosoftTeamsEvent::of(
        tenant_id="tenant-A",
        team_id="team-1",
        event_kind="mention",
      )
      assert_false(binding.matches_event(mention))
      match @routines.wake_routine_on_microsoft_teams_event(binding, mention) {
        @routines.Ignored(_) => ()
        @routines.Woke(_) => fail("kind mismatch must not wake")
      }
    }
  }
  // Registry delivers and records wakes.
  let reg = @routines.MicrosoftTeamsTriggerRegistry::empty()
  match
    @routines.MicrosoftTeamsRoutineBinding::new(
      routine_id="rtn-2",
      tenant_id="t1",
      team_id="teamX",
      event_kind="channelMessage",
    ) {
    Err(e) => fail(e)
    Ok(b) => reg.register(b)
  }
  let ev = @routines.MicrosoftTeamsEvent::of(
    tenant_id="t1",
    team_id="teamX",
    event_kind="channelMessage",
  )
  let wakes = reg.deliver(ev)
  assert_eq(wakes.length(), 1)
  assert_true(wakes[0].did_wake())
  assert_eq(reg.wake_count(), 1)
}
