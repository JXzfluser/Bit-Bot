///|
test "routine lifecycle" {
  let life = @routines.Lifecycle::new()
  life.activate()
  assert_eq(life.state, @routines.Active)
  let r = @routines.Routine::{
    id: "r1",
    title: "morning brief",
    schedule: @routines.Schedule::{
      trigger: @routines.Cron(expr="0 9 * * *"),
      timezone: "Asia/Shanghai",
      enabled: true,
    },
    lifecycle: life,
    skill_ref: None,
  }
  assert_eq(r.is_runnable(), true)
}
