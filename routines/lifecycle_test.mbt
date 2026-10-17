///|
/// CM-0401: create / get / update (edit-from-get, not rewrite from memory).
test "acceptance_cm0401_create_get_update" {
  let store = @routines.RoutineStore::empty()
  let spec = @routines.RoutineSpec::{
    id: "r-morning",
    name: "morning brief",
    prompt: "Summarize inbox; deliver to user.",
    trigger: @routines.Cron(expr="0 9 * * 1-5"),
    timing: @routines.Flexible,
    enabled: true,
    early_minutes: 15,
    late_minutes: 15,
  }
  match store.create(spec) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match store.get("r-morning") {
    None => fail("get must return spec")
    Some(got) => {
      assert_eq(got.prompt, "Summarize inbox; deliver to user.")
      assert_eq(got.trigger, @routines.Cron(expr="0 9 * * 1-5"))
      assert_eq(got.timing, @routines.Flexible)
      // Edit-from-get: patch prompt only
      let patch = @routines.RoutinePatch::empty()
      // Rebuild patch with prompt
      let patch2 = @routines.RoutinePatch::{
        name: None,
        prompt: Some(got.prompt + " Prefer bullets."),
        trigger: None,
        timing: None,
        enabled: None,
        early_minutes: None,
        late_minutes: None,
      }
      match store.update("r-morning", patch2) {
        Ok(_) => ()
        Err(e) => fail(e)
      }
      match store.get("r-morning") {
        Some(u) => {
          assert_true(u.prompt.contains("Prefer bullets"))
          assert_eq(u.name, "morning brief")
          assert_eq(u.trigger, @routines.Cron(expr="0 9 * * 1-5"))
        }
        None => fail("missing after update")
      }
      let _ = patch
    }
  }
}

///|
/// CM-0402: cron validation — 5-field, macros, @every ≥5m.
test "acceptance_cm0402_validate_cron" {
  assert_true(@routines.validate_cron("0 9 * * 1-5") is Ok(_))
  assert_true(@routines.validate_cron("@hourly") is Ok(_))
  assert_true(@routines.validate_cron("@now") is Ok(_))
  assert_true(@routines.validate_cron("@once") is Ok(_))
  assert_true(@routines.validate_cron("@daily") is Ok(_))
  assert_true(@routines.validate_cron("@weekly") is Ok(_))
  assert_true(@routines.validate_cron("@every 5m") is Ok(_))
  assert_true(@routines.validate_cron("@every 15m") is Ok(_))
  assert_true(@routines.validate_cron("@every 4m") is Err(_))
  assert_true(@routines.validate_cron("@every 1m") is Err(_))
  assert_true(@routines.validate_cron("0 9 *") is Err(_))
}

///|
/// CM-0413: pause stops fireable; resume restores.
test "acceptance_cm0413_pause_resume" {
  let store = @routines.RoutineStore::empty()
  match
    store.create(@routines.RoutineSpec::{
      id: "r-watch",
      name: "watch",
      prompt: "check status",
      trigger: @routines.Cron(expr="@every 10m"),
      timing: @routines.Exact,
      enabled: true,
      early_minutes: 0,
      late_minutes: 0,
    }) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_true(store.is_fireable("r-watch"))
  match store.pause("r-watch") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_false(store.is_fireable("r-watch"))
  assert_eq(store.lifecycle_of("r-watch"), Some(@routines.Paused))
  match store.resume_routine("r-watch") {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_true(store.is_fireable("r-watch"))
  assert_eq(store.lifecycle_of("r-watch"), Some(@routines.Active))
}

///|
/// CM-0402: user IANA tz default; CRON_TZ= prefix overrides; resolved_tz exposed.
test "acceptance_CM-0402_user_tz_and_cron_tz" {
  let ctx = @routines.CronContext::new(
    user_tz="Asia/Shanghai",
    expr="0 9 * * 1-5",
  )
  assert_eq(ctx.resolved_tz(), "Asia/Shanghai")
  assert_eq(ctx.cron_body(), "0 9 * * 1-5")
  match ctx.validate() {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  let utc = @routines.CronContext::new(
    user_tz="Asia/Shanghai",
    expr="CRON_TZ=UTC 0 9 * * 1-5",
  )
  assert_eq(utc.resolved_tz(), "UTC")
  assert_eq(utc.cron_body(), "0 9 * * 1-5")
  match utc.validate() {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  let ny = @routines.CronContext::new(
    user_tz="Asia/Shanghai",
    expr="CRON_TZ=America/New_York @hourly",
  )
  assert_eq(ny.resolved_tz(), "America/New_York")
  assert_eq(ny.cron_body(), "@hourly")
  match ny.validate() {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  // Prefixed dense @every still rejected.
  let dense = @routines.CronContext::new(
    user_tz="Asia/Shanghai",
    expr="CRON_TZ=UTC @every 1m",
  )
  assert_eq(dense.resolved_tz(), "UTC")
  match dense.validate() {
    Err(_) => ()
    Ok(_) => fail("dense @every must reject")
  }
  // validate_cron itself accepts CRON_TZ= prefix.
  assert_true(@routines.validate_cron("CRON_TZ=UTC 0 9 * * *") is Ok(_))
  assert_true(@routines.validate_cron("CRON_TZ=UTC @every 5m") is Ok(_))
}
