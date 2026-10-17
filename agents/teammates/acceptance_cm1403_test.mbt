///|
/// CM-1403: sections collaboration partitions — group section context;
/// section message isolation testable.
test "acceptance_CM-1403_teammate_sections_message_isolation" {
  let group = @teammates.GroupSections::new("group-alpha")
  match group.add_section(id="sec-research", title="Research") {
    Ok(s) => {
      assert_eq(s.group_id, "group-alpha")
      assert_eq(s.id, "sec-research")
    }
    Err(e) => fail(e)
  }
  match group.add_section(id="sec-ops", title="Ops") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_eq(group.section_ids().length(), 2)
  match
    group.post(
      section_id="sec-research",
      from_agent="asst-a",
      body="findings in research only",
    ) {
    Ok(m) => assert_eq(m.section_id, "sec-research")
    Err(e) => fail(e)
  }
  match
    group.post(
      section_id="sec-ops",
      from_agent="asst-b",
      body="ops runbook private",
    ) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  let research = group.messages_in("sec-research")
  let ops = group.messages_in("sec-ops")
  assert_eq(research.length(), 1)
  assert_eq(ops.length(), 1)
  assert_eq(research[0].body, "findings in research only")
  assert_eq(ops[0].body, "ops runbook private")
  // Isolation: research list has no ops bodies.
  assert_false(research[0].body.contains("ops"))
  assert_false(ops[0].body.contains("research"))
  match group.assert_isolation("sec-research", "sec-ops") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  // Unknown section refused.
  match group.post(section_id="missing", from_agent="x", body="y") {
    Err(m) => assert_true(m.contains("unknown"))
    Ok(_) => fail("unknown section must Err")
  }
}
