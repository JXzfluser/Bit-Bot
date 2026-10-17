///|
/// CM-1703: Fetch 403/block → browser/curl public fallback; NOT credential bypass.
test "acceptance_CM-1703_fetch_fail_public_fallback_no_cred_bypass" {
  let host = @tools.WebHost::mock()
  let blocked = "https://example.com/docs-blocked"
  host.seed_blocked_public(
    blocked, "<html>Public docs via alternate egress</html>",
  )
  // Primary fetch fails with 403/block.
  match host.fetch({ url: blocked, max_bytes: 10000, }) {
    Err(m) =>
      assert_true(
        m.contains("403") || m.contains("block") || m.contains("Rejected"),
      )
    Ok(_) => fail("403 URL must fail primary fetch")
  }
  // Public fallback succeeds without credentials.
  match
    host.fetch_with_public_fallback(
      { url: blocked, max_bytes: 10000, },
      prefer=@tools.Browser,
    ) {
    Ok(r) => {
      assert_true(r.used_fallback)
      assert_false(r.credential_bypass)
      assert_true(r.body.contains("Public docs") || r.body.contains("html"))
      match r.fallback {
        Some(f) => assert_eq(f.label(), "browser")
        None => fail("fallback kind required")
      }
    }
    Err(e) => fail(e)
  }
  match
    host.fetch_with_public_fallback(
      { url: blocked, max_bytes: 10000, },
      prefer=@tools.Curl,
    ) {
    Ok(r) => {
      assert_true(r.used_fallback)
      match r.fallback {
        Some(f) => assert_eq(f.label(), "curl")
        None => fail("curl fallback required")
      }
    }
    Err(e) => fail(e)
  }
  // Auth wall must NOT use public fallback (credential bypass).
  match
    host.fetch_with_public_fallback({
      url: "https://example.com/login",
      max_bytes: 10000,
    }) {
    Err(m) => {
      assert_true(
        m.contains("401") ||
        m.contains("auth") ||
        m.contains("credential") ||
        m.contains("login") ||
        m.contains("认证"),
      )
      assert_true(@tools.is_credential_bypass_fallback(m, true))
    }
    Ok(_) => fail("auth wall must not public-fallback")
  }
  // Direct success path: no fallback flag.
  match
    host.fetch_with_public_fallback({
      url: "https://example.com",
      max_bytes: 10000,
    }) {
    Ok(r) => {
      assert_false(r.used_fallback)
      assert_false(r.credential_bypass)
      assert_true(r.body.contains("Example"))
    }
    Err(e) => fail(e)
  }
}
