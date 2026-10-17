///|
/// CM-1808: learn-from-demonstration — crystallize into skill draft.
test "acceptance_CM-1808_learn_from_demonstration_skill_draft" {
  assert_eq(
    @skills.learn_from_demonstration_skill_name(),
    "learn-from-demonstration",
  )
  let demo = @skills.Demonstration::of(
    title="Weekly expense report",
    steps=[
      { kind: "navigate", detail: "Open finance spreadsheet", },
      { kind: "fill", detail: "Enter line items from receipts", },
      { kind: "export", detail: "Export CSV to /workspace/out", },
    ],
  )
  match
    @skills.crystallize_demonstration_to_skill_draft(
      demo,
      skill_name="expense-report-flow",
    ) {
    Err(e) => fail(e)
    Ok(draft) => {
      assert_eq(draft.name, "expense-report-flow")
      assert_true(draft.description.contains("demonstration"))
      assert_true(draft.body.contains("Open finance spreadsheet"))
      assert_true(draft.body.contains("Export CSV"))
      let md = draft.to_skill_md()
      match @skills.validate_skill_md(md) {
        Err(e) => fail(e)
        Ok(_) => {
          assert_true(md.has_prefix("---\n"))
          assert_true(md.contains("name: expense-report-flow"))
          assert_true(md.contains("# expense-report-flow"))
        }
      }
    }
  }
  match demo.to_skill_md_draft() {
    Err(e) => fail(e)
    Ok(md) => assert_true(md.contains("Weekly expense report") || md.contains("learned-"))
  }
  match
    @skills.crystallize_demonstration_to_skill_draft(
      @skills.Demonstration::of(title="empty", steps=[]),
    ) {
    Err(m) => assert_true(m.contains("step"))
    Ok(_) => fail("empty steps must Err")
  }
}
