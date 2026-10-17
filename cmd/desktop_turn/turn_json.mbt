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
/// Host FFI execution result re-injected as TurnEvent (ADR 0002).
pub(all) struct DesktopHostResult {
  kind : String
  ok : Bool
  command : String
  stdout : String
  stderr : String
  error : String
} derive(Eq, Debug)

///|
/// Classified user intent for one MoonBit turn.
pub(all) enum TurnIntent {
  Chat
  ListMachines
  MemoryRecall(prefix~ : String)
  MemoryUpdate(key~ : String, value~ : String)
  HostEffect(command~ : String)
  ChannelDelivery(inbound~ : String?, outbound~ : String?, body~ : String)
  ConnectorsStatus
  ClaimInbox(local_part~ : String)
  DraftMail(to_~ : String, subject~ : String, body~ : String)
  HostContinue
} derive(Eq, Debug)

///|
pub fn TurnIntent::name(self : TurnIntent) -> String {
  match self {
    Chat => "chat"
    ListMachines => "list_machines"
    MemoryRecall(_) => "memory_recall"
    MemoryUpdate(_) => "memory_update"
    HostEffect(_) => "host_effect"
    ChannelDelivery(_) => "channel_delivery"
    ConnectorsStatus => "connectors_status"
    ClaimInbox(_) => "claim_inbox"
    DraftMail(_) => "draft_mail"
    HostContinue => "host_continue"
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
  /// ADR 0002: true when this turn absorbed Host FFI results.
  host_continued : Bool
  /// Channel delivery plan: "in_app" | "external:<addr>" | "".
  channel_delivery : String
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
/// Unescape \\n / \\t / \\\\ produced by Host argv encoding.
pub fn unescape_host_arg(s : String) -> String {
  let buf = StringBuilder()
  let mut i = 0
  let n = s.length()
  while i < n {
    let c = s[i:i + 1].to_owned()
    if c == "\\" && i + 1 < n {
      let nxt = s[i + 1:i + 2].to_owned()
      if nxt == "n" {
        buf.write_char('\n')
        i = i + 2
        continue
      } else if nxt == "t" {
        buf.write_char('\t')
        i = i + 2
        continue
      } else if nxt == "\\" {
        buf.write_char('\\')
        i = i + 2
        continue
      }
    }
    buf.write_string(c)
    i = i + 1
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
  // Channel delivery (Grok multi-channel): reply via / channel plan / channel:
  match parse_channel_intent(trimmed, low) {
    Some(ci) => return ci
    None => ()
  }
  // Connectors / mail product path
  if low == "list connectors" ||
      low == "connectors" ||
      low == "connectors status" ||
      low == "connector status" {
    return ConnectorsStatus
  }
  if low.has_prefix("claim inbox ") {
    let part = trimmed[12:].trim().to_owned()
    if part != "" {
      return ClaimInbox(local_part=part)
    }
  }
  if low.has_prefix("draft mail ") || low.has_prefix("draft email ") {
    let rest = if low.has_prefix("draft mail ") {
      trimmed[11:].to_owned()
    } else {
      trimmed[12:].to_owned()
    }
    match parse_draft_mail(rest) {
      Some((to_, subject, body)) => return DraftMail(to_~, subject~, body~)
      None => ()
    }
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
fn parse_channel_intent(trimmed : String, low : String) -> TurnIntent? {
  // reply via <addr> :: <body>
  if low.has_prefix("reply via ") {
    let rest = trimmed[10:].to_owned()
    match split_once(rest, " :: ") {
      Some((addr, body)) => {
        let a = addr.trim().to_owned()
        let b = body.trim().to_owned()
        if a != "" && b != "" {
          return Some(
            ChannelDelivery(inbound=Some(a), outbound=Some(a), body=b),
          )
        }
      }
      None => ()
    }
  }
  // channel plan inbound=<addr> body=<text>
  if low.has_prefix("channel plan ") {
    let rest = trimmed[13:].to_owned()
    let inbound = extract_kv(rest, "inbound")
    let outbound = extract_kv(rest, "outbound")
    let body = match extract_kv(rest, "body") {
      Some(b) => b
      None => ""
    }
    if body != "" {
      return Some(ChannelDelivery(inbound~, outbound~, body~))
    }
  }
  // channel:<addr> <body>  e.g. channel:slack:C1 hello
  if low.has_prefix("channel:") {
    let rest = trimmed[8:].to_owned()
    match split_once(rest, " ") {
      Some((addr, body)) => {
        let a = addr.trim().to_owned()
        let b = body.trim().to_owned()
        if a != "" && b != "" {
          let full = "channel:" + a
          // If addr already has scheme (slack:/email:/teams:), use as-is
          let inbound_addr = if a.has_prefix("slack:") ||
              a.has_prefix("email:") ||
              a.has_prefix("teams:") ||
              a.has_prefix("voice:") {
            a
          } else {
            // "channel:slack:C1 body" → rest starts with slack:
            // We already stripped "channel:", so addr may be "slack:C1"
            a
          }
          let _ = full
          return Some(
            ChannelDelivery(
              inbound=Some(inbound_addr),
              outbound=Some(inbound_addr),
              body=b,
            ),
          )
        }
      }
      None => ()
    }
  }
  None
}

///|
fn split_once(s : String, sep : String) -> (String, String)? {
  match s.find(sep) {
    Some(i) => Some((s[:i].to_owned(), s[i + sep.length():].to_owned()))
    None => None
  }
}

///|
fn extract_kv(rest : String, key : String) -> String? {
  let marker = key + "="
  match rest.find(marker) {
    None => None
    Some(i) => {
      let after = rest[i + marker.length():].to_owned()
      // value runs until next known key= or end.
      let keys = [" inbound=", " outbound=", " body=", " to=", " subject="]
      let mut end = after.length()
      for k in keys {
        match after.find(k) {
          Some(j) => if j < end { end = j }
          None => ()
        }
      }
      let v = after[:end].trim().to_owned()
      if v == "" {
        None
      } else {
        Some(v)
      }
    }
  }
}

///|
fn parse_draft_mail(rest : String) -> (String, String, String)? {
  let to_ = match extract_kv(rest, "to") {
    Some(v) => v
    None => return None
  }
  let subject = match extract_kv(rest, "subject") {
    Some(v) => v
    None => ""
  }
  let body = match extract_kv(rest, "body") {
    Some(v) => v
    None => ""
  }
  if to_ == "" {
    None
  } else {
    Some((to_, subject, body))
  }
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
  host_continued~ : Bool = false,
  channel_delivery~ : String = "",
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
        host_continued,
        channel_delivery,
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
        host_continued,
        channel_delivery,
        error: None,
      }
    }
  }
}

///|
fn channel_delivery_label(plan : @channels.ChannelDelivery) -> String {
  match plan {
    @channels.InAppOnly => "in_app"
    @channels.External(channel~) => "external:" + channel
  }
}

///|
/// ADR 0002: Effect → Host → TurnEvent 回注. Kernel absorbs Host FFI results
/// and emits the user-visible continuation (no LocalBrain).
pub fn continue_after_host_ffi(
  turn_id~ : String,
  prior_user_text~ : String,
  results : Array[DesktopHostResult],
) -> DesktopTurnResult {
  let buf = StringBuilder()
  buf.write_string("Host FFI results applied (MoonBit kernel / ADR 0002):\n")
  let mut i = 0
  while i < results.length() {
    let r = results[i]
    if i > 0 {
      buf.write_string("\n")
    }
    if r.ok {
      buf.write_string("- ok kind=")
      buf.write_string(r.kind)
      if r.command != "" {
        buf.write_string(" cmd=`")
        buf.write_string(r.command)
        buf.write_string("`")
      }
      let out = r.stdout.trim().to_owned()
      if out != "" {
        buf.write_string("\n```\n")
        buf.write_string(out)
        buf.write_string("\n```")
      } else {
        buf.write_string(" (no stdout)")
      }
      let err = r.stderr.trim().to_owned()
      if err != "" {
        buf.write_string("\nstderr: ")
        buf.write_string(err)
      }
    } else {
      buf.write_string("- fail kind=")
      buf.write_string(r.kind)
      if r.command != "" {
        buf.write_string(" cmd=`")
        buf.write_string(r.command)
        buf.write_string("`")
      }
      buf.write_string(": ")
      let e = if r.error != "" { r.error } else { "unknown host error" }
      buf.write_string(e)
    }
    i = i + 1
  }
  let reply = buf.to_string()
  let prior = if prior_user_text == "" {
    "(host-continue)"
  } else {
    prior_user_text
  }
  deliver_ok(
    prior,
    turn_id,
    reply,
    HostContinue,
    host_continued=true,
  )
}

///|
/// Seed profile rows into a fresh InMemoryStore (Host session persistence).
pub fn seed_memory_store(
  store : @memory.InMemoryStore,
  seeds : Array[(String, String)],
) -> Unit {
  for pair in seeds {
    let (k, v) = pair
    if k != "" {
      store.update(@memory.UpdateOp::{
        scope: @memory.Profile,
        key: k,
        value: v,
      })
    }
  }
}

///|
/// Parse repeated `--seed-memory key=value` from argv.
pub fn parse_memory_seeds(args : Array[String]) -> Array[(String, String)] {
  let out : Array[(String, String)] = []
  let mut i = 0
  while i < args.length() {
    if args[i] == "--seed-memory" && i + 1 < args.length() {
      match parse_memory_kv(unescape_host_arg(args[i + 1])) {
        Some(pair) => out.push(pair)
        None => ()
      }
      i = i + 2
      continue
    }
    i = i + 1
  }
  out
}

///|
/// Strip Host session flags from argv before joining user text.
pub fn user_text_from_args_skipping_flags(args : Array[String]) -> String {
  if args.length() == 0 {
    return ""
  }
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
    if a == "--seed-memory" {
      i = i + 2
      continue
    }
    if a.has_prefix("--") {
      // Unknown flag: skip flag and optional value if next looks like a value.
      if i + 1 < args.length() && !args[i + 1].has_prefix("--") {
        i = i + 2
      } else {
        i = i + 1
      }
      continue
    }
    parts.push(a)
    i = i + 1
  }
  parts.join(" ")
}

///|
/// Run open_turn → policy (intent) → deliver; Host effects stay plans until Host
/// executes and calls continue_after_host_ffi (ADR 0002).
/// `memory_seeds`: Host-persisted profile rows reinjected each process.
pub fn run_desktop_turn(
  user_text : String,
  turn_id~ : String = "desktop-1",
  memory_seeds~ : Array[(String, String)] = [],
) -> DesktopTurnResult {
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
      host_continued: false,
      channel_delivery: "",
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
      seed_memory_store(store, memory_seeds)
      store.update(@memory.UpdateOp::{
        scope: @memory.Profile,
        key: key,
        value: value,
      })
      let entries = store.recall(@memory.RecallQuery::{
        scope: @memory.Profile,
        key_prefix: None,
        limit: 64,
      })
      let rows = memory_rows(entries)
      let reply = "Memory updated (profile): " + key + " = " + value
      deliver_ok(trimmed, turn_id, reply, intent, memory=rows)
    }
    MemoryRecall(prefix~) => {
      let store = @memory.InMemoryStore::new()
      seed_memory_store(store, memory_seeds)
      // Demo row only when Host has no session seeds yet.
      if memory_seeds.length() == 0 {
        store.update(@memory.UpdateOp::{
          scope: @memory.Profile,
          key: "demo.user",
          value: "Bit Bot desktop host",
        })
      }
      let pref = if prefix == "" { None } else { Some(prefix) }
      let entries = store.recall(@memory.RecallQuery::{
        scope: @memory.Profile,
        key_prefix: pref,
        limit: 64,
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
        "Host effect planned (shell). Desktop must execute via Host FFI then call continue_after_host_ffi (ADR 0002). Not LocalBrain."
      deliver_ok(
        trimmed,
        turn_id,
        reply,
        intent,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    ChannelDelivery(inbound~, outbound~, body~) => {
      match @channels.plan_channel_reply(
        inbound_address=inbound,
        outbound_channel=outbound,
        body~,
      ) {
        Err(e) => {
          {
            v: DESKTOP_TURN_JSON_V,
            ok: false,
            turn_id,
            intent: intent.name(),
            messages: [
              { role: "user", text: trimmed },
              { role: "assistant", text: "Channel delivery refused: " + e },
            ],
            modules: mods,
            machines: [],
            memory: [],
            effects: [],
            needs_host_ffi: false,
            host_continued: false,
            channel_delivery: "",
            error: Some(e),
          }
        }
        Ok(plan) => {
          let label = channel_delivery_label(plan)
          let reply = match plan {
            @channels.InAppOnly =>
              "Channel plan: in-app only (no external delivery). Body kept in Desktop chat. " +
              body
            @channels.External(channel~) =>
              "Channel plan: external delivery to " +
              channel +
              ". Host must send via channel FFI; MoonBit planned reply. Body: " +
              body
          }
          // External channel send is a Host effect (delivery), not LocalBrain.
          let effects : Array[DesktopEffect] = match plan {
            @channels.InAppOnly => []
            @channels.External(channel~) => [
              {
                kind: "channel_send",
                command: channel + " :: " + body,
                needs_host_ffi: true,
              },
            ]
          }
          let needs = effects.length() > 0
          deliver_ok(
            trimmed,
            turn_id,
            reply,
            intent,
            effects~,
            needs_host_ffi=needs,
            channel_delivery=label,
          )
        }
      }
    }
    ConnectorsStatus => {
      let reg = @connectors.PluginRegistry::seed_demo()
      let ready = reg.ready_namespaces()
      let buf = StringBuilder()
      buf.write_string("Connectors status (PluginRegistry seed_demo): ")
      buf.write_string(ready.length().to_string())
      buf.write_string(" ready namespace(s)")
      if ready.length() > 0 {
        buf.write_string(" — ")
        buf.write_string(ready.join(", "))
      }
      buf.write_string(". Product path uses @connectors (not Python).")
      deliver_ok(trimmed, turn_id, buf.to_string(), intent)
    }
    ClaimInbox(local_part~) => {
      let svc = @mail.MailService::new()
      match svc.claim_inbox(local_part~, user_confirmed=true) {
        Err(e) => {
          {
            v: DESKTOP_TURN_JSON_V,
            ok: false,
            turn_id,
            intent: intent.name(),
            messages: [
              { role: "user", text: trimmed },
              { role: "assistant", text: "Claim inbox failed: " + e },
            ],
            modules: mods,
            machines: [],
            memory: [],
            effects: [],
            needs_host_ffi: false,
            host_continued: false,
            channel_delivery: "",
            error: Some(e),
          }
        }
        Ok(inbox) => {
          let reply =
            "Claimed agent inbox " +
            inbox.address() +
            " via @mail.MailService (Grok mail claim path)."
          deliver_ok(trimmed, turn_id, reply, intent)
        }
      }
    }
    DraftMail(to_~, subject~, body~) => {
      let card = @mail.DraftEmailCard::new(to_~, subject~, body~)
      // Draft only — send requires Host + user press (CM-1005).
      let reply =
        "Draft mail card ready (not sent). to=" +
        card.to_ +
        " subject=" +
        card.subject +
        ". Press-send is Host/UI; MoonBit holds draft semantics."
      let effect : DesktopEffect = {
        kind: "mail_draft",
        command: "to=" + to_ + " subject=" + subject,
        needs_host_ffi: false,
      }
      deliver_ok(trimmed, turn_id, reply, intent, effects=[effect])
    }
    HostContinue => {
      // Should be invoked via continue_after_host_ffi, not plain chat.
      deliver_ok(
        trimmed,
        turn_id,
        "Host continue requires --apply-host-results (ADR 0002).",
        intent,
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
  buf.write_string(",\"host_continued\":")
  buf.write_string(if self.host_continued { "true" } else { "false" })
  buf.write_string(",\"channel_delivery\":\"")
  buf.write_string(escape_json_string(self.channel_delivery))
  buf.write_string("\"")
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

///|
/// True when argv requests Host FFI result re-injection (ADR 0002).
pub fn args_want_host_continue(args : Array[String]) -> Bool {
  for a in args {
    if a == "--apply-host-results" {
      return true
    }
  }
  false
}

///|
fn push_host_result(
  results : Array[DesktopHostResult],
  kind : String,
  ok : Bool,
  command : String,
  stdout : String,
  stderr : String,
  error : String,
) -> Unit {
  results.push(
    {
      kind,
      ok,
      command: unescape_host_arg(command),
      stdout: unescape_host_arg(stdout),
      stderr: unescape_host_arg(stderr),
      error: unescape_host_arg(error),
    },
  )
}

///|
/// Parse `--apply-host-results` argv into (turn_id, prior, results).
/// Flags: --turn-id --prior-text --result-ok --result-kind --result-command
/// --result-stdout --result-stderr --result-error
/// Multiple results: repeat --result-* groups separated by --result-next.
pub fn parse_host_continue_args(
  args : Array[String],
) -> (String, String, Array[DesktopHostResult]) {
  let mut turn_id = "host-continue-1"
  let mut prior = ""
  let results : Array[DesktopHostResult] = []
  let mut kind = "shell"
  let mut ok = true
  let mut command = ""
  let mut stdout = ""
  let mut stderr = ""
  let mut error = ""
  let mut saw_result = false
  let mut i = 0
  while i < args.length() {
    let a = args[i]
    if a == "--turn-id" && i + 1 < args.length() {
      turn_id = args[i + 1]
      i = i + 2
      continue
    }
    if a == "--prior-text" && i + 1 < args.length() {
      prior = unescape_host_arg(args[i + 1])
      i = i + 2
      continue
    }
    if a == "--result-next" {
      if saw_result {
        push_host_result(results, kind, ok, command, stdout, stderr, error)
      }
      kind = "shell"
      ok = true
      command = ""
      stdout = ""
      stderr = ""
      error = ""
      saw_result = false
      i = i + 1
      continue
    }
    if a == "--result-ok" && i + 1 < args.length() {
      ok = args[i + 1] != "false" && args[i + 1] != "0"
      saw_result = true
      i = i + 2
      continue
    }
    if a == "--result-kind" && i + 1 < args.length() {
      kind = args[i + 1]
      saw_result = true
      i = i + 2
      continue
    }
    if a == "--result-command" && i + 1 < args.length() {
      command = args[i + 1]
      saw_result = true
      i = i + 2
      continue
    }
    if a == "--result-stdout" && i + 1 < args.length() {
      stdout = args[i + 1]
      saw_result = true
      i = i + 2
      continue
    }
    if a == "--result-stderr" && i + 1 < args.length() {
      stderr = args[i + 1]
      saw_result = true
      i = i + 2
      continue
    }
    if a == "--result-error" && i + 1 < args.length() {
      error = args[i + 1]
      saw_result = true
      i = i + 2
      continue
    }
    i = i + 1
  }
  if saw_result {
    push_host_result(results, kind, ok, command, stdout, stderr, error)
  }
  (turn_id, prior, results)
}
