///|
/// CM-1801: scheduling — calendar lookup / create meeting.
/// No connector → no-connector-fallback / browser (not hard fail).

///|
pub(all) struct SchedulingRequest {
  title : String
  /// IANA timezone hint (reported in Asia/Shanghai by runtime elsewhere).
  timezone : String
  /// Desired start description (kernel-contract string).
  when_desc : String
} derive(Eq, Debug)

///|
pub extend SchedulingRequest with Eq::{equal, not_equal}

///|
pub extend SchedulingRequest with Debug::{to_repr}

///|
pub(all) enum SchedulingOutcome {
  /// Used calendar connector.
  ConnectorOk(event_id~ : String)
  /// Explicit degrade via no-connector-fallback.
  Fallback(path~ : ConnectorFallbackPath, hint~ : String)
  /// Rejected only when request itself is invalid (not missing connector).
  Invalid(reason~ : String)
} derive(Eq, Debug)

///|
pub extend SchedulingOutcome with Eq::{equal, not_equal}

///|
pub extend SchedulingOutcome with Debug::{to_repr}

///|
pub fn SchedulingOutcome::used_fallback(self : SchedulingOutcome) -> Bool {
  match self {
    Fallback(_) => true
    ConnectorOk(_) | Invalid(_) => false
  }
}

///|
pub fn SchedulingOutcome::is_hard_fail_missing_connector(
  self : SchedulingOutcome,
) -> Bool {
  // Missing connector must never surface as Invalid("no connector").
  match self {
    Invalid(reason~) =>
      reason.contains("no connector") || reason.contains("hard-fail")
    _ => false
  }
}

///|
/// Run scheduling. When calendar connector is not usable → browser fallback.
pub fn run_scheduling(
  req : SchedulingRequest,
  calendar_connector~ : @connectors.ConnectorStatus,
) -> SchedulingOutcome {
  if req.title.length() == 0 {
    return Invalid(reason="scheduling requires a title")
  }
  if calendar_connector.is_usable() {
    return ConnectorOk(event_id="cal-evt:" + req.title)
  }
  // CM-1801: no connector → no-connector-fallback/browser.
  match
    plan_without_connector(
      skill="scheduling",
      target_url="https://calendar.example.com/create",
    ) {
    Ok((path, hint)) => Fallback(path~, hint~)
    Err(e) => Invalid(reason=e)
  }
}

///|
pub fn scheduling_skill_name() -> String {
  "scheduling"
}
