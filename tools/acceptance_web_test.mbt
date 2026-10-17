///|
/// CM-1701: WebSearch returns hits for query.
test "acceptance_CM-1701_web_search" {
  let host = @tools.WebHost::mock()
  match host.search({ query: "Example", limit: 5, }) {
    Ok(hits) => {
      assert_true(hits.length() >= 1)
      assert_true(hits[0].url.has_prefix("https://"))
    }
    Err(e) => fail(e)
  }
  match host.search({ query: "", limit: 5, }) {
    Err(_) => ()
    Ok(_) => fail("empty query must err")
  }
}

///|
/// CM-1701: hits carry summary/snippet + URL; time-sensitive query injects current year.
test "acceptance_CM-1701_summary_url_current_year" {
  let host = @tools.WebHost::mock()
  match host.search({ query: "Example", limit: 5, }, current_year=2026) {
    Ok(hits) => {
      assert_true(hits.length() >= 1)
      let h = hits[0]
      assert_true(h.snippet.length() > 0)
      assert_true(h.url.has_prefix("https://"))
    }
    Err(e) => fail(e)
  }
  let normalized = @tools.normalize_search_query("latest AI", year=2026)
  assert_true(normalized.contains("2026"))
  assert_true(normalized.contains("latest"))
  match host.search({ query: "latest AI", limit: 5, }, current_year=2026) {
    Ok(hits) => {
      assert_true(hits.length() >= 1)
      assert_true(hits[0].snippet.length() > 0)
      assert_true(hits[0].url.has_prefix("https://"))
    }
    Err(e) => fail(e)
  }
  // Year already present → do not duplicate.
  let already = @tools.normalize_search_query("latest AI 2026", year=2026)
  assert_eq(already, "latest AI 2026")
}

///|
/// CM-1702: WebFetch returns page body; bad scheme rejected.
test "acceptance_CM-1702_web_fetch" {
  let host = @tools.WebHost::mock()
  match host.fetch({ url: "https://example.com", max_bytes: 10000, }) {
    Ok(body) => assert_true(body.contains("Example"))
    Err(e) => fail(e)
  }
  match host.fetch({ url: "file:///etc/passwd", max_bytes: 100, }) {
    Err(m) => assert_true(m.contains("http"))
    Ok(_) => fail("file scheme must reject")
  }
}

///|
/// CM-1702: auth-walled pages fail clearly (401 / login / auth).
test "acceptance_CM-1702_auth_page_fails_clearly" {
  let host = @tools.WebHost::mock()
  match host.fetch({ url: "https://example.com", max_bytes: 10000, }) {
    Ok(body) => assert_true(body.contains("Example"))
    Err(e) => fail("public page must succeed: " + e)
  }
  match host.fetch({ url: "https://example.com/login", max_bytes: 10000, }) {
    Err(m) =>
      assert_true(
        m.contains("401") ||
        m.contains("login") ||
        m.contains("auth") ||
        m.contains("认证"),
      )
    Ok(_) => fail("auth wall must fail clearly")
  }
}
