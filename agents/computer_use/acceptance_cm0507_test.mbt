///|
/// CM-0507: site-playbooks — match site → Read first; Dispatch snippet into child task.
test "acceptance_CM-0507_site_playbook_snippet_to_computer_use" {
  let cat = @skills.SitePlaybookCatalog::seed_demo()
  match cat.match_site("https://www.airbnb.com/rooms/123") {
    Some(p) => assert_eq(p.name, "site-playbooks-airbnb")
    None => fail("airbnb URL must match site-playbooks-airbnb")
  }
  assert_false(cat.was_read("site-playbooks-airbnb"))
  match cat.prepare_dispatch("https://www.airbnb.com/rooms/123") {
    Err(e) => fail(e)
    Ok(dispatch) => {
      assert_true(dispatch.read_first)
      assert_true(cat.was_read("site-playbooks-airbnb"))
      assert_true(dispatch.snippet.length() > 0)
      assert_true(dispatch.child_task_prompt.contains(dispatch.snippet))
      match
        @computer_use.dispatch_site_playbook_snippet(
          agent_id="cu-0507",
          parent_turn_id="turn-0507",
          dispatch,
        ) {
        Err(e) => fail(e)
        Ok(child) => {
          assert_true(child.snippet_in_child_task())
          assert_eq(child.playbook_name, "site-playbooks-airbnb")
          assert_true(child.read_first)
          assert_false(child.handle.may_send_to_user)
        }
      }
    }
  }
}
