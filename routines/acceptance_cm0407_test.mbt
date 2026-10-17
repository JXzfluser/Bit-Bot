///|
/// CM-0407: GitHub PR babysit default package; terminal state auto-deletes listener/routine.
test "acceptance_CM-0407_github_event_trigger_pr_babysit" {
  match
    @routines.validate_github_listener(@routines.GithubListenerShape::{
      event: @routines.Pr,
      pr_scope: Some("owner/repo#42"),
      user_allowlist: ["alice"],
    }) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match
    @routines.validate_github_listener(@routines.GithubListenerShape::{
      event: @routines.Pr,
      pr_scope: None,
      user_allowlist: [],
    }) {
    Err(m) => assert_true(m.contains("pr_scope"))
    Ok(_) => fail("pr without scope must Err")
  }
  let spec = @routines.pr_babysit_default_package(
    routine_id="pr-babysit-42",
    pr_ref="owner/repo#42",
  )
  assert_true(spec.name.contains("babysit") || spec.name.contains("PR"))
  assert_true(spec.prompt.contains("owner/repo#42"))
  match spec.trigger {
    @routines.Event(name~) => {
      assert_true(name.contains("github"))
      assert_true(name.contains("pr"))
    }
    _ => fail("babysit package must use Event trigger")
  }
  let store = @routines.RoutineStore::empty()
  match store.create(spec) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_true(store.get("pr-babysit-42") is Some(_))
  // Open → not deleted.
  match store.handle_pr_terminal("pr-babysit-42", @routines.Open) {
    Ok(false) => assert_true(store.get("pr-babysit-42") is Some(_))
    Ok(true) => fail("Open must not delete")
    Err(e) => fail(e)
  }
  // Merged → auto-delete.
  match store.handle_pr_terminal("pr-babysit-42", @routines.Merged) {
    Ok(true) => assert_true(store.get("pr-babysit-42") is None)
    Ok(false) => fail("Merged must delete")
    Err(e) => fail(e)
  }
  // Recreate and Closed → delete.
  match
    store.create(
      @routines.pr_babysit_default_package(
        routine_id="pr-babysit-7",
        pr_ref="owner/repo#7",
      ),
    ) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match store.handle_pr_terminal("pr-babysit-7", @routines.Closed) {
    Ok(true) => assert_true(store.get("pr-babysit-7") is None)
    Ok(false) => fail("Closed must delete")
    Err(e) => fail(e)
  }
}
