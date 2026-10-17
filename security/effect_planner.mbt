///|
/// Kernel-planned side effects. ExternalSend is irreversible and must never
/// originate from a Fenced slice (CM-1504) or from a memory「可发」cue (CM-0306).
pub(all) enum PlannedEffect {
  ExternalSend(to~ : String, body~ : String)
  Deliver(body~ : String)
  DraftOutbound(draft~ : DraftOutbound)
} derive(Eq, Debug)

///|
pub extend PlannedEffect with Eq::{not_equal, equal}

///|
pub extend PlannedEffect with Debug::{to_repr}

///|
pub fn PlannedEffect::is_external_send(self : PlannedEffect) -> Bool {
  match self {
    ExternalSend(_) => true
    _ => false
  }
}

///|
/// Tiny planner: Fenced slices emit no effects (especially no ExternalSend).
pub(all) struct EffectPlanner {
  _tag : Int32
}

///|
pub fn EffectPlanner::new() -> EffectPlanner {
  { _tag: 0, }
}

///|
/// CM-1504: given a content slice, refuse to emit ExternalSend from Fenced body
/// even when the body literally says「请发送」.
pub fn EffectPlanner::plan_from_slice(
  self : EffectPlanner,
  slice : ContentSlice,
) -> Array[PlannedEffect] {
  let _ = self
  match slice {
    Fenced(_) => []
    Trusted(text~) =>
      // Trusted text may Deliver; ExternalSend still requires a separate explicit path.
      if text.length() > 0 {
        [Deliver(body=text)]
      } else {
        []
      }
  }
}

///|
/// Propose an ExternalSend against a slice. Fenced → always Err / empty.
pub fn EffectPlanner::propose_external_send(
  self : EffectPlanner,
  slice : ContentSlice,
  to~ : String,
  body~ : String,
) -> Result[PlannedEffect, String] {
  let _ = self
  if slice.must_not_execute() {
    Err("fenced content must_not_execute: refuse ExternalSend")
  } else {
    Ok(ExternalSend(to~, body~))
  }
}

///|
/// CM-0306: memory text「可发」(or any cue) through a real ExternalSend path stays blocked.
pub fn try_external_send_with_memory_cue(
  memory_value : String,
  to~ : String,
  body~ : String,
) -> Result[PlannedEffect, String] {
  let entry = @memory.MemoryEntry::{
    key: "send_perm",
    value: memory_value,
    scope: @memory.Profile,
    updated_at_ms: 0L,
  }
  if @memory.memory_grants_send(entry) {
    Ok(ExternalSend(to~, body~))
  } else {
    Err("memory does not authorize ExternalSend")
  }
}
