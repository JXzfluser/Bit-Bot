///|
/// AR-04 / CM-0112: agent session context — message history, token budget,
/// compaction and the model-visible plan.
///
/// Three things the next reader must not get wrong:
/// - The kernel has no real tokenizer. `estimate_tokens` counts ASCII chars / 4
///   plus one per CJK char. It is an ESTIMATE, never a real token count.
/// - The kernel has no wall clock (`core/time.mbt` says the same), so a trace
///   timestamp is a logical stamp (`<turn>#<step>`) and a duration stays -1
///   unless the Host reported one.
/// - The Host owns persistence. `AgentContext::encode` / `AgentContext::decode`
///   round-trip a session across process restarts; `AgentLoop::run_with`
///   resumes a session that is already in memory.

///|
pub const AGENT_CONTEXT_DEFAULT_TOKEN_BUDGET : Int32 = 24000

///|
pub const AGENT_CONTEXT_DEFAULT_KEEP_TURNS : Int32 = 4

///|
/// Tool results that must survive compaction (Read output, Shell exit code).
pub fn agent_context_key_tools() -> Array[String] {
  ["Read", "read", "fs_read", "Shell", "shell", "TodoWrite", "todo_write"]
}

///|
/// Role of one history entry. `Observation` is an error or a policy refusal the
/// model has to see; it travels to the Host as a `tool` message so the Host
/// contract (user / assistant / tool) stays unchanged.
pub(all) enum AgentRole {
  User
  Assistant
  Tool
  Observation
} derive(Eq, Debug)

///|
pub extend AgentRole with Eq::{equal, not_equal}

///|
pub extend AgentRole with Debug::{to_repr}

///|
/// Wire role for `llm_chat`.
pub fn AgentRole::wire(self : AgentRole) -> String {
  match self {
    AgentRole::User => "user"
    AgentRole::Assistant => "assistant"
    AgentRole::Tool => "tool"
    AgentRole::Observation => "tool"
  }
}

///|
/// Short code used by `AgentContext::encode`.
pub fn AgentRole::code(self : AgentRole) -> String {
  match self {
    AgentRole::User => "u"
    AgentRole::Assistant => "a"
    AgentRole::Tool => "t"
    AgentRole::Observation => "o"
  }
}

///|
/// Parse a role code back into a role.
pub fn AgentRole::from_code(code : String) -> AgentRole {
  match code {
    "u" => AgentRole::User
    "a" => AgentRole::Assistant
    "t" => AgentRole::Tool
    _ => AgentRole::Observation
  }
}

///|
/// One persisted history entry. `key` marks a result that must not be lost
/// when the history is compacted (Read output, Shell exit code).
///
/// `call_id` / `call_args` keep the tool-call identity across turns. An
/// assistant entry that emitted a tool call carries the id it invented; the
/// tool (or observation) entry that answers it carries the same id back. The
/// provider needs both halves to accept the replayed conversation — see
/// `LoopMessage`.
pub(all) struct AgentHistoryEntry {
  role : AgentRole
  content : String
  tool_name : String
  step : Int32
  key : Bool
  call_id : String
  call_args : String
} derive(Eq, Debug)

///|
pub extend AgentHistoryEntry with Eq::{equal, not_equal}

///|
pub extend AgentHistoryEntry with Debug::{to_repr}

///|
/// One tool call trace. Same idea as runtime/transcript.mbt `ToolCallTrace`,
/// plus the three fields that shape never had: duration, error and timestamp.
/// `duration_ms` is -1 when the Host did not report one; `exit_code` is -1
/// when the tool output carried none; `timestamp` is a logical stamp because
/// the kernel has no wall clock.
pub(all) struct AgentToolTrace {
  tool_name : String
  args_json : String
  result_snippet : String
  duration_ms : Int32
  exit_code : Int32
  error : Bool
  timestamp : String
} derive(Eq, Debug)

///|
pub extend AgentToolTrace with Eq::{equal, not_equal}

///|
pub extend AgentToolTrace with Debug::{to_repr}

///|
/// Session state the agent loop carries across turns: message history,
/// compacted summary, the plan the model wrote, tool traces and the token
/// budget that stops the loop.
pub(all) struct AgentContext {
  mut session_id : String
  mut history : Array[AgentHistoryEntry]
  mut summary : String
  mut todos : Array[TodoItem]
  mut traces : Array[AgentToolTrace]
  mut budget_tokens : Int32
  mut keep_recent_turns : Int32
  mut compacted : Bool
} derive(Eq, Debug)

///|
pub extend AgentContext with Eq::{equal, not_equal}

///|
pub extend AgentContext with Debug::{to_repr}

///|
/// New empty context with the default budget and retention window.
pub fn AgentContext::new(session_id~ : String) -> AgentContext {
  {
    session_id,
    history: [],
    summary: "",
    todos: [],
    traces: [],
    budget_tokens: AGENT_CONTEXT_DEFAULT_TOKEN_BUDGET,
    keep_recent_turns: AGENT_CONTEXT_DEFAULT_KEEP_TURNS,
    compacted: false,
  }
}

///|
/// New empty context with an explicit token budget and retention window.
pub fn AgentContext::with_budget(
  session_id~ : String,
  budget_tokens~ : Int32,
  keep_recent_turns~ : Int32 = AGENT_CONTEXT_DEFAULT_KEEP_TURNS,
) -> AgentContext {
  let ctx = AgentContext::new(session_id~)
  ctx.budget_tokens = if budget_tokens < 1 { 1 } else { budget_tokens }
  ctx.keep_recent_turns = if keep_recent_turns < 1 {
    1
  } else {
    keep_recent_turns
  }
  ctx
}

///|
/// Session this context belongs to.
pub fn AgentContext::session(self : AgentContext) -> String {
  self.session_id
}

///|
/// Append one history entry.
pub fn AgentContext::append(
  self : AgentContext,
  role : AgentRole,
  content : String,
  tool_name~ : String = "",
  step~ : Int32 = 0,
  key~ : Bool = false,
  call_id~ : String = "",
  call_args~ : String = "",
) -> Unit {
  self.history.push({ role, content, tool_name, step, key, call_id, call_args, })
}

///|
/// Append the user turn.
pub fn AgentContext::append_user(self : AgentContext, text : String) -> Unit {
  self.append(AgentRole::User, text)
}

///|
/// Append what the model said (plain text or a tool call).
pub fn AgentContext::append_assistant(
  self : AgentContext,
  text : String,
  step~ : Int32 = 0,
) -> Unit {
  self.append(AgentRole::Assistant, text, step~)
}

///|
/// Append a model turn that asked for a tool. The readable text stays the same
/// (`<name> <args>`) so summaries and traces keep working; the call identity
/// travels beside it and is what `wire_messages` turns into `tool_calls`.
pub fn AgentContext::append_tool_call(
  self : AgentContext,
  name : String,
  args_json : String,
  call_id : String,
  step~ : Int32 = 0,
) -> Unit {
  self.append(
    AgentRole::Assistant,
    name + " " + args_json,
    tool_name=name,
    step~,
    call_id~,
    call_args=args_json,
  )
}

///|
/// Append a tool result. Key tools (Read / Shell) are pinned so compaction
/// never drops them.
pub fn AgentContext::append_tool(
  self : AgentContext,
  tool_name : String,
  content : String,
  step~ : Int32 = 0,
  call_id~ : String = "",
) -> Unit {
  self.append(
    AgentRole::Tool,
    content,
    tool_name~,
    step~,
    key=is_key_tool(tool_name),
    call_id~,
  )
}

///|
/// Append an error / refusal the model must see.
pub fn AgentContext::append_observation(
  self : AgentContext,
  tool_name : String,
  content : String,
  step~ : Int32 = 0,
  call_id~ : String = "",
) -> Unit {
  self.append(AgentRole::Observation, content, tool_name~, step~, call_id~)
}

///|
/// Record one tool trace (duration / error / timestamp).
pub fn AgentContext::record_trace(
  self : AgentContext,
  trace : AgentToolTrace,
) -> Unit {
  self.traces.push(trace)
}

///|
/// Replace the plan (the todo list the model wrote with TodoWrite).
pub fn AgentContext::set_todos(
  self : AgentContext,
  items : Array[TodoItem],
) -> Unit {
  self.todos = items
}

///|
/// How many plan items are already done.
pub fn AgentContext::done_todo_count(self : AgentContext) -> Int32 {
  let mut n : Int32 = 0
  for t in self.todos {
    if t.is_done() {
      n = n + 1
    }
  }
  n
}

///|
/// Number of user turns in the persisted history.
pub fn AgentContext::turn_count(self : AgentContext) -> Int32 {
  let mut n : Int32 = 0
  for e in self.history {
    if e.role is AgentRole::User {
      n = n + 1
    }
  }
  n
}

///|
/// Conservative token ESTIMATE — not a real tokenizer. ASCII text runs about
/// four characters per token, CJK text about one token per character.
pub fn estimate_tokens(text : String) -> Int32 {
  let mut ascii : Int32 = 0
  let mut cjk : Int32 = 0
  for ch in text {
    let code = ch.to_int()
    if code >= 0x4E00 && code <= 0x9FFF {
      cjk = cjk + 1
    } else {
      ascii = ascii + 1
    }
  }
  (ascii + 3) / 4 + cjk
}

///|
/// Estimated size of the whole context, including the plan block.
pub fn AgentContext::estimated_tokens(self : AgentContext) -> Int32 {
  let mut total = estimate_tokens(self.summary) +
    estimate_tokens(self.plan_block())
  for e in self.history {
    total = total + estimate_tokens(e.content) + 4
  }
  total
}

///|
/// True when the context no longer fits the token budget.
pub fn AgentContext::over_budget(self : AgentContext) -> Bool {
  self.estimated_tokens() > self.budget_tokens
}

///|
/// Model-visible plan block: the checklist the model wrote itself.
pub fn AgentContext::plan_block(self : AgentContext) -> String {
  if self.todos.length() == 0 {
    return ""
  }
  let buf = StringBuilder()
  buf.write_string("[plan]")
  for t in self.todos {
    let mark = if t.is_done() { "x" } else { " " }
    buf.write_string("\n")
    buf.write_string(t.id)
    buf.write_string(". [")
    buf.write_string(mark)
    buf.write_string("] ")
    buf.write_string(t.content)
  }
  buf.to_string()
}

///|
/// Context block the Host sees first: the compacted summary plus the plan.
pub fn AgentContext::lead_block(self : AgentContext) -> String {
  let plan = self.plan_block()
  if self.summary == "" {
    return plan
  }
  if plan == "" {
    return self.summary
  }
  self.summary + "\n" + plan
}

///|
/// Does `entry` answer the tool call `call_id`?
fn answers_call(entry : AgentHistoryEntry, call_id : String) -> Bool {
  if call_id == "" {
    return false
  }
  match entry.role {
    AgentRole::Tool => entry.call_id == call_id
    AgentRole::Observation => entry.call_id == call_id
    _ => false
  }
}

///|
/// Messages handed to `llm_chat`: the context block first, then the history.
///
/// Every assistant tool call travels with the `tool_call_id` of the entry that
/// answers it, because an OpenAI-compatible provider rejects an unpaired
/// `role:"tool"` message with 422 — and a rejected request used to be persisted
/// as history, which then poisoned every later turn on the same slot. Two
/// corrections keep older sessions replayable:
/// - a tool call whose result never arrived (cancelled turn) is emitted as
///   plain assistant text, so no call is left dangling;
/// - a tool / observation entry persisted before this shape existed carries no
///   call id, and is replayed as a user note instead of a `tool` message that
///   nothing answers.
pub fn AgentContext::wire_messages(self : AgentContext) -> Array[LoopMessage] {
  let out : Array[LoopMessage] = []
  let lead = self.lead_block()
  if lead != "" {
    out.push(LoopMessage::new(role="system", content=lead))
  }
  let history = self.history
  let total = history.length()
  // The id of the call emitted by the assistant entry right before this one.
  let mut pending = ""
  let mut i = 0
  while i < total {
    let e = history[i]
    match e.role {
      AgentRole::Assistant =>
        if e.call_id != "" &&
          i + 1 < total &&
          answers_call(history[i + 1], e.call_id) {
          pending = e.call_id
          out.push(
            LoopMessage::new(role="assistant", content=e.content, tool_calls=[
              { id: e.call_id, name: e.tool_name, arguments_json: e.call_args, },
            ]),
          )
        } else {
          pending = ""
          out.push(LoopMessage::new(role="assistant", content=e.content))
        }
      AgentRole::Tool =>
        if pending != "" && e.call_id == pending {
          pending = ""
          out.push(
            LoopMessage::new(
              role="tool",
              content=e.content,
              tool_call_id=e.call_id,
            ),
          )
        } else {
          out.push(
            LoopMessage::new(
              role="user",
              content="[tool result " + e.tool_name + "] " + e.content,
            ),
          )
        }
      AgentRole::Observation =>
        if pending != "" && e.call_id == pending {
          pending = ""
          out.push(
            LoopMessage::new(
              role="tool",
              content=e.content,
              tool_call_id=e.call_id,
            ),
          )
        } else {
          out.push(
            LoopMessage::new(
              role="user",
              content="[tool error " + e.tool_name + "] " + e.content,
            ),
          )
        }
      AgentRole::User => {
        pending = ""
        out.push(LoopMessage::new(role="user", content=e.content))
      }
    }
    i = i + 1
  }
  out
}

///|
/// AR-04: compact the history — keep the last `keep_recent_turns` user turns
/// verbatim, fold older turns into the summary, never drop a pinned key
/// result. Returns true when something was folded.
pub fn[S : AgentSummarizer] AgentContext::compact(
  self : AgentContext,
  summarizer : S,
) -> Bool {
  if self.turn_count() <= self.keep_recent_turns {
    return false
  }
  let mut keep_from = self.history.length()
  let mut seen : Int32 = 0
  let mut i = self.history.length() - 1
  while i >= 0 {
    if self.history[i].role is AgentRole::User {
      seen = seen + 1
      if seen == self.keep_recent_turns {
        keep_from = i
        break
      }
    }
    i = i - 1
  }
  let older : Array[AgentHistoryEntry] = []
  let kept : Array[AgentHistoryEntry] = []
  let mut j = 0
  while j < self.history.length() {
    let e = self.history[j]
    if j < keep_from && !e.key {
      older.push(e)
    } else {
      kept.push(e)
    }
    j = j + 1
  }
  if older.length() == 0 {
    return false
  }
  let folded = AgentSummarizer::summarize(summarizer, older)
  if self.summary == "" {
    self.summary = folded
  } else if folded != "" {
    self.summary = self.summary + "\n" + folded
  }
  self.history = kept
  self.compacted = true
  true
}

///|
/// AR-04: summary hook. The default is a heuristic placeholder ("key points of
/// the older turns"); the Host can later plug a real summarization model in
/// through `AgentLoop::run_with_summarizer` without the loop changing.
pub(open) trait AgentSummarizer {
  fn summarize(Self, Array[AgentHistoryEntry]) -> String
}

///|
/// Placeholder summarizer: one clipped line per folded entry.
pub(all) struct HeuristicSummarizer {
  max_chars : Int32
  per_entry_chars : Int32
}

///|
pub fn HeuristicSummarizer::new() -> HeuristicSummarizer {
  { max_chars: 1200, per_entry_chars: 160, }
}

///|
pub extend HeuristicSummarizer with AgentSummarizer::{summarize}

///|
pub impl AgentSummarizer for HeuristicSummarizer with fn summarize(
  self,
  entries,
) {
  let mut out = ""
  for e in entries {
    let head = match e.role {
      AgentRole::User => "user"
      AgentRole::Assistant => "assistant"
      AgentRole::Tool => "tool"
      AgentRole::Observation => "error"
    }
    let line = "- [" + head + "] " + clip_text(e.content, self.per_entry_chars)
    if out == "" {
      out = line
    } else {
      out = out + "\n" + line
    }
  }
  clip_text(out, self.max_chars)
}

///|
/// Clip to a character count without splitting a multi-byte character.
pub fn clip_text(text : String, max_chars : Int32) -> String {
  if max_chars <= 0 {
    return ""
  }
  let buf = StringBuilder()
  let mut n : Int32 = 0
  let mut truncated = false
  for ch in text {
    if n >= max_chars {
      truncated = true
      break
    }
    buf.write_char(ch)
    n = n + 1
  }
  if truncated {
    buf.write_string("…")
  }
  buf.to_string()
}

///|
/// True when the tool result must survive compaction.
pub fn is_key_tool(name : String) -> Bool {
  for k in agent_context_key_tools() {
    if k == name {
      return true
    }
  }
  false
}

///|
/// Pull an exit code out of a tool result ("exit code: 1", "exit_code=1").
/// Returns -1 when the result carries none.
pub fn extract_exit_code(text : String) -> Int32 {
  let markers = ["exit code:", "exit_code=", "exit code =", "exit code "]
  for marker in markers {
    match text.find(marker) {
      None => ()
      Some(at) => {
        let rest = text[at + marker.length():].to_owned()
        let line = first_line(rest).trim().to_owned()
        let mut digits = ""
        for ch in line {
          if ch < '0' || ch > '9' {
            break
          }
          digits = digits + ch.to_string()
        }
        if digits != "" {
          return parse_int_or(digits, -1)
        }
      }
    }
  }
  -1
}

///|
/// Parse a non-negative integer, falling back when the text is not a number.
pub fn parse_int_or(text : String, fallback : Int32) -> Int32 {
  if text.length() == 0 {
    return fallback
  }
  let mut n : Int32 = 0
  for ch in text {
    if ch < '0' || ch > '9' {
      return fallback
    }
    n = n * 10 + (ch.to_int() - '0'.to_int())
  }
  n
}

///|
/// Escape a field for the tab separated wire format.
pub fn escape_field(text : String) -> String {
  text
  .replace_all(old="\\", new="\\\\")
  .replace_all(old="\n", new="\\n")
  .replace_all(old="\r", new="\\r")
  .replace_all(old="\t", new="\\t")
}

///|
/// Undo `escape_field`.
pub fn unescape_field(text : String) -> String {
  let chars = text.to_array()
  let buf = StringBuilder()
  let mut i = 0
  while i < chars.length() {
    let c = chars[i]
    if c == '\\' && i + 1 < chars.length() {
      let n = chars[i + 1]
      if n == 'n' {
        buf.write_char('\n')
        i = i + 2
        continue
      }
      if n == 'r' {
        buf.write_char('\r')
        i = i + 2
        continue
      }
      if n == 't' {
        buf.write_char('\t')
        i = i + 2
        continue
      }
      if n == '\\' {
        buf.write_char('\\')
        i = i + 2
        continue
      }
    }
    buf.write_char(c)
    i = i + 1
  }
  buf.to_string()
}

///|
/// Serialize the context so the Host can persist a session across process
/// restarts. One record per line, tab separated, fields escaped.
pub fn AgentContext::encode(self : AgentContext) -> String {
  let buf = StringBuilder()
  buf.write_string("v1\t")
  buf.write_string(escape_field(self.session_id))
  buf.write_string("\t")
  buf.write_string(self.budget_tokens.to_string())
  buf.write_string("\t")
  buf.write_string(self.keep_recent_turns.to_string())
  buf.write_string("\t")
  buf.write_string(if self.compacted { "1" } else { "0" })
  buf.write_string("\n")
  buf.write_string("s\t")
  buf.write_string(escape_field(self.summary))
  buf.write_string("\n")
  for e in self.history {
    buf.write_string("e\t")
    buf.write_string(e.role.code())
    buf.write_string("\t")
    buf.write_string(e.step.to_string())
    buf.write_string("\t")
    buf.write_string(if e.key { "1" } else { "0" })
    buf.write_string("\t")
    buf.write_string(escape_field(e.tool_name))
    buf.write_string("\t")
    buf.write_string(escape_field(e.content))
    buf.write_string("\t")
    buf.write_string(escape_field(e.call_id))
    buf.write_string("\t")
    buf.write_string(escape_field(e.call_args))
    buf.write_string("\n")
  }
  for t in self.todos {
    buf.write_string("d\t")
    buf.write_string(escape_field(t.id))
    buf.write_string("\t")
    buf.write_string(escape_field(t.content))
    buf.write_string("\t")
    buf.write_string(escape_field(t.status))
    buf.write_string("\n")
  }
  for tr in self.traces {
    buf.write_string("t\t")
    buf.write_string(escape_field(tr.tool_name))
    buf.write_string("\t")
    buf.write_string(escape_field(tr.args_json))
    buf.write_string("\t")
    buf.write_string(escape_field(tr.result_snippet))
    buf.write_string("\t")
    buf.write_string(tr.duration_ms.to_string())
    buf.write_string("\t")
    buf.write_string(tr.exit_code.to_string())
    buf.write_string("\t")
    buf.write_string(if tr.error { "1" } else { "0" })
    buf.write_string("\t")
    buf.write_string(escape_field(tr.timestamp))
    buf.write_string("\n")
  }
  buf.to_string()
}

///|
/// Rebuild a context from `AgentContext::encode`.
pub fn AgentContext::decode(text : String) -> AgentContext {
  let ctx = AgentContext::new(session_id="")
  for line in text.split("\n") {
    let line = line.to_owned()
    if line == "" {
      continue
    }
    let parts : Array[String] = []
    for p in line.split("\t") {
      parts.push(p.to_owned())
    }
    if parts.length() == 0 {
      continue
    }
    let tag = parts[0]
    if tag == "v1" && parts.length() >= 5 {
      ctx.session_id = unescape_field(parts[1])
      ctx.budget_tokens = parse_int_or(
        parts[2],
        AGENT_CONTEXT_DEFAULT_TOKEN_BUDGET,
      )
      ctx.keep_recent_turns = parse_int_or(
        parts[3],
        AGENT_CONTEXT_DEFAULT_KEEP_TURNS,
      )
      ctx.compacted = parts[4] == "1"
    } else if tag == "s" && parts.length() >= 2 {
      ctx.summary = unescape_field(parts[1])
    } else if tag == "e" && parts.length() >= 6 {
      // A record written before `call_id` existed stops at the content field;
      // the missing tail decodes to empty, which `wire_messages` heals.
      ctx.history.push({
        role: AgentRole::from_code(parts[1]),
        content: unescape_field(parts[5]),
        tool_name: unescape_field(parts[4]),
        step: parse_int_or(parts[2], 0),
        key: parts[3] == "1",
        call_id: if parts.length() >= 7 {
          unescape_field(parts[6])
        } else {
          ""
        },
        call_args: if parts.length() >= 8 {
          unescape_field(parts[7])
        } else {
          ""
        },
      })
    } else if tag == "d" && parts.length() >= 4 {
      ctx.todos.push({
        id: unescape_field(parts[1]),
        content: unescape_field(parts[2]),
        status: unescape_field(parts[3]),
      })
    } else if tag == "t" && parts.length() >= 8 {
      ctx.traces.push({
        tool_name: unescape_field(parts[1]),
        args_json: unescape_field(parts[2]),
        result_snippet: unescape_field(parts[3]),
        duration_ms: parse_int_or(parts[4], -1),
        exit_code: parse_int_or(parts[5], -1),
        error: parts[6] == "1",
        timestamp: unescape_field(parts[7]),
      })
    }
  }
  ctx
}

///|
/// What a TodoWrite call asks the kernel to do with the plan.
pub(all) enum TodoAction {
  Replace(Array[TodoItem])
  MarkDone(String)
  SetStatus(String, String)
} derive(Eq, Debug)

///|
pub extend TodoAction with Eq::{equal, not_equal}

///|
pub extend TodoAction with Debug::{to_repr}

///|
/// Parse a TodoWrite argument blob. Accepts `{"todos":[...]}`,
/// `{"items":[...]}` or a bare `[...]` array of `{id, content|title, status}`
/// objects; a single `{id, status}` object means "mark that item done".
pub fn parse_todo_action(args_json : String) -> Result[TodoAction, String] {
  let array = find_json_array(args_json)
  match array {
    None => {
      let id = json_field_string(args_json, "id")
      match id {
        None => Err("TodoWrite needs a todos array")
        Some(item_id) => {
          let status = json_field_string(args_json, "status")
          match status {
            None => Err("TodoWrite needs a todos array")
            Some(st) =>
              if st == "done" || st == "completed" {
                Ok(TodoAction::MarkDone(item_id))
              } else {
                Ok(TodoAction::SetStatus(item_id, st))
              }
          }
        }
      }
    }
    Some(body) => {
      let items = parse_todo_items(body)
      if items.length() == 0 {
        Err("TodoWrite needs at least one item")
      } else {
        Ok(TodoAction::Replace(items))
      }
    }
  }
}

///|
/// Parse the objects of a TodoWrite array body into plan items.
pub fn parse_todo_items(body : String) -> Array[TodoItem] {
  let out : Array[TodoItem] = []
  for chunk in split_json_objects(body) {
    let id = match json_field_string(chunk, "id") {
      Some(v) => v
      None => ""
    }
    let content = match json_field_string(chunk, "content") {
      Some(v) => v
      None =>
        match json_field_string(chunk, "title") {
          Some(v) => v
          None =>
            match json_field_string(chunk, "text") {
              Some(v) => v
              None => ""
            }
        }
    }
    let status = match json_field_string(chunk, "status") {
      Some(v) => v
      None => "pending"
    }
    if id == "" && content == "" {
      continue
    }
    out.push({
      id: if id == "" {
        (out.length() + 1).to_string()
      } else {
        id
      },
      content: if content == "" {
        id
      } else {
        content
      },
      status: normalize_todo_status(status),
    })
  }
  out
}

///|
/// Normalize a plan status to the vocabulary `TodoItem::is_done` understands.
pub fn normalize_todo_status(status : String) -> String {
  let s = status.to_lower()
  if s == "done" || s == "completed" || s == "complete" {
    "done"
  } else if s == "in_progress" || s == "in progress" || s == "doing" {
    "in_progress"
  } else {
    "pending"
  }
}

///|
/// Find the first JSON array body in a blob (returns the text between the
/// outer brackets).
pub fn find_json_array(text : String) -> String? {
  let start = text.find("[")
  match start {
    None => None
    Some(open) => {
      let mut depth : Int32 = 0
      let mut in_string = false
      let mut escaped = false
      let mut i = open
      while i < text.length() {
        let c = text[i:i + 1].to_owned()
        if in_string {
          if escaped {
            escaped = false
          } else if c == "\\" {
            escaped = true
          } else if c == "\"" {
            in_string = false
          }
        } else if c == "\"" {
          in_string = true
        } else if c == "[" {
          depth = depth + 1
        } else if c == "]" {
          depth = depth - 1
          if depth == 0 {
            return Some(text[open + 1:i].to_owned())
          }
        }
        i = i + 1
      }
      None
    }
  }
}

///|
/// Split a JSON array body into its top level objects.
pub fn split_json_objects(body : String) -> Array[String] {
  let out : Array[String] = []
  let mut depth : Int32 = 0
  let mut in_string = false
  let mut escaped = false
  let mut start = -1
  let mut i = 0
  while i < body.length() {
    let c = body[i:i + 1].to_owned()
    if in_string {
      if escaped {
        escaped = false
      } else if c == "\\" {
        escaped = true
      } else if c == "\"" {
        in_string = false
      }
    } else if c == "\"" {
      in_string = true
    } else if c == "{" {
      if depth == 0 {
        start = i
      }
      depth = depth + 1
    } else if c == "}" {
      depth = depth - 1
      if depth == 0 && start >= 0 {
        out.push(body[start:i + 1].to_owned())
        start = -1
      }
    }
    i = i + 1
  }
  out
}

///|
/// Read a string field out of a JSON object. Tolerates whitespace around the
/// colon (model output is not always compact).
pub fn json_field_string(text : String, key : String) -> String? {
  let marker = "\"" + key + "\""
  let at = match text.find(marker) {
    None => return None
    Some(a) => a
  }
  let mut i = at + marker.length()
  while i < text.length() &&
        (
          text[i:i + 1].to_owned() == " " ||
          text[i:i + 1].to_owned() == "\n" ||
          text[i:i + 1].to_owned() == "\r" ||
          text[i:i + 1].to_owned() == "\t"
        ) {
    i = i + 1
  }
  if i >= text.length() || text[i:i + 1].to_owned() != ":" {
    return None
  }
  i = i + 1
  while i < text.length() &&
        (
          text[i:i + 1].to_owned() == " " ||
          text[i:i + 1].to_owned() == "\n" ||
          text[i:i + 1].to_owned() == "\r" ||
          text[i:i + 1].to_owned() == "\t"
        ) {
    i = i + 1
  }
  if i >= text.length() || text[i:i + 1].to_owned() != "\"" {
    return None
  }
  let start = i + 1
  let mut end = start
  while end < text.length() {
    let c = text[end:end + 1].to_owned()
    if c == "\\" {
      end = end + 2
      continue
    }
    if c == "\"" {
      break
    }
    end = end + 1
  }
  if end >= text.length() {
    return None
  }
  Some(unescape_field(text[start:end].to_owned()))
}
