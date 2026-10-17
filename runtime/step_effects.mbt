///|
/// CM-2138: one step may return multiple Host effects (Effect[] ≥ 2).

///|
pub(all) struct StepEffectBatch {
  effects : Array[@tools.Effect]
} derive(Eq, Debug)

///|
pub extend StepEffectBatch with Eq::{equal, not_equal}

///|
pub extend StepEffectBatch with Debug::{to_repr}

///|
pub fn StepEffectBatch::len(self : StepEffectBatch) -> Int32 {
  self.effects.length()
}

///|
/// Plan multiple Deliver effects for one step that needs ≥2 deliveries.
pub fn plan_multi_delivery_step(
  turn_id~ : String,
  bodies : Array[String],
) -> StepEffectBatch {
  let effects : Array[@tools.Effect] = []
  for b in bodies {
    effects.push(@tools.Deliver(turn_id~, body=b))
  }
  { effects, }
}

///|
/// Convenience: require at least two deliveries in the batch.
pub fn plan_multi_delivery_step_ge2(
  turn_id~ : String,
  bodies : Array[String],
) -> Result[StepEffectBatch, String] {
  if bodies.length() < 2 {
    Err("multi-effect batch requires ≥2 deliveries")
  } else {
    Ok(plan_multi_delivery_step(turn_id~, bodies))
  }
}
