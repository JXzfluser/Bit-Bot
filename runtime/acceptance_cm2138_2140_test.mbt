///|
/// J-batch P0: CM-2138 multi-effect batch, CM-2139 autonomy, CM-2140 honesty.

///|
/// CM-2138: one step needing multiple deliveries → Effect[] length ≥ 2.
test "acceptance_CM-2138_multi_effect_batch_ge2" {
  match
    @runtime.plan_multi_delivery_step_ge2(turn_id="t-j-2138", [
      "milestone one", "milestone two",
    ]) {
    Err(e) => fail(e)
    Ok(batch) => {
      assert_true(batch.len() >= 2)
      assert_eq(batch.effects.length(), 2)
      match batch.effects[0] {
        @tools.Deliver(turn_id~, body~) => {
          assert_eq(turn_id, "t-j-2138")
          assert_eq(body, "milestone one")
        }
        _ => fail("expected Deliver effect")
      }
      match batch.effects[1] {
        @tools.Deliver(_) => ()
        _ => fail("expected second Deliver")
      }
    }
  }
  match @runtime.plan_multi_delivery_step_ge2(turn_id="t", ["only-one"]) {
    Err(m) => assert_true(m.contains("≥2") || m.contains("2"))
    Ok(_) => fail("single delivery must not satisfy ge2")
  }
}

///|
/// CM-2139: reversible tidy inside delegated scope → proceed without asking.
test "acceptance_CM-2139_reversible_autonomy_no_ask" {
  let tidy = @runtime.AutonomyAction::{
    kind: @runtime.ReversibleTidy,
    summary: "organize scratch notes in /workspace",
  }
  let d = @runtime.decide_autonomy(tidy, in_delegated_scope=true)
  assert_true(d.proceeds_without_ask())
  assert_true(d is @runtime.ProceedNoAsk)
  // Irreversible still asks.
  let ext = @runtime.AutonomyAction::{
    kind: @runtime.IrreversibleExternal,
    summary: "send email",
  }
  let d2 = @runtime.decide_autonomy(ext, in_delegated_scope=true)
  assert_false(d2.proceeds_without_ask())
  // Out of scope refuses.
  let out = @runtime.AutonomyAction::{
    kind: @runtime.OutOfScope,
    summary: "touch unrelated tree",
  }
  let d3 = @runtime.decide_autonomy(out, in_delegated_scope=false)
  assert_true(d3 is @runtime.Refuse(_))
}

///|
/// CM-2140: missing data → explicitly admit gap + real path; no fabricated facts.
test "acceptance_CM-2140_no_fabricated_facts_admit_gap" {
  let ans = @runtime.answer_missing_data(
    available=None,
    question="What is the menu price for item X?",
    real_path="/workspace/data/menu-source.md",
  )
  assert_true(ans.admits_gap)
  assert_false(ans.fabricated)
  assert_true(ans.text.contains("missing") || ans.text.contains("do not have"))
  assert_eq(ans.real_path, Some("/workspace/data/menu-source.md"))
  assert_true(ans.text.contains("/workspace/data/menu-source.md"))
  // Fabricated markers rejected.
  match @runtime.reject_fabricated_answer("invented-menu-42 costs $9.99") {
    Err(m) => assert_true(m.contains("fabricated") || m.contains("gap"))
    Ok(_) => fail("fabricated answer must be rejected")
  }
  // Known fact without fabrication is fine.
  let ok = @runtime.answer_missing_data(
    available=Some("count from source = 3"),
    question="how many?",
    real_path="/workspace/data/counts.json",
  )
  assert_false(ok.admits_gap)
  assert_false(ok.fabricated)
  assert_eq(ok.text, "count from source = 3")
}
