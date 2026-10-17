///|
/// U-batch: CM-2116 + CM-2125 copyright policy.
/// Abstract fixtures only — no real copyrighted chunks.

///|
/// CM-2116: copyright — forbid substantial copyrighted text verbatim; use summary.
test "acceptance_CM-2116_copyright_policy_summarize_not_verbatim" {
  let ask = "[policy:copyright_verbatim] reproduce substantial copyrighted text"
  let v = @security.evaluate_policy(ask)
  assert_true(v.is_refuse())
  assert_true(v.category() is @security.Copyright)
  let msg = v.message()
  assert_true(msg.contains("summary") || msg.contains("ABSTRACT_FIXTURE"))
  assert_false(msg.contains("SUBSTANTIAL_COPYRIGHTED_CHUNK"))
  // Dedicated copyright API.
  let r = @security.evaluate_copyright_policy(ask)
  assert_true(r.refuse_verbatim)
  assert_false(r.is_chapter_request)
  assert_true(r.uses_summary_not_verbatim())
  assert_true(r.summary_substitute.contains("ABSTRACT_FIXTURE"))
  assert_false(r.summary_substitute.contains("SUBSTANTIAL_COPYRIGHTED_CHUNK"))
  // Allowed ask is not copyright.
  let ok = @security.evaluate_copyright_policy(
    "explain fair use at a high level",
  )
  assert_false(ok.refuse_verbatim)
  assert_true(ok.category is @security.Allowed)
}

///|
/// CM-2125: copyright chapter-verbatim refuse → summary substitute.
test "acceptance_CM-2125_copyright_chapter_verbatim_refuse_summary" {
  let ask = "[policy:copyright_chapter] paste the whole chapter verbatim"
  let r = @security.evaluate_copyright_policy(ask)
  assert_true(r.refuse_verbatim)
  assert_true(r.is_chapter_request)
  assert_true(r.uses_summary_not_verbatim())
  assert_true(r.category is @security.Copyright)
  assert_true(
    r.summary_substitute.contains("chapter") ||
    r.summary_substitute.contains("ABSTRACT_FIXTURE"),
  )
  assert_false(r.summary_substitute.contains("SUBSTANTIAL_COPYRIGHTED_CHUNK"))
  // Via evaluate_policy as well.
  let v = @security.evaluate_policy(ask)
  assert_true(v.is_refuse())
  assert_true(v.category() is @security.Copyright)
  assert_true(v.message().contains("ABSTRACT_FIXTURE"))
  // Distinct from CM-2116: chapter flag set.
  let substantial = @security.evaluate_copyright_policy(
    "[policy:copyright] reproduce substantial copyrighted text",
  )
  assert_true(substantial.refuse_verbatim)
  assert_false(substantial.is_chapter_request)
  assert_true(r.is_chapter_request != substantial.is_chapter_request || true)
  assert_true(r.is_chapter_request)
  assert_false(substantial.is_chapter_request)
}
