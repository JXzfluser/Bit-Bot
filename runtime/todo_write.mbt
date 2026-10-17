///|
/// CM-0112: multi-step TodoWrite — ≥3 steps visible; completed items marked done.

///|
pub fn TodoItem::is_done(self : TodoItem) -> Bool {
  self.status == "done" || self.status == "completed"
}

///|
pub fn TodoItem::is_pending(self : TodoItem) -> Bool {
  self.status == "pending" ||
  self.status == "todo" ||
  self.status == "in_progress"
}

///|
/// Replace the turn's structured todo list (TodoWrite).
pub fn TurnContext::todo_write(
  self : TurnContext,
  items : Array[TodoItem],
) -> Result[TurnContext, String] {
  guard !(self.phase is Ended) else { Err("turn ended; cannot TodoWrite") }
  guard items.length() >= 1 else { Err("TodoWrite requires at least one item") }
  Ok({ ..self, phase: Working, todos: items, })
}

///|
/// Visible todo checklist for the Host / user (≥3 for multi-step acceptance).
pub fn TurnContext::visible_todos(self : TurnContext) -> Array[TodoItem] {
  self.todos
}

///|
/// Mark one todo item done by id.
pub fn TurnContext::mark_todo_done(
  self : TurnContext,
  id~ : String,
) -> Result[TurnContext, String] {
  guard !(self.phase is Ended) else { Err("turn ended") }
  let next : Array[TodoItem] = []
  let mut found = false
  for t in self.todos {
    if t.id == id {
      found = true
      next.push({ id: t.id, content: t.content, status: "done", })
    } else {
      next.push(t)
    }
  }
  guard found else { Err("todo id not found: " + id) }
  Ok({ ..self, todos: next, })
}

///|
pub fn TurnContext::done_todo_count(self : TurnContext) -> Int32 {
  let mut n = 0
  for t in self.todos {
    if t.is_done() {
      n = n + 1
    }
  }
  n
}
