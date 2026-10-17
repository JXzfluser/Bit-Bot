///|
/// One outbound chat line for Desktop host JSON.
pub(all) struct DesktopMessage {
  role : String
  text : String
} derive(Eq, Debug)

///|
/// Result of one MoonBit desktop turn (product brain path).
pub(all) struct DesktopTurnResult {
  ok : Bool
  turn_id : String
  messages : Array[DesktopMessage]
  modules : Array[String]
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
/// Run open_turn → acknowledge → deliver_text → end_turn; no Python.
pub fn run_desktop_turn(user_text : String, turn_id~ : String = "desktop-1") -> DesktopTurnResult {
  let mods = @bitbot.registered_modules()
  let trimmed = user_text.trim().to_owned()
  guard trimmed != "" else {
    return {
      ok: false,
      turn_id,
      messages: [],
      modules: mods,
      error: Some("empty user text"),
    }
  }
  let opened = @runtime.open_turn(turn_id~, text=trimmed)
  let acked = opened.acknowledge(body="收到，正在用 MoonBit 内核处理。")
  let reply =
    "Bit Bot (MoonBit): 已收到「" +
    trimmed +
    "」。本回合由 cmd/desktop_turn 编排，不经 Python LocalBrain。"
  match acked.deliver_text(body=reply) {
    Err(e) => {
      {
        ok: false,
        turn_id,
        messages: [
          { role: "user", text: trimmed },
          { role: "assistant", text: "收到，正在用 MoonBit 内核处理。" },
        ],
        modules: mods,
        error: Some(e),
      }
    }
    Ok(working) => {
      let ended = working.end_turn()
      let msgs : Array[DesktopMessage] = [{ role: "user", text: trimmed }]
      for env in ended.outbound {
        for part in env.parts {
          match part_text(part) {
            Some(t) => msgs.push({ role: "assistant", text: t })
            None => ()
          }
        }
      }
      {
        ok: true,
        turn_id: ended.turn_id.value,
        messages: msgs,
        modules: mods,
        error: None,
      }
    }
  }
}

///|
/// Stable JSON line for Desktop / Host FFI consumers.
pub fn DesktopTurnResult::to_json_line(self : DesktopTurnResult) -> String {
  let buf = StringBuilder()
  buf.write_string("{\"ok\":")
  buf.write_string(if self.ok { "true" } else { "false" })
  buf.write_string(",\"turn_id\":\"")
  buf.write_string(escape_json_string(self.turn_id))
  buf.write_string("\",\"messages\":[")
  let mut i = 0
  while i < self.messages.length() {
    if i > 0 {
      buf.write_string(",")
    }
    let m = self.messages[i]
    buf.write_string("{\"role\":\"")
    buf.write_string(escape_json_string(m.role))
    buf.write_string("\",\"text\":\"")
    buf.write_string(escape_json_string(m.text))
    buf.write_string("\"}")
    i = i + 1
  }
  buf.write_string("],\"modules\":[")
  i = 0
  while i < self.modules.length() {
    if i > 0 {
      buf.write_string(",")
    }
    buf.write_string("\"")
    buf.write_string(escape_json_string(self.modules[i]))
    buf.write_string("\"")
    i = i + 1
  }
  buf.write_string("]")
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
  // Skip known moon wrapper tokens if present
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
  // If we only got the exe path, treat remaining after first as text
  if parts.length() == 0 && args.length() > 1 {
    return args[args.length() - 1]
  }
  parts.join(" ")
}
