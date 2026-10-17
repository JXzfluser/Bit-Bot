///|
/// K-batch P0: CM-2147 — no homemade connect URL; official Install/Authenticate only.

///|
test "acceptance_CM-2147_no_homemade_connect_url" {
  // NeedsAuth → official Authenticate card.
  match @tools.guide_connect("user-Gmail", @connectors.NeedsAuth) {
    @tools.OfficialCard(card~) => {
      assert_eq(card.kind_label(), "Authenticate")
      assert_eq(card.namespace_(), "user-Gmail")
    }
    _ => fail("NeedsAuth must show Authenticate card")
  }
  // NeedsGrant → official Install card.
  match @tools.guide_connect("user-Slack", @connectors.NeedsGrant) {
    @tools.OfficialCard(card~) => {
      assert_eq(card.kind_label(), "Install")
      assert_true(
        @tools.guide_connect("user-Slack", @connectors.NeedsGrant).is_official_only(),
      )
    }
    _ => fail("NeedsGrant must show Install card")
  }
  // Homemade URL refused.
  match
    @tools.guide_connect(
      "user-Gmail",
      @connectors.NeedsAuth,
      proposed_url=Some("https://evil.example/oauth/connect?token=x"),
    ) {
    @tools.RefuseHomemadeUrl(url~, reason~) => {
      assert_true(url.contains("evil.example"))
      assert_true(
        reason.contains("homemade") || reason.contains("Install/Authenticate"),
      )
      assert_true(@tools.is_homemade_connect_url(url))
    }
    @tools.OfficialCard(_) =>
      fail("homemade URL must not yield official card path as success")
    @tools.ReadyNoGuide => fail("homemade must refuse")
  }
  assert_true(@tools.is_homemade_connect_url("homemade:http://local/connect"))
  assert_false(
    @tools.is_homemade_connect_url("https://cursor.com/agents/install"),
  )
  assert_false(
    @tools.guide_connect("ns", @connectors.NeedsAuth).has_homemade_url(),
  )
}
