///|
/// CM-1806: job-search / linkedin playbook — readonly search flow runnable.
test "acceptance_CM-1806_job_search_linkedin_readonly_flow" {
  assert_eq(@skills.job_search_skill_name(), "job-search")
  assert_eq(@skills.linkedin_playbook_skill_name(), "site-playbooks-linkedin")
  assert_true(@skills.job_search_skill_trigger_hit("job search on linkedin"))
  let host = @skills.JobSearchHost::mock()
  match host.run_linkedin_readonly_search(query="engineer") {
    Err(e) => fail(e)
    Ok(res) => {
      assert_true(res.readonly_)
      assert_eq(res.playbook_name, "site-playbooks-linkedin")
      assert_eq(res.query, "engineer")
      assert_true(res.hit_count >= 1)
      assert_true(res.snippets.length() >= 1)
      assert_true(res.snippets[0].contains("LinkedIn") || res.snippets[0].contains("engineer"))
    }
  }
  // Readonly: apply/message rejected.
  match host.try_apply_or_message("apply") {
    Err(m) => assert_true(m.contains("readonly") || m.contains("not allowed"))
    Ok(_) => fail("apply must be rejected on readonly job-search")
  }
  match host.run_linkedin_readonly_search(query="") {
    Err(m) => assert_true(m.contains("query") || m.contains("empty"))
    Ok(_) => fail("empty query must Err")
  }
}
