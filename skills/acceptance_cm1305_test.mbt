///|
/// CM-1305: source-control — GitHub vs Origin routing; mirror must not use origin triggers.
test "acceptance_CM-1305_source_control_no_origin_trigger_on_mirror" {
  assert_eq(@skills.source_control_skill_name(), "source-control")
  // Native Origin → Origin backend / cursor-origin.
  assert_eq(@skills.route_source_control(@skills.NativeOrigin), @skills.Origin)
  assert_eq(
    @skills.route_source_control(@skills.NativeOrigin).mcp_namespace(),
    "cursor-origin",
  )
  assert_true(@skills.allows_origin_trigger(@skills.NativeOrigin))
  match
    @skills.register_origin_trigger(
      @skills.NativeOrigin,
      repo="org/native-app",
      event="pr",
    ) {
    Ok(id) => assert_true(id.contains("org/native-app"))
    Err(e) => fail(e)
  }
  // Mirror → GitHub routing; origin trigger rejected.
  assert_eq(@skills.route_source_control(@skills.GithubMirror), @skills.Github)
  assert_eq(
    @skills.route_source_control(@skills.GithubMirror).mcp_namespace(),
    "cursor-github",
  )
  assert_false(@skills.allows_origin_trigger(@skills.GithubMirror))
  match
    @skills.register_origin_trigger(
      @skills.GithubMirror,
      repo="org/mirrored-from-github",
      event="pr",
    ) {
    Err(m) => {
      assert_true(m.contains("mirror") || m.contains("origin"))
      assert_true(
        m.contains("org/mirrored-from-github") || m.contains("trigger"),
      )
    }
    Ok(_) => fail("mirror must not register origin trigger")
  }
  // Plain GitHub likewise no origin trigger.
  assert_false(@skills.allows_origin_trigger(@skills.GithubNative))
  match
    @skills.register_origin_trigger(
      @skills.GithubNative,
      repo="org/gh-only",
      event="ci",
    ) {
    Err(_) => ()
    Ok(_) => fail("GitHubNative must not use origin triggers")
  }
}
