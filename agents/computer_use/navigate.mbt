///|
/// CM-2160: browser navigate — mock Host/kernel-contract outcome (no real browser).

///|
pub(all) struct NavigateResult {
  url : String
  /// Public page reached successfully.
  navigate_reachable : Bool
  public_page : Bool
  blocked : Bool
  evidence : String
} derive(Eq, Debug)

///|
pub extend NavigateResult with Eq::{equal, not_equal}

///|
pub extend NavigateResult with Debug::{to_repr}

///|
fn is_public_http_url(url : String) -> Bool {
  url.has_prefix("https://") || url.has_prefix("http://")
}

///|
fn is_private_or_blocked(url : String) -> Bool {
  url.contains("localhost") ||
  url.contains("127.0.0.1") ||
  url.has_prefix("file:") ||
  url.contains("chrome://")
}

///|
/// CM-2160: navigate to a public URL — mock reachable outcome with evidence flag.
pub fn navigate_public(url : String) -> Result[NavigateResult, String] {
  if url.length() == 0 {
    return Err("navigate: empty url")
  }
  if is_private_or_blocked(url) {
    return Ok({
      url,
      navigate_reachable: false,
      public_page: false,
      blocked: true,
      evidence: "navigate_reachable=false; blocked non-public target",
    })
  }
  if !is_public_http_url(url) {
    return Err("navigate: not a public http(s) url: " + url)
  }
  Ok({
    url,
    navigate_reachable: true,
    public_page: true,
    blocked: false,
    evidence: "navigate_reachable=true; public page ok",
  })
}

///|
/// computerUse path: open/operate public page → structured NavigateResult.
pub fn computer_use_navigate_public(
  agent_id~ : String,
  url~ : String,
) -> Result[NavigateResult, String] {
  let _ = agent_id
  navigate_public(url)
}
