///|
/// CM-2146: connector app identity vs user identity — switch to signed-in browser when required.
/// Kernel-contract only.

///|
pub(all) enum ConnectorIdentityKind {
  /// App / client-credentials style identity (insufficient for user-scoped actions).
  AppIdentity
  /// User signed-in browser session.
  UserBrowserSession
} derive(Eq, Debug)

///|
pub extend ConnectorIdentityKind with Eq::{equal, not_equal}

///|
pub extend ConnectorIdentityKind with Debug::{to_repr}

///|
pub fn ConnectorIdentityKind::label(self : ConnectorIdentityKind) -> String {
  match self {
    AppIdentity => "app"
    UserBrowserSession => "user-browser"
  }
}

///|
pub(all) enum IdentityRequirement {
  AppSufficient
  UserIdentityRequired
} derive(Eq, Debug)

///|
pub extend IdentityRequirement with Eq::{equal, not_equal}

///|
pub extend IdentityRequirement with Debug::{to_repr}

///|
pub(all) enum IdentityResolution {
  /// Current identity is enough.
  Proceed(identity~ : ConnectorIdentityKind)
  /// App identity insufficient — switch to signed-in browser session.
  SwitchToSignedInBrowser(reason~ : String)
} derive(Eq, Debug)

///|
pub extend IdentityResolution with Eq::{equal, not_equal}

///|
pub extend IdentityResolution with Debug::{to_repr}

///|
pub fn IdentityResolution::switched_to_browser(
  self : IdentityResolution,
) -> Bool {
  match self {
    SwitchToSignedInBrowser(_) => true
    Proceed(_) => false
  }
}

///|
/// Given app identity insufficient When user identity required Then switch to signed-in browser.
pub fn resolve_connector_identity(
  current : ConnectorIdentityKind,
  required : IdentityRequirement,
) -> IdentityResolution {
  match required {
    AppSufficient => Proceed(identity=current)
    UserIdentityRequired =>
      match current {
        UserBrowserSession => Proceed(identity=UserBrowserSession)
        AppIdentity =>
          SwitchToSignedInBrowser(
            reason="app identity insufficient; switch to signed-in browser session",
          )
      }
  }
}

///|
/// Apply resolution: if switch required, session becomes UserBrowserSession.
pub(all) struct ConnectorIdentitySession {
  mut identity : ConnectorIdentityKind
  mut switched : Bool
}

///|
pub fn ConnectorIdentitySession::new(
  identity : ConnectorIdentityKind,
) -> ConnectorIdentitySession {
  { identity, switched: false, }
}

///|
pub fn ConnectorIdentitySession::ensure(
  self : ConnectorIdentitySession,
  required : IdentityRequirement,
) -> IdentityResolution {
  let res = resolve_connector_identity(self.identity, required)
  match res {
    SwitchToSignedInBrowser(_) => {
      self.identity = UserBrowserSession
      self.switched = true
    }
    Proceed(_) => ()
  }
  res
}

///|
pub fn ConnectorIdentitySession::is_user_browser(
  self : ConnectorIdentitySession,
) -> Bool {
  self.identity is UserBrowserSession
}
