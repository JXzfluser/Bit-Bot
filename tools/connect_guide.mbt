///|
/// CM-2147: when namespace needs connect, only official Install / Authenticate cards —
/// never a homemade connect URL.
pub(all) enum OfficialConnectCard {
  Install(namespace_~ : String)
  Authenticate(namespace_~ : String)
} derive(Eq, Debug)

///|
pub extend OfficialConnectCard with Eq::{equal, not_equal}

///|
pub extend OfficialConnectCard with Debug::{to_repr}

///|
pub fn OfficialConnectCard::namespace_(self : OfficialConnectCard) -> String {
  match self {
    Install(namespace_~) | Authenticate(namespace_~) => namespace_
  }
}

///|
pub fn OfficialConnectCard::kind_label(self : OfficialConnectCard) -> String {
  match self {
    Install(_) => "Install"
    Authenticate(_) => "Authenticate"
  }
}

///|
/// Outcome of guiding the user to connect a namespace.
pub(all) enum ConnectGuideOutcome {
  OfficialCard(card~ : OfficialConnectCard)
  RefuseHomemadeUrl(url~ : String, reason~ : String)
  ReadyNoGuide
} derive(Eq, Debug)

///|
pub extend ConnectGuideOutcome with Eq::{equal, not_equal}

///|
pub extend ConnectGuideOutcome with Debug::{to_repr}

///|
pub fn ConnectGuideOutcome::is_official_only(
  self : ConnectGuideOutcome,
) -> Bool {
  match self {
    OfficialCard(_) | ReadyNoGuide => true
    RefuseHomemadeUrl(_) => false
  }
}

///|
pub fn ConnectGuideOutcome::has_homemade_url(
  self : ConnectGuideOutcome,
) -> Bool {
  match self {
    RefuseHomemadeUrl(_) => true
    _ => false
  }
}

///|
/// Detect homemade / unofficial connect URLs (assistant-invented links).
pub fn is_homemade_connect_url(url : String) -> Bool {
  if url.length() == 0 {
    return false
  }
  let lower = url
  // Official host markers — anything else that looks like a connect link is homemade.
  let official = lower.contains("cursor.com/") ||
    lower.contains("cursor.sh/") ||
    lower.contains("mcp.cursor") ||
    lower.has_prefix("cursor://")
  if official {
    return false
  }
  lower.has_prefix("http://") ||
  lower.has_prefix("https://") ||
  lower.contains("connect?") ||
  lower.contains("/oauth") ||
  lower.contains("auth.example") ||
  lower.has_prefix("homemade:")
}

///|
/// CM-2147: NeedsAuth → Authenticate card; NeedsGrant/unavailable install path → Install;
/// refuse if caller supplies a homemade URL instead of the official card.
pub fn guide_connect(
  ns : String,
  status : @connectors.ConnectorStatus,
  proposed_url~ : String? = None,
) -> ConnectGuideOutcome {
  match proposed_url {
    Some(url) =>
      if is_homemade_connect_url(url) {
        return RefuseHomemadeUrl(
          url~,
          reason="homemade connect URL forbidden; use official Install/Authenticate card",
        )
      }
    None => ()
  }
  match status {
    @connectors.Ready => ReadyNoGuide
    @connectors.NeedsAuth => OfficialCard(card=Authenticate(namespace_=ns))
    @connectors.NeedsGrant | @connectors.Loading | @connectors.Unavailable =>
      OfficialCard(card=Install(namespace_=ns))
    @connectors.Error(_) => OfficialCard(card=Install(namespace_=ns))
  }
}
