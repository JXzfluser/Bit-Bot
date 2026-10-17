///|
/// CM-2104: independent read-only tools may emit in parallel in the same turn
/// (e.g. two WebSearch / Read).

///|
pub(all) enum ToolMutability {
  ReadOnly
  Mutating
} derive(Eq, Debug)

///|
pub extend ToolMutability with Eq::{equal, not_equal}

///|
pub extend ToolMutability with Debug::{to_repr}

///|
pub(all) struct PlannedToolEmit {
  name : String
  args_json : String
  mutability : ToolMutability
} derive(Eq, Debug)

///|
pub extend PlannedToolEmit with Eq::{equal, not_equal}

///|
pub extend PlannedToolEmit with Debug::{to_repr}

///|
/// Result of planning same-turn tool emissions.
pub(all) struct ParallelToolPlan {
  /// Batches that may run concurrently (each batch is one parallel wave).
  parallel_batches : Array[Array[PlannedToolEmit]]
  /// Tools that must run sequentially (mutating or dependent).
  sequential : Array[PlannedToolEmit]
} derive(Eq, Debug)

///|
pub extend ParallelToolPlan with Eq::{equal, not_equal}

///|
pub extend ParallelToolPlan with Debug::{to_repr}

///|
fn is_known_readonly(name : String) -> Bool {
  name == "WebSearch" ||
  name == "Read" ||
  name == "WebFetch" ||
  name == "GetDynamicTools" ||
  name == "ListMachines"
}

///|
/// Classify a tool name as read-only when independent and non-mutating.
pub fn classify_tool_mutability(name : String) -> ToolMutability {
  if is_known_readonly(name) {
    ReadOnly
  } else {
    Mutating
  }
}

///|
/// CM-2104: independent read-only tools → one parallel batch; mutating stay sequential.
pub fn plan_parallel_readonly_emits(
  tools : Array[PlannedToolEmit],
) -> ParallelToolPlan {
  let readonly_batch : Array[PlannedToolEmit] = []
  let sequential : Array[PlannedToolEmit] = []
  for t in tools {
    let m = match t.mutability {
      ReadOnly => ReadOnly
      Mutating => Mutating
    }
    // Re-check name for safety.
    let effective = if m is ReadOnly || is_known_readonly(t.name) {
      if t.mutability is Mutating && !is_known_readonly(t.name) {
        Mutating
      } else if is_known_readonly(t.name) {
        ReadOnly
      } else {
        t.mutability
      }
    } else {
      t.mutability
    }
    match effective {
      ReadOnly => readonly_batch.push(t)
      Mutating => sequential.push(t)
    }
  }
  let parallel_batches : Array[Array[PlannedToolEmit]] = []
  if readonly_batch.length() >= 2 {
    parallel_batches.push(readonly_batch)
  } else if readonly_batch.length() == 1 {
    // Single readonly still emits, but not "parallel" — keep in sequential wave.
    sequential.push(readonly_batch[0])
  }
  { parallel_batches, sequential, }
}

///|
pub fn ParallelToolPlan::can_emit_parallel(self : ParallelToolPlan) -> Bool {
  if self.parallel_batches.length() == 0 {
    return false
  }
  self.parallel_batches[0].length() >= 2
}

///|
/// Emit two independent WebSearch/Read in the same turn (acceptance helper).
pub fn emit_two_readonly_same_turn(
  a_name~ : String,
  a_args~ : String,
  b_name~ : String,
  b_args~ : String,
) -> Result[ParallelToolPlan, String] {
  let a_m = classify_tool_mutability(a_name)
  let b_m = classify_tool_mutability(b_name)
  match (a_m, b_m) {
    (ReadOnly, ReadOnly) => {
      let plan = plan_parallel_readonly_emits([
        { name: a_name, args_json: a_args, mutability: ReadOnly, },
        { name: b_name, args_json: b_args, mutability: ReadOnly, },
      ])
      if plan.can_emit_parallel() {
        Ok(plan)
      } else {
        Err("expected parallel batch of two read-only tools")
      }
    }
    _ => Err("both tools must be read-only for parallel same-turn emit")
  }
}
