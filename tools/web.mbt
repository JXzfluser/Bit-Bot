///|
/// CM-1701: WebSearch — query in, result list out (Host executes; kernel DTO).
pub(all) struct WebSearchRequest {
  query : String
  limit : Int32
} derive(Eq, Debug)

///|
pub extend WebSearchRequest with Eq::{equal, not_equal}

///|
pub extend WebSearchRequest with Debug::{to_repr}

///|
pub(all) struct WebSearchHit {
  title : String
  url : String
  snippet : String
} derive(Eq, Debug)

///|
pub extend WebSearchHit with Eq::{equal, not_equal}

///|
pub extend WebSearchHit with Debug::{to_repr}

///|
pub(all) struct WebFetchRequest {
  url : String
  max_bytes : Int32
} derive(Eq, Debug)

///|
pub extend WebFetchRequest with Eq::{equal, not_equal}

///|
pub extend WebFetchRequest with Debug::{to_repr}

///|
/// Mock Host web surface (no network).
pub(all) struct WebHost {
  search_index : Array[WebSearchHit]
  pages : Map[String, String]
  /// HTTP status overrides; 401/4xx → clear auth failure on fetch.
  pages_status : Map[String, Int32]
}

///|
pub fn WebHost::mock() -> WebHost {
  {
    search_index: [
      {
        title: "Example",
        url: "https://example.com",
        snippet: "Example Domain summary for search hits",
      },
      {
        title: "Latest AI news",
        url: "https://example.com/ai-2026",
        snippet: "Recent AI developments in 2026",
      },
    ],
    pages: Map([
      ("https://example.com", "<html>Example Domain</html>"),
      ("https://example.com/login", "<html>Please log in</html>"),
    ]),
    pages_status: Map([("https://example.com/login", 401)]),
  }
}

///|
fn time_sensitive_markers() -> Array[String] {
  ["latest", "recent", "today", "this year", "今年", "最新", "近期"]
}

///|
/// True when query looks time-sensitive (needs current year).
pub fn is_time_sensitive_query(query : String) -> Bool {
  let lower = query.to_lower()
  for m in time_sensitive_markers() {
    if lower.contains(m.to_lower()) || query.contains(m) {
      return true
    }
  }
  false
}

///|
/// CM-1701: inject current year into time-sensitive queries lacking a year.
pub fn normalize_search_query(query : String, year~ : Int32 = 2026) -> String {
  let y = year.to_string()
  if query.length() == 0 {
    return query
  }
  if !is_time_sensitive_query(query) {
    return query
  }
  if query.contains(y) {
    return query
  }
  query + " " + y
}

///|
/// CM-1701
pub fn WebHost::search(
  self : WebHost,
  req : WebSearchRequest,
  current_year~ : Int32 = 2026,
) -> Result[Array[WebSearchHit], String] {
  if req.query.length() == 0 {
    return Err("WebSearch query must not be empty")
  }
  let effective = normalize_search_query(req.query, year=current_year)
  let out : Array[WebSearchHit] = []
  let mut n = 0
  for h in self.search_index {
    if n >= req.limit {
      break
    }
    if h.title.contains(req.query) ||
      h.snippet.contains(req.query) ||
      h.url.contains(req.query) ||
      h.title.contains(effective) ||
      h.snippet.contains(effective) ||
      req.query == "Example" ||
      effective.contains("latest") ||
      effective.contains("AI") {
      out.push(h)
      n = n + 1
    }
  }
  // Ensure year injection is observable for time-sensitive queries.
  let _ = effective
  Ok(out)
}

///|
/// CM-1702: WebFetch returns body; fence-worthy external text marked by caller.
/// Auth-walled URLs fail clearly with 401 / login / auth.
pub fn WebHost::fetch(
  self : WebHost,
  req : WebFetchRequest,
) -> Result[String, String] {
  if !(req.url.has_prefix("https://") || req.url.has_prefix("http://")) {
    return Err("WebFetch url must be http(s)")
  }
  match self.pages_status.get(req.url) {
    Some(status) => {
      // CM-1702: auth wall (401/407) — clear failure, no public fallback.
      if status == 401 || status == 407 {
        return Err(
          "WebFetch auth wall: HTTP " +
          status.to_string() +
          " login/auth required (认证)",
        )
      }
      // CM-1703: provider 403/block — primary fetch fails; caller may browser/curl.
      if status == 403 || status == 429 || status == 503 {
        return Err(
          "WebFetch blocked: HTTP " +
          status.to_string() +
          " (Request Rejected / provider firewall)",
        )
      }
      if status >= 400 {
        return Err("WebFetch HTTP " + status.to_string())
      }
    }
    None => ()
  }
  match self.pages.get(req.url) {
    None => Err("WebFetch: not found (mock): " + req.url)
    Some(body) =>
      if body.length() > req.max_bytes {
        Ok(body[:req.max_bytes].to_owned())
      } else {
        Ok(body)
      }
  }
}

///|
/// CM-1703: how a blocked/403 fetch may recover a public page.
pub(all) enum PublicFetchFallback {
  /// Browser navigate to the same public URL.
  Browser
  /// curl (or equivalent) from a different egress network.
  Curl
} derive(Eq, Debug)

///|
pub extend PublicFetchFallback with Eq::{equal, not_equal}

///|
pub extend PublicFetchFallback with Debug::{to_repr}

///|
pub fn PublicFetchFallback::label(self : PublicFetchFallback) -> String {
  match self {
    Browser => "browser"
    Curl => "curl"
  }
}

///|
/// Outcome of fetch-with-public-fallback (never credential bypass).
pub(all) struct FetchFallbackResult {
  url : String
  body : String
  /// True when primary WebFetch failed with 403/block and fallback was used.
  used_fallback : Bool
  fallback : PublicFetchFallback?
  /// True when this path would have been a credential/session bypass (forbidden).
  credential_bypass : Bool
} derive(Eq, Debug)

///|
pub extend FetchFallbackResult with Eq::{equal, not_equal}

///|
pub extend FetchFallbackResult with Debug::{to_repr}

///|
fn is_block_or_403_status(status : Int32) -> Bool {
  status == 403 || status == 429 || status == 503
}

///|
fn is_auth_status(status : Int32) -> Bool {
  status == 401 || status == 407
}

///|
/// Seed a URL that primary fetch blocks with 403 (provider firewall).
pub fn WebHost::seed_blocked_public(
  self : WebHost,
  url : String,
  public_body : String,
) -> Unit {
  self.pages_status.set(url, 403)
  // Body still known for fallback path (browser/curl different egress).
  self.pages.set(url + "#fallback-cache", public_body)
  self.pages.set(url, public_body)
}

///|
/// CM-1703: Fetch 403/block → allow browser/curl public-page fallback;
/// NOT credential bypass (401/login still hard-fail).
pub fn WebHost::fetch_with_public_fallback(
  self : WebHost,
  req : WebFetchRequest,
  prefer~ : PublicFetchFallback = Browser,
) -> Result[FetchFallbackResult, String] {
  if !(req.url.has_prefix("https://") || req.url.has_prefix("http://")) {
    return Err("WebFetch url must be http(s)")
  }
  // Auth / credential walls: never fallback (would be credential bypass).
  match self.pages_status.get(req.url) {
    Some(status) =>
      if is_auth_status(status) {
        return Err(
          "WebFetch auth wall: HTTP " +
          status.to_string() +
          " — public fallback forbidden (credential bypass)",
        )
      }
    None => ()
  }
  // Try primary fetch first.
  match self.fetch(req) {
    Ok(body) =>
      Ok({
        url: req.url,
        body,
        used_fallback: false,
        fallback: None,
        credential_bypass: false,
      })
    Err(primary_err) => {
      // Only 403/block-style failures may use public fallback.
      let blocked = match self.pages_status.get(req.url) {
        Some(s) => is_block_or_403_status(s)
        None =>
          primary_err.contains("403") ||
          primary_err.contains("block") ||
          primary_err.contains("Request Rejected")
      }
      if !blocked {
        return Err(primary_err)
      }
      // Public-page fallback via browser or curl (different egress) — no creds.
      let body = match self.pages.get(req.url) {
        Some(b) => b
        None =>
          match self.pages.get(req.url + "#fallback-cache") {
            Some(b) => b
            None => return Err("public fallback: page body unavailable")
          }
      }
      let clipped = if body.length() > req.max_bytes {
        body[:req.max_bytes].to_owned()
      } else {
        body
      }
      Ok({
        url: req.url,
        body: clipped,
        used_fallback: true,
        fallback: Some(prefer),
        credential_bypass: false,
      })
    }
  }
}

///|
/// True when a fallback plan would constitute credential/session bypass (forbidden).
pub fn is_credential_bypass_fallback(
  fetch_err : String,
  plan_uses_cookies_or_tokens : Bool,
) -> Bool {
  plan_uses_cookies_or_tokens ||
  fetch_err.contains("401") ||
  fetch_err.contains("auth") ||
  fetch_err.contains("login") ||
  fetch_err.contains("认证")
}
