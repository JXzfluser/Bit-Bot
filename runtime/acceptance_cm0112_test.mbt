///|
/// CM-0112: multi-step TodoWrite; ≥3 steps visible; completed items marked done.
test "acceptance_CM-0112_todowrite_multistep_checklist" {
  let t0 = @runtime.open_turn(turn_id="acc-0112", text="ship N-batch")
  let items = [
    @runtime.TodoItem::{
      id: "1",
      content: "Implement voice memo",
      status: "pending",
    },
    @runtime.TodoItem::{
      id: "2",
      content: "Add reaction wake",
      status: "pending",
    },
    @runtime.TodoItem::{
      id: "3",
      content: "Wire TodoWrite checklist",
      status: "in_progress",
    },
    @runtime.TodoItem::{
      id: "4",
      content: "Update scaffold-status",
      status: "pending",
    },
  ]
  let t1 = match t0.todo_write(items) {
    Ok(t) => t
    Err(e) => fail(e)
  }
  let visible = t1.visible_todos()
  assert_true(visible.length() >= 3)
  assert_eq(visible.length(), 4)
  assert_eq(visible[0].content, "Implement voice memo")
  assert_eq(t1.done_todo_count(), 0)

  let t2 = match t1.mark_todo_done(id="1") {
    Ok(t) => t
    Err(e) => fail(e)
  }
  let t3 = match t2.mark_todo_done(id="2") {
    Ok(t) => t
    Err(e) => fail(e)
  }
  assert_eq(t3.done_todo_count(), 2)
  let after = t3.visible_todos()
  assert_true(after[0].is_done())
  assert_true(after[1].is_done())
  assert_false(after[2].is_done())
  assert_eq(after[0].status, "done")
  assert_eq(after.length(), 4)
}
