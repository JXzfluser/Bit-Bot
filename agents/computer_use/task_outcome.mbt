///|
/// CM-1202: Task computerUse returns a wrapped structured outcome only
/// (no raw click/keystroke stream to the parent).
pub(all) struct TaskComputerUseReport {
  task_id : String
  outcome : ComputerUseOutcome
} derive(Eq, Debug)

///|
pub extend TaskComputerUseReport with Eq::{equal, not_equal}

///|
pub extend TaskComputerUseReport with Debug::{to_repr}

///|
/// Dispatch computerUse as a Task subagent; parent receives only the report.
pub fn run_computer_use_task(
  task_id~ : String,
  parent_turn_id~ : String,
  spec : ComputerUseSpec,
) -> Result[TaskComputerUseReport, String] {
  match dispatch_computer_use(task_id, parent_turn_id, spec) {
    Err(e) => Err(e)
    Ok((_handle, outcome)) => Ok({ task_id, outcome, })
  }
}

///|
/// Parent-facing view: only structured fields (wrap ComputerUseOutcome).
pub fn TaskComputerUseReport::parent_view(
  self : TaskComputerUseReport,
) -> ComputerUseOutcome {
  self.outcome
}
