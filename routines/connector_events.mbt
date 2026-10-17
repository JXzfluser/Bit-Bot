///|
/// CM-0409: event triggers for Teams / Linear / Sentry / PagerDuty.
/// Listener shapes + optional filter ids; missing connector → auto connect card.

///|
pub(all) enum ExternalEventConnector {
  Teams
  Linear
  Sentry
  PagerDuty
} derive(Eq, Debug)

///|
pub extend ExternalEventConnector with Eq::{equal, not_equal}

///|
pub extend ExternalEventConnector with Debug::{to_repr}

///|
pub fn ExternalEventConnector::label(self : ExternalEventConnector) -> String {
  match self {
    Teams => "microsoftTeams"
    Linear => "linear"
    Sentry => "sentry"
    PagerDuty => "pagerduty"
  }
}

///|
pub fn ExternalEventConnector::namespace_hint(
  self : ExternalEventConnector,
) -> String {
  match self {
    Teams => "user-Teams"
    Linear => "user-Linear"
    Sentry => "user-Sentry"
    PagerDuty => "user-PagerDuty"
  }
}

///|
/// Optional filter ids per connector (team/tenant, team key, project, service).
pub(all) struct ExternalListenerShape {
  connector : ExternalEventConnector
  /// Event kind string (e.g. message, issue.created, alert.triggered).
  event_kind : String
  /// Optional filter id (Teams team/channel, Linear team, Sentry project, PD service).
  filter_id : String?
  connector_connected : Bool
} derive(Eq, Debug)

///|
pub extend ExternalListenerShape with Eq::{equal, not_equal}

///|
pub extend ExternalListenerShape with Debug::{to_repr}

///|
fn non_empty(s : String) -> Bool {
  s.length() > 0
}

///|
/// CM-0409: validate listener shape (event kind required; filter id optional but non-empty if set).
pub fn validate_external_listener(
  shape : ExternalListenerShape,
) -> Result[Unit, String] {
  if !non_empty(shape.event_kind) {
    return Err("event_kind must not be empty for " + shape.connector.label())
  }
  match shape.filter_id {
    Some(id) =>
      if !non_empty(id) {
        return Err("filter_id if set must be non-empty")
      } else {
        ()
      }
    None => ()
  }
  // Connector-specific event kind hints (shape parse, not live wiring).
  match shape.connector {
    Teams =>
      if shape.event_kind == "message" ||
        shape.event_kind == "mention" ||
        shape.event_kind == "channel" {
        Ok(())
      } else {
        Err("unknown Teams event_kind: " + shape.event_kind)
      }
    Linear =>
      if shape.event_kind.has_prefix("issue.") || shape.event_kind == "comment" {
        Ok(())
      } else {
        Err("unknown Linear event_kind: " + shape.event_kind)
      }
    Sentry =>
      if shape.event_kind.has_prefix("issue.") ||
        shape.event_kind == "error" ||
        shape.event_kind == "alert" {
        Ok(())
      } else {
        Err("unknown Sentry event_kind: " + shape.event_kind)
      }
    PagerDuty =>
      if shape.event_kind.has_prefix("incident.") ||
        shape.event_kind == "alert.triggered" ||
        shape.event_kind == "alert.resolved" {
        Ok(())
      } else {
        Err("unknown PagerDuty event_kind: " + shape.event_kind)
      }
  }
}

///|
/// Auto card when connector is missing / not connected.
pub(all) struct MissingConnectorAutoCard {
  connector : ExternalEventConnector
  namespace_hint : String
  reason : String
  shown : Bool
} derive(Eq, Debug)

///|
pub extend MissingConnectorAutoCard with Eq::{equal, not_equal}

///|
pub extend MissingConnectorAutoCard with Debug::{to_repr}

///|
pub fn MissingConnectorAutoCard::is_auto_card(
  self : MissingConnectorAutoCard,
) -> Bool {
  self.shown && self.reason.length() > 0
}

///|
/// Outcome of preparing an external event listener (CM-0409).
pub(all) enum ExternalListenerPrep {
  Ready(shape~ : ExternalListenerShape)
  ShowAutoCard(card~ : MissingConnectorAutoCard)
  Invalid(reason~ : String)
} derive(Eq, Debug)

///|
pub extend ExternalListenerPrep with Eq::{equal, not_equal}

///|
pub extend ExternalListenerPrep with Debug::{to_repr}

///|
/// CM-0409: parse/validate shape; missing connector → automatic connect card.
pub fn prepare_external_listener(
  shape : ExternalListenerShape,
) -> ExternalListenerPrep {
  match validate_external_listener(shape) {
    Err(e) => Invalid(reason=e)
    Ok(_) =>
      if shape.connector_connected {
        Ready(shape~)
      } else {
        ShowAutoCard(card={
          connector: shape.connector,
          namespace_hint: shape.connector.namespace_hint(),
          reason: "connector missing: connect " +
          shape.connector.label() +
          " to enable event trigger",
          shown: true,
        })
      }
  }
}

///|
pub fn ExternalListenerPrep::is_auto_card(self : ExternalListenerPrep) -> Bool {
  match self {
    ShowAutoCard(card~) => card.is_auto_card()
    Ready(_) | Invalid(_) => false
  }
}
