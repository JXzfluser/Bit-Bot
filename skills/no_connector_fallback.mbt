///|
/// CM-1809: no-connector-fallback — explicit degrade path, not hard fail.
/// Used by scheduling and other vertical skills when a connector is missing.

///|
pub(all) enum ConnectorFallbackPath {
  /// Prefer official connector when Ready.
  UseConnector
  /// No connector → browser / computerUse degrade (explicit).
  BrowserDegrade
  /// No connector → curl / public web degrade.
  CurlDegrade
  /// Hard failure (forbidden as the only path when degrade is available).
  HardFail
} derive(Eq, Debug)

///|
pub extend ConnectorFallbackPath with Eq::{equal, not_equal}

///|
pub extend ConnectorFallbackPath with Debug::{to_repr}

///|
pub fn ConnectorFallbackPath::is_hard_fail(
  self : ConnectorFallbackPath,
) -> Bool {
  match self {
    HardFail => true
    UseConnector | BrowserDegrade | CurlDegrade => false
  }
}

///|
pub fn ConnectorFallbackPath::is_degrade(self : ConnectorFallbackPath) -> Bool {
  match self {
    BrowserDegrade | CurlDegrade => true
    UseConnector | HardFail => false
  }
}

///|
pub fn ConnectorFallbackPath::label(self : ConnectorFallbackPath) -> String {
  match self {
    UseConnector => "use-connector"
    BrowserDegrade => "no-connector-fallback/browser"
    CurlDegrade => "no-connector-fallback/curl"
    HardFail => "hard-fail"
  }
}

///|
/// Decide path from connector usability. Missing/unusable → explicit degrade (not hard fail).
pub fn resolve_no_connector_fallback(
  connector_usable~ : Bool,
  prefer_browser~ : Bool = true,
) -> ConnectorFallbackPath {
  if connector_usable {
    UseConnector
  } else if prefer_browser {
    BrowserDegrade
  } else {
    CurlDegrade
  }
}

///|
/// CM-1809: plan an action when connector is absent — must not hard-fail by default.
pub fn plan_without_connector(
  skill~ : String,
  target_url~ : String = "",
) -> Result[(ConnectorFallbackPath, String), String] {
  let path = resolve_no_connector_fallback(connector_usable=false)
  if path.is_hard_fail() {
    return Err("no-connector-fallback must not hard-fail for " + skill)
  }
  let hint = if target_url.length() > 0 {
    path.label() + " → " + target_url
  } else {
    path.label() + " for skill " + skill
  }
  Ok((path, hint))
}

///|
pub fn no_connector_fallback_skill_name() -> String {
  "no-connector-fallback"
}
