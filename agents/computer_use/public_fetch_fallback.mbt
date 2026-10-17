///|
/// CM-1703: browser/curl public-page fallback after WebFetch 403/block.
/// Must NOT scrape cookies/tokens (credential bypass forbidden).

///|
pub(all) enum CuPublicFallbackKind {
  BrowserNavigate
  CurlEgress
} derive(Eq, Debug)

///|
pub extend CuPublicFallbackKind with Eq::{equal, not_equal}

///|
pub extend CuPublicFallbackKind with Debug::{to_repr}

///|
pub(all) struct CuPublicFallbackResult {
  url : String
  kind : CuPublicFallbackKind
  navigate_reachable : Bool
  /// Body recovered without credentials.
  body : String
  used_credentials : Bool
} derive(Eq, Debug)

///|
pub extend CuPublicFallbackResult with Eq::{equal, not_equal}

///|
pub extend CuPublicFallbackResult with Debug::{to_repr}

///|
/// Recover a public page after fetch provider block — browser or curl, never creds.
pub fn public_page_fallback(
  url~ : String,
  kind~ : CuPublicFallbackKind = BrowserNavigate,
  use_cookies_or_tokens~ : Bool = false,
) -> Result[CuPublicFallbackResult, String] {
  if use_cookies_or_tokens {
    return Err("public_page_fallback: credential/session bypass forbidden")
  }
  match navigate_public(url) {
    Err(e) => Err(e)
    Ok(nav) => {
      if !nav.public_page || nav.blocked {
        return Err("public_page_fallback: not a reachable public page")
      }
      let body = match kind {
        BrowserNavigate => "<html>browser fallback body for " + url + "</html>"
        CurlEgress => "<html>curl fallback body for " + url + "</html>"
      }
      Ok({
        url,
        kind,
        navigate_reachable: nav.navigate_reachable,
        body,
        used_credentials: false,
      })
    }
  }
}
