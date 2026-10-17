///|
/// CM-2139: reversible actions inside delegated scope proceed without asking.

///|
pub(all) enum AutonomyActionKind {
  ReversibleTidy
  IrreversibleExternal
  OutOfScope
} derive(Eq, Debug)

///|
pub extend AutonomyActionKind with Eq::{equal, not_equal}

///|
pub extend AutonomyActionKind with Debug::{to_repr}

///|
pub(all) struct AutonomyAction {
  kind : AutonomyActionKind
  summary : String
} derive(Eq, Debug)

///|
pub extend AutonomyAction with Eq::{equal, not_equal}

///|
pub extend AutonomyAction with Debug::{to_repr}

///|
pub(all) enum AutonomyDecision {
  ProceedNoAsk
  AskUser(reason~ : String)
  Refuse(reason~ : String)
} derive(Eq, Debug)

///|
pub extend AutonomyDecision with Eq::{equal, not_equal}

///|
pub extend AutonomyDecision with Debug::{to_repr}

///|
pub fn AutonomyDecision::proceeds_without_ask(self : AutonomyDecision) -> Bool {
  match self {
    ProceedNoAsk => true
    AskUser(_) | Refuse(_) => false
  }
}

///|
/// CM-2139: reversible tidy inside delegated scope → proceed without asking.
pub fn decide_autonomy(
  action : AutonomyAction,
  in_delegated_scope~ : Bool,
) -> AutonomyDecision {
  match action.kind {
    ReversibleTidy =>
      if in_delegated_scope {
        ProceedNoAsk
      } else {
        AskUser(reason="reversible tidy outside delegated scope")
      }
    IrreversibleExternal =>
      AskUser(reason="irreversible external requires user confirmation")
    OutOfScope => Refuse(reason="action outside authorized scope")
  }
}
