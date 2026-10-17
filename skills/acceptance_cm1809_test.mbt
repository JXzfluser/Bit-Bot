///|
/// CM-1809: no-connector-fallback — explicit degrade path, not hard fail.
test "acceptance_CM-1809_no_connector_fallback_path_not_hard_fail" {
  assert_eq(@skills.no_connector_fallback_skill_name(), "no-connector-fallback")
  let with_conn = @skills.resolve_no_connector_fallback(connector_usable=true)
  assert_eq(with_conn, @skills.UseConnector)
  assert_false(with_conn.is_hard_fail())
  let browser = @skills.resolve_no_connector_fallback(connector_usable=false)
  assert_true(browser.is_degrade())
  assert_false(browser.is_hard_fail())
  assert_true(
    browser.label().contains("no-connector-fallback") ||
    browser.label().contains("browser"),
  )
  let curl = @skills.resolve_no_connector_fallback(
    connector_usable=false,
    prefer_browser=false,
  )
  assert_eq(curl, @skills.CurlDegrade)
  assert_true(curl.is_degrade())
  match
    @skills.plan_without_connector(
      skill="scheduling",
      target_url="https://calendar.example.com",
    ) {
    Ok((path, hint)) => {
      assert_false(path.is_hard_fail())
      assert_true(path.is_degrade())
      assert_true(
        hint.contains("calendar.example.com") || hint.contains("browser"),
      )
    }
    Err(e) => fail(e)
  }
  // HardFail must never be the resolve result for missing connector.
  assert_false(
    @skills.resolve_no_connector_fallback(connector_usable=false).is_hard_fail(),
  )
}
