///|
/// CM-2146: connector app vs user identity — Given app insufficient When user required Then signed-in browser.
test "acceptance_CM-2146_connector_app_vs_user_identity_browser" {
  // App identity + user required → switch to browser.
  match
    @connectors.resolve_connector_identity(
      @connectors.AppIdentity,
      @connectors.UserIdentityRequired,
    ) {
    @connectors.SwitchToSignedInBrowser(reason~) => {
      assert_true(
        reason.contains("signed-in browser") || reason.contains("insufficient"),
      )
      assert_true(
        @connectors.IdentityResolution::SwitchToSignedInBrowser(reason~).switched_to_browser(),
      )
    }
    @connectors.Proceed(_) =>
      fail("app identity must not proceed when user required")
  }
  let session = @connectors.ConnectorIdentitySession::new(
    @connectors.AppIdentity,
  )
  assert_false(session.is_user_browser())
  let res = session.ensure(@connectors.UserIdentityRequired)
  assert_true(res.switched_to_browser())
  assert_true(session.switched)
  assert_true(session.is_user_browser())
  // Already user browser → proceed.
  match
    @connectors.resolve_connector_identity(
      @connectors.UserBrowserSession,
      @connectors.UserIdentityRequired,
    ) {
    @connectors.Proceed(identity~) =>
      assert_true(identity is @connectors.UserBrowserSession)
    @connectors.SwitchToSignedInBrowser(_) =>
      fail("user browser already sufficient")
  }
  // App sufficient for app-only actions.
  match
    @connectors.resolve_connector_identity(
      @connectors.AppIdentity,
      @connectors.AppSufficient,
    ) {
    @connectors.Proceed(identity~) =>
      assert_true(identity is @connectors.AppIdentity)
    @connectors.SwitchToSignedInBrowser(_) =>
      fail("app sufficient must proceed")
  }
}
