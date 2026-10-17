///|
/// CM-0505: UpdateSkill — after update, next trigger uses new body.
test "acceptance_CM-0505_update_skill_next_trigger_new_body" {
  let cat = @skills.UnifiedCatalog::with_managed(@skills.ManagedCatalog::seed())
  cat.add_user_skill(@skills.UserSkill::{
    name: "my-triage",
    description: "Triage workflow",
    skill_md: "# my-triage\n\nOLD_BODY_v1\n",
  })
  match cat.next_trigger_body("my-triage") {
    Ok(body) => assert_true(body.contains("OLD_BODY_v1"))
    Err(e) => fail(e)
  }
  match
    cat.update_skill("my-triage", "# my-triage\n\nNEW_BODY_v2_after_update\n") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match cat.next_trigger_body("my-triage") {
    Ok(body) => {
      assert_true(body.contains("NEW_BODY_v2_after_update"))
      assert_false(body.contains("OLD_BODY_v1"))
    }
    Err(e) => fail(e)
  }
  match cat.resolve("my-triage") {
    Some(r) => assert_true(r.skill_md.contains("NEW_BODY_v2_after_update"))
    None => fail("skill must still resolve after UpdateSkill")
  }
  // Managed skills are not writable.
  match cat.update_skill("agent-email", "hacked") {
    Err(msg) => assert_true(msg.contains("writable") || msg.contains("user"))
    Ok(_) => fail("managed skill must not be UpdateSkill-writable")
  }
}
