///|
/// CM-2156: short concrete style — product copy constraints; measurable sample check.
test "acceptance_CM-2156_short_concrete_style_guide_sampleable" {
  let rules = @runtime.style_guide_rule_labels()
  assert_true(rules.length() >= 4)
  // Pass samples (concrete + short + no fluff).
  let pass_a = @runtime.sample_style_guide_check(
    "Opened PR #12 on org/repo; waiting on CI.",
  )
  assert_true(pass_a.passes)
  assert_eq(pass_a.reason, "ok")
  let pass_b = @runtime.sample_style_guide_check(
    "Installed ripgrep via Shell (apt); ready to search.",
  )
  assert_true(pass_b.passes)
  match @runtime.assert_style_guide_ok("Need your pick: ship or defer.") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  // Fail: empty.
  let empty = @runtime.sample_style_guide_check("   ")
  assert_false(empty.passes)
  assert_eq(empty.reason, "empty")
  // Fail: fluff.
  let fluff = @runtime.sample_style_guide_check(
    "Leverage synergies going forward.",
  )
  assert_false(fluff.passes)
  assert_eq(fluff.reason, "fluff")
  let fluff2 = @runtime.sample_style_guide_check(
    "Just circling back to touch base.",
  )
  assert_false(fluff2.passes)
  // Fail: not concrete (vague without action/path/number).
  let vague = @runtime.sample_style_guide_check("Things are happening somehow.")
  assert_false(vague.passes)
  assert_true(vague.reason == "not_concrete" || vague.reason == "fluff")
  // Fail: too long.
  let long = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaX"
  assert_true(long.length() > @runtime.STYLE_GUIDE_MAX_ACK_CHARS)
  let long_s = @runtime.sample_style_guide_check(long)
  assert_false(long_s.passes)
  assert_eq(long_s.reason, "too_long")
  assert_true(@runtime.is_fluff_phrase("circle back tomorrow"))
  assert_true(@runtime.looks_concrete("run moon test"))
}
