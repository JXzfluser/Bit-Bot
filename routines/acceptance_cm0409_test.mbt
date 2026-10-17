///|
/// CM-0409: Teams/Linear/Sentry/PagerDuty listener shapes + missing connector auto card.
test "acceptance_CM-0409_event_trigger_teams_linear_sentry_pagerduty" {
  let ok_shapes : Array[@routines.ExternalListenerShape] = [
    {
      connector: @routines.Teams,
      event_kind: "mention",
      filter_id: Some("team-19:abc"),
      connector_connected: true,
    },
    {
      connector: @routines.Linear,
      event_kind: "issue.created",
      filter_id: Some("ENG"),
      connector_connected: true,
    },
    {
      connector: @routines.Sentry,
      event_kind: "error",
      filter_id: Some("proj-bitbot"),
      connector_connected: true,
    },
    {
      connector: @routines.PagerDuty,
      event_kind: "alert.triggered",
      filter_id: Some("svc-pager"),
      connector_connected: true,
    },
  ]
  for s in ok_shapes {
    match @routines.validate_external_listener(s) {
      Ok(_) => ()
      Err(e) => fail("valid shape rejected: " + e)
    }
    match @routines.prepare_external_listener(s) {
      @routines.Ready(_) => ()
      @routines.ShowAutoCard(_) =>
        fail("connected shape must be Ready, not card")
      @routines.Invalid(reason~) => fail("connected shape Invalid: " + reason)
    }
  }
  // Optional filter id may be omitted.
  match
    @routines.validate_external_listener({
      connector: @routines.Teams,
      event_kind: "message",
      filter_id: None,
      connector_connected: true,
    }) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  // Empty event_kind → Invalid
  match
    @routines.prepare_external_listener({
      connector: @routines.Linear,
      event_kind: "",
      filter_id: None,
      connector_connected: true,
    }) {
    @routines.Invalid(reason~) => assert_true(reason.contains("event_kind"))
    _ => fail("empty event_kind must Invalid")
  }
  // Missing connector → auto card
  let missing = @routines.ExternalListenerShape::{
    connector: @routines.Sentry,
    event_kind: "issue.created",
    filter_id: Some("proj-x"),
    connector_connected: false,
  }
  match @routines.prepare_external_listener(missing) {
    @routines.ShowAutoCard(card~) => {
      assert_true(card.is_auto_card())
      assert_true(card.shown)
      assert_eq(card.connector, @routines.Sentry)
      assert_true(card.namespace_hint.contains("Sentry"))
      assert_true(
        card.reason.contains("missing") || card.reason.contains("connect"),
      )
    }
    _ => fail("missing connector must ShowAutoCard")
  }
  assert_true(@routines.prepare_external_listener(missing).is_auto_card())
  // Labels
  assert_eq(@routines.Teams.label(), "microsoftTeams")
  assert_eq(@routines.Linear.label(), "linear")
  assert_eq(@routines.PagerDuty.label(), "pagerduty")
}
