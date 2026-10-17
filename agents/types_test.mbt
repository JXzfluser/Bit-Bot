///|
test "teammate task routing" {
  let mate = @agents.Teammate::{
    id: "t1",
    role: "executor",
    subagent: @agents.Executor,
    active: true,
  }
  let req = @agents.TaskRequest::{
    id: "task-1",
    prompt: "scaffold modules",
    subagent: @agents.Executor,
    parent_turn_id: Some("turn-1"),
    deadline_ms: None,
  }
  assert_eq(mate.can_accept(req), true)
  assert_eq(@agents.Browser.label(), "browser")
}
