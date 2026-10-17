///|
/// CM-0417: automation_status reminder lists routines + folder ids; no prompt body; get full prompt.
test "acceptance_CM-0417_automation_status_no_prompt_body" {
  let store = @routines.RoutineStore::empty()
  let prompt_body = "FULL_PROMPT_BODY_secret_triage_steps_xyz"
  match
    store.create(@routines.RoutineSpec::{
      id: "r-folder-a",
      name: "inbox triage",
      prompt: prompt_body,
      trigger: @routines.Cron(expr="@daily"),
      timing: @routines.Exact,
      enabled: true,
      early_minutes: 0,
      late_minutes: 0,
    }) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match
    store.create(@routines.RoutineSpec::{
      id: "r-folder-b",
      name: "pr watch",
      prompt: "another " + prompt_body,
      trigger: @routines.Event(name="github:pr"),
      timing: @routines.Exact,
      enabled: true,
      early_minutes: 0,
      late_minutes: 0,
    }) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  let entries = [
    @runtime.RoutineStatusEntry::new(
      routine_id="r-folder-a",
      folder_id="fld-ops",
    ),
    @runtime.RoutineStatusEntry::new(
      routine_id="r-folder-b",
      folder_id="fld-eng",
    ),
  ]
  let reminder = @runtime.build_routines_status_reminder(entries)
  assert_true(reminder.contains("automation_status"))
  assert_true(reminder.contains("r-folder-a"))
  assert_true(reminder.contains("fld-ops"))
  assert_true(reminder.contains("r-folder-b"))
  assert_true(reminder.contains("fld-eng"))
  // Reminder has NO prompt body.
  assert_false(@runtime.reminder_contains_prompt_body(reminder, prompt_body))
  assert_false(reminder.contains(prompt_body))
  assert_false(reminder.contains("FULL_PROMPT_BODY"))
  // get retrieves full prompt.
  match store.get("r-folder-a") {
    Some(spec) => assert_eq(spec.prompt, prompt_body)
    None => fail("get must return full prompt")
  }
  match store.get("r-folder-b") {
    Some(spec) => assert_true(spec.prompt.contains(prompt_body))
    None => fail("get must return full prompt for b")
  }
  // Tracker path also builds the same style reminder.
  let tracker = @runtime.AutomationStatusTracker::new()
  let via_tracker = tracker.routines_reminder(entries)
  assert_false(@runtime.reminder_contains_prompt_body(via_tracker, prompt_body))
  assert_true(via_tracker.contains("fld-ops"))
}
