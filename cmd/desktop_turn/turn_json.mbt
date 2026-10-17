///|
/// Versioned Desktop / Host FFI JSON contract.
pub const DESKTOP_TURN_JSON_V : Int = 1

///|
/// One outbound chat line for Desktop host JSON.
pub(all) struct DesktopMessage {
  role : String
  text : String
} derive(Eq, Debug)

///|
/// Machine row for ListMachines JSON (CM-0701 kinds).
pub(all) struct DesktopMachineRow {
  id : String
  label : String
  kind : String
  status : String
} derive(Eq, Debug)

///|
/// Memory entry snapshot for host transcript.
pub(all) struct DesktopMemoryRow {
  key : String
  value : String
  scope : String
} derive(Eq, Debug)

///|
/// Host effect / tool plan; Desktop executes via Host FFI.
pub(all) struct DesktopEffect {
  kind : String
  command : String
  needs_host_ffi : Bool
} derive(Eq, Debug)

///|
/// Classified user intent for one MoonBit turn.
pub(all) enum TurnIntent {
  Chat
  ListMachines
  MemoryRecall(prefix~ : String)
  MemoryUpdate(key~ : String, value~ : String)
  HostEffect(command~ : String)
} derive(Eq, Debug)

///|
pub fn TurnIntent::name(self : TurnIntent) -> String {
  match self {
    Chat => "chat"
    ListMachines => "list_machines"
    MemoryRecall(_) => "memory_recall"
    MemoryUpdate(_) => "memory_update"
    HostEffect(_) => "host_effect"
  }
}

///|
/// Result of one MoonBit desktop turn (product brain path).
pub(all) struct DesktopTurnResult {
  v : Int
  ok : Bool
  turn_id : String
  intent : String
  messages : Array[DesktopMessage]
  modules : Array[String]
  machines : Array[DesktopMachineRow]
  memory : Array[DesktopMemoryRow]
  effects : Array[DesktopEffect]
  needs_host_ffi : Bool
  error : String?
} derive(Eq, Debug)

///|
fn escape_json_string(s : String) -> String {
  let buf = StringBuilder()
  for c in s {
    match c {
      '"' => buf.write_string("\\\"")
      '\\' => buf.write_string("\\\\")
      '\n' => buf.write_string("\\n")
      '\r' => buf.write_string("\\r")
      '\t' => buf.write_string("\\t")
      _ => buf.write_char(c)
    }
  }
  buf.to_string()
}

///|
fn part_text(part : @ui_protocol.MessageKind) -> String? {
  match part {
    Text(body~) => Some(body)
    _ => None
  }
}

///|
/// Parse argv/user text into a TurnIntent (discriminated intent over chat default).
pub fn classify_intent(user_text : String) -> TurnIntent {
  let trimmed = user_text.trim().to_owned()
  let low = trimmed.to_lower()
  if low == "listmachines" ||
      low == "list machines" ||
      low.has_prefix("listmachines") ||
      (low.contains("list") && low.contains("machine")) ||
      low == "machines" ||
      low == "show machines" {
    return ListMachines
  }
  // remember key=value  |  remember key as value  |  update memory key=value
  if low.has_prefix("remember ") ||
      low.has_prefix("update memory ") ||
      low.has_prefix("memory update ") {
    let rest = if low.has_prefix("remember ") {
      trimmed[9:].to_owned()
    } else if low.has_prefix("update memory ") {
      trimmed[14:].to_owned()
    } else {
      trimmed[14:].to_owned()
    }
    match parse_memory_kv(rest) {
      Some((k, v)) => return MemoryUpdate(key=k, value=v)
      None => ()
    }
  }
  if low.has_prefix("recall") ||
      low.has_prefix("remember what") ||
      low.contains("memory recall") ||
      low == "what do you remember" ||
      (low.contains("recall") && low.contains("memory")) {
    let prefix = extract_recall_prefix(trimmed)
    return MemoryRecall(prefix~)
  }
  // Host FFI shell plans (Grok-like: shell / Shell: / ! / run / 执行)
  if low.has_prefix("!") ||
      low.has_prefix("shell ") ||
      low.has_prefix("shell:") ||
      low.has_prefix("run ") ||
      low.has_prefix("$ ") ||
      low.has_prefix("exec ") ||
      low.has_prefix("执行 ") ||
      low.has_prefix("运行 ") {
    let cmd = if low.has_prefix("!") {
      trimmed[1:].trim().to_owned()
    } else if low.has_prefix("$ ") {
      trimmed[2:].trim().to_owned()
    } else if low.has_prefix("shell:") {
      trimmed[6:].trim().to_owned()
    } else if low.has_prefix("shell ") {
      trimmed[6:].trim().to_owned()
    } else if low.has_prefix("exec ") {
      trimmed[5:].trim().to_owned()
    } else if low.has_prefix("执行 ") {
      trimmed[3:].trim().to_owned()
    } else if low.has_prefix("运行 ") {
      trimmed[3:].trim().to_owned()
    } else {
      // "run …"
      trimmed[4:].trim().to_owned()
    }
    if cmd != "" {
      return HostEffect(command=cmd)
    }
  }
  Chat
}

///|
fn parse_memory_kv(rest : String) -> (String, String)? {
  let t = rest.trim().to_owned()
  match t.find("=") {
    Some(i) => {
      let k = t[:i].trim().to_owned()
      let v = t[i + 1:].trim().to_owned()
      if k != "" && v != "" {
        return Some((k, v))
      }
    }
    None => ()
  }
  let low = t.to_lower()
  match low.find(" as ") {
    Some(i) => {
      let k = t[:i].trim().to_owned()
      let v = t[i + 4:].trim().to_owned()
      if k != "" && v != "" {
        return Some((k, v))
      }
    }
    None => ()
  }
  None
}

///|
fn extract_recall_prefix(text : String) -> String {
  let low = text.to_lower()
  if low.has_prefix("recall ") {
    return text[7:].trim().to_owned()
  }
  if low.has_prefix("memory recall ") {
    return text[14:].trim().to_owned()
  }
  ""
}

///|
fn machine_rows(reg : @box_host.MachineRegistry) -> Array[DesktopMachineRow] {
  let out : Array[DesktopMachineRow] = []
  for m in reg.list() {
    out.push({
      id: m.id,
      label: m.label,
      kind: m.kind.name(),
      status: m.status.name(),
    })
  }
  out
}

///|
fn memory_rows(entries : Array[@memory.MemoryEntry]) -> Array[DesktopMemoryRow] {
  let out : Array[DesktopMemoryRow] = []
  for e in entries {
    out.push({
      key: e.key,
      value: e.value,
      scope: e.scope.label(),
    })
  }
  out
}

///|
fn deliver_ok(
  user_text : String,
  turn_id : String,
  reply : String,
  intent : TurnIntent,
  machines~ : Array[DesktopMachineRow] = [],
  memory~ : Array[DesktopMemoryRow] = [],
  effects~ : Array[DesktopEffect] = [],
  needs_host_ffi~ : Bool = false,
) -> DesktopTurnResult {
  let mods = @bitbot.registered_modules()
  let opened = @runtime.open_turn(turn_id~, text=user_text)
  let acked = opened.acknowledge(body="收到，正在用 MoonBit 内核处理。")
  match acked.deliver_text(body=reply) {
    Err(e) => {
      {
        v: DESKTOP_TURN_JSON_V,
        ok: false,
        turn_id,
        intent: intent.name(),
        messages: [
          { role: "user", text: user_text },
          { role: "assistant", text: "收到，正在用 MoonBit 内核处理。" },
        ],
        modules: mods,
        machines,
        memory,
        effects,
        needs_host_ffi,
        error: Some(e),
      }
    }
    Ok(working) => {
      let ended = working.end_turn()
      let msgs : Array[DesktopMessage] = [{ role: "user", text: user_text }]
      for env in ended.outbound {
        for part in env.parts {
          match part_text(part) {
            Some(t) => msgs.push({ role: "assistant", text: t })
            None => ()
          }
        }
      }
      {
        v: DESKTOP_TURN_JSON_V,
        ok: true,
        turn_id: ended.turn_id.value,
        intent: intent.name(),
        messages: msgs,
        modules: mods,
        machines,
        memory,
        effects,
        needs_host_ffi,
        error: None,
      }
    }
  }
}

///|
/// Run open_turn → policy (intent) → deliver; Host effects stay plans (no Python LocalBrain).
pub fn run_desktop_turn(user_text : String, turn_id~ : String = "desktop-1") -> DesktopTurnResult {
  let mods = @bitbot.registered_modules()
  let trimmed = user_text.trim().to_owned()
  guard trimmed != "" else {
    return {
      v: DESKTOP_TURN_JSON_V,
      ok: false,
      turn_id,
      intent: "chat",
      messages: [],
      modules: mods,
      machines: [],
      memory: [],
      effects: [],
      needs_host_ffi: false,
      error: Some("empty user text"),
    }
  }
  let intent = classify_intent(trimmed)
  match intent {
    ListMachines => {
      let reg = @box_host.MachineRegistry::seed()
      let rows = machine_rows(reg)
      let reply =
        "ListMachines: " +
        rows.length().to_string() +
        " registered (desktop + ios + android). Host kinds via @box_host."
      deliver_ok(trimmed, turn_id, reply, intent, machines=rows)
    }
    MemoryUpdate(key~, value~) => {
      let store = @memory.InMemoryStore::new()
      store.update(@memory.UpdateOp::{
        scope: @memory.Profile,
        key: key,
        value: value,
      })
      let entries = store.recall(@memory.RecallQuery::{
        scope: @memory.Profile,
        key_prefix: Some(key),
        limit: 8,
      })
      let rows = memory_rows(entries)
      let reply = "Memory updated (profile): " + key + " = " + value
      deliver_ok(trimmed, turn_id, reply, intent, memory=rows)
    }
    MemoryRecall(prefix~) => {
      let store = @memory.InMemoryStore::new()
      // Seed a demo profile row so recall shows @memory wiring in a fresh process.
      store.update(@memory.UpdateOp::{
        scope: @memory.Profile,
        key: "demo.user",
        value: "Bit Bot desktop host",
      })
      let pref = if prefix == "" { None } else { Some(prefix) }
      let entries = store.recall(@memory.RecallQuery::{
        scope: @memory.Profile,
        key_prefix: pref,
        limit: 16,
      })
      let rows = memory_rows(entries)
      let reply =
        "Memory recall (profile): " + rows.length().to_string() + " entr(y/ies)."
      deliver_ok(trimmed, turn_id, reply, intent, memory=rows)
    }
    HostEffect(command~) => {
      let effect : DesktopEffect = {
        kind: "shell",
        command: command,
        needs_host_ffi: true,
      }
      let reply =
        "Host effect planned (shell). Desktop must execute via Host FFI; needs_host_ffi=true. Sync stub only — not LocalBrain."
      deliver_ok(
        trimmed,
        turn_id,
        reply,
        intent,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    Chat => {
      let reply =
        "Bit Bot (MoonBit): 已收到「" +
        trimmed +
        "」。本回合由 cmd/desktop_turn 编排，不经 Python LocalBrain。"
      deliver_ok(trimmed, turn_id, reply, intent)
    }
  }
}

///|
fn write_string_array_json(buf : StringBuilder, items : Array[String]) -> Unit {
  buf.write_string("[")
  let mut i = 0
  while i < items.length() {
    if i > 0 {
      buf.write_string(",")
    }
    buf.write_string("\"")
    buf.write_string(escape_json_string(items[i]))
    buf.write_string("\"")
    i = i + 1
  }
  buf.write_string("]")
}

///|
fn write_messages_json(buf : StringBuilder, msgs : Array[DesktopMessage]) -> Unit {
  buf.write_string("[")
  let mut i = 0
  while i < msgs.length() {
    if i > 0 {
      buf.write_string(",")
    }
    let m = msgs[i]
    buf.write_string("{\"role\":\"")
    buf.write_string(escape_json_string(m.role))
    buf.write_string("\",\"text\":\"")
    buf.write_string(escape_json_string(m.text))
    buf.write_string("\"}")
    i = i + 1
  }
  buf.write_string("]")
}

///|
fn write_machines_json(buf : StringBuilder, rows : Array[DesktopMachineRow]) -> Unit {
  buf.write_string("[")
  let mut i = 0
  while i < rows.length() {
    if i > 0 {
      buf.write_string(",")
    }
    let m = rows[i]
    buf.write_string("{\"id\":\"")
    buf.write_string(escape_json_string(m.id))
    buf.write_string("\",\"label\":\"")
    buf.write_string(escape_json_string(m.label))
    buf.write_string("\",\"kind\":\"")
    buf.write_string(escape_json_string(m.kind))
    buf.write_string("\",\"status\":\"")
    buf.write_string(escape_json_string(m.status))
    buf.write_string("\"}")
    i = i + 1
  }
  buf.write_string("]")
}

///|
fn write_memory_json(buf : StringBuilder, rows : Array[DesktopMemoryRow]) -> Unit {
  buf.write_string("[")
  let mut i = 0
  while i < rows.length() {
    if i > 0 {
      buf.write_string(",")
    }
    let m = rows[i]
    buf.write_string("{\"key\":\"")
    buf.write_string(escape_json_string(m.key))
    buf.write_string("\",\"value\":\"")
    buf.write_string(escape_json_string(m.value))
    buf.write_string("\",\"scope\":\"")
    buf.write_string(escape_json_string(m.scope))
    buf.write_string("\"}")
    i = i + 1
  }
  buf.write_string("]")
}

///|
fn write_effects_json(buf : StringBuilder, rows : Array[DesktopEffect]) -> Unit {
  buf.write_string("[")
  let mut i = 0
  while i < rows.length() {
    if i > 0 {
      buf.write_string(",")
    }
    let e = rows[i]
    buf.write_string("{\"kind\":\"")
    buf.write_string(escape_json_string(e.kind))
    buf.write_string("\",\"command\":\"")
    buf.write_string(escape_json_string(e.command))
    buf.write_string("\",\"needs_host_ffi\":")
    buf.write_string(if e.needs_host_ffi { "true" } else { "false" })
    buf.write_string("}")
    i = i + 1
  }
  buf.write_string("]")
}

///|
/// Stable JSON line for Desktop / Host FFI consumers (`v:1`).
pub fn DesktopTurnResult::to_json_line(self : DesktopTurnResult) -> String {
  let buf = StringBuilder()
  buf.write_string("{\"v\":")
  buf.write_string(self.v.to_string())
  buf.write_string(",\"ok\":")
  buf.write_string(if self.ok { "true" } else { "false" })
  buf.write_string(",\"turn_id\":\"")
  buf.write_string(escape_json_string(self.turn_id))
  buf.write_string("\",\"intent\":\"")
  buf.write_string(escape_json_string(self.intent))
  buf.write_string("\",\"messages\":")
  write_messages_json(buf, self.messages)
  buf.write_string(",\"modules\":")
  write_string_array_json(buf, self.modules)
  buf.write_string(",\"machines\":")
  write_machines_json(buf, self.machines)
  buf.write_string(",\"memory\":")
  write_memory_json(buf, self.memory)
  buf.write_string(",\"effects\":")
  write_effects_json(buf, self.effects)
  buf.write_string(",\"needs_host_ffi\":")
  buf.write_string(if self.needs_host_ffi { "true" } else { "false" })
  match self.error {
    Some(e) => {
      buf.write_string(",\"error\":\"")
      buf.write_string(escape_json_string(e))
      buf.write_string("\"")
    }
    None => ()
  }
  buf.write_string("}")
  buf.to_string()
}

///|
/// Collect user text from argv (skip executable prefix).
pub fn user_text_from_args(args : Array[String]) -> String {
  if args.length() == 0 {
    return ""
  }
  // Native: [exe, ...user]. JS/moonrun may include node + script.
  let mut start = 1
  if args.length() >= 2 &&
      (args[0].contains("moon") ||
      args[0].contains("node") ||
      args[0].has_suffix(".exe") ||
      args[0].contains("desktop_turn")) {
    start = 1
  }
  let parts : Array[String] = []
  let mut i = start
  while i < args.length() {
    let a = args[i]
    if a == "--" {
      i = i + 1
      continue
    }
    parts.push(a)
    i = i + 1
  }
  if parts.length() == 0 && args.length() > 1 {
    return args[args.length() - 1]
  }
  parts.join(" ")
}
