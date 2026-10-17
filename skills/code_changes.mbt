///|
/// CM-1810: code-changes — local/in-repo edit workflow discipline.
/// Coordinates with source-control (CM-1305); does not break mirror→origin rules.

///|
pub(all) enum CodeChangeScope {
  /// Edits only on the box /workspace (safe default).
  BoxWorkspace
  /// In-repo checkout on a registered machine (requires explicit user ask).
  MachineCheckout
} derive(Eq, Debug)

///|
pub extend CodeChangeScope with Eq::{equal, not_equal}

///|
pub extend CodeChangeScope with Debug::{to_repr}

///|
pub(all) struct CodeChangePlan {
  scope : CodeChangeScope
  /// Backend chosen via source-control routing.
  sc_backend : ScBackend
  repo_kind : ScRepoKind
  /// Paths to edit (must stay under allowed roots for BoxWorkspace).
  paths : Array[String]
  /// Origin triggers only when source-control allows.
  may_register_origin_trigger : Bool
} derive(Eq, Debug)

///|
pub extend CodeChangePlan with Eq::{equal, not_equal}

///|
pub extend CodeChangePlan with Debug::{to_repr}

///|
fn path_allowed_on_box(path : String) -> Bool {
  path.has_prefix("/workspace/") || path.has_prefix("/home/box/")
}

///|
/// Plan a code-changes workflow; routes SC via source-control skill APIs.
pub fn plan_code_changes(
  repo_kind~ : ScRepoKind,
  scope~ : CodeChangeScope,
  paths~ : Array[String],
  explicit_machine_ask~ : Bool = false,
) -> Result[CodeChangePlan, String] {
  if paths.length() == 0 {
    return Err("code-changes: paths required")
  }
  match scope {
    BoxWorkspace =>
      for p in paths {
        if !path_allowed_on_box(p) {
          return Err(
            "code-changes: box scope path must be under /workspace or /home/box: " +
            p,
          )
        }
      }
    MachineCheckout =>
      if !explicit_machine_ask {
        return Err(
          "code-changes: machine checkout requires explicit user ask (NG-007)",
        )
      }
  }
  let backend = route_source_control(repo_kind)
  let may_origin = allows_origin_trigger(repo_kind)
  Ok({
    scope,
    sc_backend: backend,
    repo_kind,
    paths,
    may_register_origin_trigger: may_origin,
  })
}

///|
/// Attempt origin trigger only when source-control allows (mirror must fail).
pub fn CodeChangePlan::try_origin_trigger(
  self : CodeChangePlan,
  repo~ : String,
  event~ : String,
) -> Result[String, String] {
  register_origin_trigger(self.repo_kind, repo~, event~)
}

///|
pub fn code_changes_skill_name() -> String {
  "code-changes"
}
