///|
/// CM-2165 / CM-2166: routine silent_ok + break-silence when notable.

///|
/// Outcome of a routine run used by silence policy.
pub(all) struct RoutineRunOutcome {
  /// Explicit notable flag (user-visible change, alert threshold, etc.).
  notable : Bool
  failure : Bool
  needs_approval : Bool
  needs_user_decision : Bool
  /// Result payload written to store/memory (not a user bubble).
  store_note : String
} derive(Eq, Debug)

///|
pub extend RoutineRunOutcome with Eq::{equal, not_equal}

///|
pub extend RoutineRunOutcome with Debug::{to_repr}

///|
pub fn RoutineRunOutcome::quiet_success(
  store_note~ : String,
) -> RoutineRunOutcome {
  {
    notable: false,
    failure: false,
    needs_approval: false,
    needs_user_decision: false,
    store_note,
  }
}

///|
pub fn RoutineRunOutcome::with_failure(message~ : String) -> RoutineRunOutcome {
  {
    notable: true,
    failure: true,
    needs_approval: false,
    needs_user_decision: false,
    store_note: message,
  }
}

///|
/// Routine silence preference.
pub(all) struct SilencePolicy {
  silent_ok : Bool
} derive(Eq, Debug)

///|
pub extend SilencePolicy with Eq::{equal, not_equal}

///|
pub extend SilencePolicy with Debug::{to_repr}

///|
pub fn SilencePolicy::silent_ok() -> SilencePolicy {
  { silent_ok: true, }
}

///|
pub fn SilencePolicy::always_notify() -> SilencePolicy {
  { silent_ok: false, }
}

///|
/// Delivery decision after applying silence policy.
pub(all) enum RoutineDeliveryDecision {
  StaySilent(store_note~ : String)
  SendToUser(reason~ : String, body~ : String)
} derive(Eq, Debug)

///|
pub extend RoutineDeliveryDecision with Eq::{equal, not_equal}

///|
pub extend RoutineDeliveryDecision with Debug::{to_repr}

///|
pub fn RoutineDeliveryDecision::sends_to_user(
  self : RoutineDeliveryDecision,
) -> Bool {
  match self {
    StaySilent(_) => false
    SendToUser(_) => true
  }
}

///|
/// Measurable break-silence conditions (CM-2166).
pub fn is_break_silence_notable(outcome : RoutineRunOutcome) -> Bool {
  outcome.notable ||
  outcome.failure ||
  outcome.needs_approval ||
  outcome.needs_user_decision
}

///|
/// CM-2165 + CM-2166: decide whether to SendToUser.
/// silent_ok + nothing notable → StaySilent (no unnecessary SendToUser).
/// Break silence when notable / failure / approval / user decision.
pub fn decide_routine_delivery(
  policy : SilencePolicy,
  outcome : RoutineRunOutcome,
) -> RoutineDeliveryDecision {
  if is_break_silence_notable(outcome) {
    let reason = if outcome.failure {
      "failure"
    } else if outcome.needs_approval {
      "needs_approval"
    } else if outcome.needs_user_decision {
      "needs_user_decision"
    } else {
      "notable"
    }
    return SendToUser(reason~, body=outcome.store_note)
  }
  if policy.silent_ok {
    StaySilent(store_note=outcome.store_note)
  } else {
    SendToUser(reason="silent_ok_false", body=outcome.store_note)
  }
}

///|
/// CM-2165 helper: silent_ok + quiet success must not SendToUser.
pub fn silent_ok_no_send_when_quiet(
  outcome : RoutineRunOutcome,
) -> Result[Unit, String] {
  let d = decide_routine_delivery(SilencePolicy::silent_ok(), outcome)
  if d.sends_to_user() {
    Err("silent_ok must not SendToUser when nothing notable")
  } else {
    Ok(())
  }
}

///|
/// CM-2166 helper: notable conditions must break silence.
pub fn break_silence_when_notable(
  outcome : RoutineRunOutcome,
) -> Result[RoutineDeliveryDecision, String] {
  if !is_break_silence_notable(outcome) {
    return Err("outcome is not notable; cannot assert break-silence")
  }
  let d = decide_routine_delivery(SilencePolicy::silent_ok(), outcome)
  if !d.sends_to_user() {
    Err("notable outcome must break silence and SendToUser")
  } else {
    Ok(d)
  }
}
