///|
/// CM-1801: scheduling — no connector → no-connector-fallback/browser (not hard fail).
test "acceptance_CM-1801_scheduling_no_connector_fallback" {
  assert_eq(@skills.scheduling_skill_name(), "scheduling")
  let req = @skills.SchedulingRequest::{
    title: "Design sync",
    timezone: "Asia/Shanghai",
    when_desc: "Monday 10:00",
  }
  // Ready connector → connector path.
  match @skills.run_scheduling(req, calendar_connector=@connectors.Ready) {
    @skills.ConnectorOk(event_id~) =>
      assert_true(event_id.contains("Design sync"))
    _ => fail("expected ConnectorOk")
  }
  // Missing / unusable connector → explicit fallback, not hard fail.
  for
    st in [
      @connectors.Unavailable,
      @connectors.NeedsAuth,
      @connectors.NeedsGrant,
      @connectors.Loading,
    ] {
    match @skills.run_scheduling(req, calendar_connector=st) {
      @skills.Fallback(path~, hint~) => {
        assert_true(path.is_degrade())
        assert_false(path.is_hard_fail())
        assert_true(
          hint.contains("no-connector-fallback") ||
          hint.contains("browser") ||
          path.label().contains("browser"),
        )
      }
      @skills.ConnectorOk(_) => fail("unusable connector must not ConnectorOk")
      @skills.Invalid(reason~) =>
        fail("missing connector must not hard-fail/Invalid: " + reason)
    }
  }
  match
    @skills.run_scheduling(
      { title: "", timezone: "Asia/Shanghai", when_desc: "x", },
      calendar_connector=@connectors.Ready,
    ) {
    @skills.Invalid(_) => ()
    _ => fail("empty title must Invalid")
  }
}
