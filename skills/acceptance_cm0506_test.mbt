///|
/// CM-0506: skill-authoring meta-skill produces compliant SKILL.md.
test "acceptance_CM-0506_skill_authoring_produces_valid_skill_md" {
  let author = @skills.SkillAuthoring::seed()
  // Meta-skill itself is compliant.
  match @skills.validate_skill_md(author.meta_body()) {
    Ok(_) => ()
    Err(e) => fail("meta skill-authoring SKILL.md invalid: " + e)
  }
  assert_true(author.meta_body().contains(@skills.skill_authoring_name()))
  // Produce a new skill → valid SKILL.md
  match
    author.produce_skill_md(
      "triage-inbox", "Triage inbound mail and draft replies.", "1. Search threads\n2. Draft reply\n3. Stop before send",
    ) {
    Ok(md) => {
      match @skills.validate_skill_md(md) {
        Ok(_) => ()
        Err(e) => fail(e)
      }
      assert_true(md.has_prefix("---\n"))
      assert_true(md.contains("name: triage-inbox"))
      assert_true(md.contains("description: Triage inbound"))
      assert_true(md.contains("# triage-inbox"))
      assert_true(md.contains("Stop before send"))
    }
    Err(e) => fail(e)
  }
  // Empty fields rejected
  match author.produce_skill_md("", "d", "body") {
    Err(m) => assert_true(m.contains("name"))
    Ok(_) => fail("empty name must Err")
  }
  match author.produce_skill_md("x", "", "body") {
    Err(m) => assert_true(m.contains("description"))
    Ok(_) => fail("empty description must Err")
  }
  // Non-compliant raw text rejected by validator
  match @skills.validate_skill_md("# only heading\n") {
    Err(_) => ()
    Ok(_) => fail("missing frontmatter must Err")
  }
}
