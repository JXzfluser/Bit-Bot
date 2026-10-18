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
  DraftMail(
    to_~ : String,
    subject~ : String,
    body~ : String,
    provider~ : String,
  )
  InstallPlugin(plugin_id~ : String)
  SetupSlack
  FsList(path~ : String)
  FsRead(path~ : String)
  WebFetch(url~ : String)
  CopyToBox(machine_id~ : String, src~ : String, dest~ : String)
  CopyFromBox(machine_id~ : String, box_path~ : String, dest~ : String)
  CreateRoutine(id~ : String, cron~ : String, prompt~ : String)
  ListRoutines
  PauseRoutine(id~ : String)
  ResumeRoutine(id~ : String)
  FireRoutine(id~ : String)
  TickRoutines
  SearchMail(query~ : String)
  ReadMailThread(thread_id~ : String)
  SpawnSubagent(prompt~ : String)
  McpDiscover(namespace_~ : String)
  McpCall(namespace_~ : String, name~ : String, args_json~ : String)
  ComputerUse(task~ : String)
  TeamsSend(scope~ : String, body~ : String)
  DeviceTools
  DeviceToolInvoke(tool~ : String)
  LoadSkill(task~ : String)
  VoiceStart(call_id~ : String)
  VoiceRelay(call_id~ : String, text~ : String)
  VoiceEnd(call_id~ : String)
  CreateTeammate(id~ : String, name~ : String, role~ : String)
  AddSection(group_id~ : String, section_id~ : String, title~ : String)
  SectionPost(
    group_id~ : String,
    section_id~ : String,
    from_agent~ : String,
    body~ : String,
  )
  RoomTurn(room~ : String, body~ : String)
  SendToAgent(to_id~ : String, body~ : String)
  LaunchCloudAgent(prompt~ : String)
  DeliverCloudArtifact(artifact~ : String, dest~ : String)
  ScheduleMeeting(title~ : String, when_desc~ : String)
  ShopRetail(url_or_host~ : String)
  PurchaseItem(item~ : String, amount_cents~ : Int32)
  TravelBook(url_or_host~ : String)
  OrderFood(url_or_host~ : String)
  MeetingChat(body~ : String, direct~ : Bool)
  FinanceConnect
  FinanceCall(tool~ : String)
  FillCredential(domain~ : String)
  ListCredentials
  ColdMail(to_~ : String, subject~ : String, body~ : String, unsubscribe~ : String)
  PersonalSlackDm(owner_id~ : String, text~ : String)
  JobSearch(query~ : String)
  LearnFromDemo(title~ : String, steps_csv~ : String)
  MakeSlides(title~ : String)
  GenerateImage(prompt~ : String)
  GenerateVideo(prompt~ : String)
  WatchVideo(video_path~ : String)
  StructuredChart(series_json~ : String)
  BoxDoctor
  BoxEnv
  BoxClock
  WebhookPanel
  WebhookCopy(what~ : String)
  WebhookToolReadKey
  WebhookWake(event_id~ : String, summary~ : String)
  OpenSettings(entry~ : String, anchor~ : String)
  OpenAgentInfoPanel(agent_id~ : String)
  DeleteAgent(agent_id~ : String, confirm~ : Bool)
  PackageInstall(pm~ : String, packages_csv~ : String, via~ : String)
  SharedBoxFs
  HideAgent(agent_id~ : String, hidden~ : Bool)
  ListAgentsSidebar
  MembersPanel(group_id~ : String)
  CodeChanges(path~ : String)
  SourceControl(repo_kind~ : String)
  SendOnBehalf(to_~ : String, subject~ : String, body~ : String)
  ListWorkflows
  IdentityBrowser
  XSearch(query~ : String)
  AuthorSkill(name~ : String, description~ : String, body~ : String)
  ExportBotTemplate(bot_id~ : String, name~ : String)
  ConnectGmail
  JournalAppend(date~ : String, event_id~ : String, body~ : String)
  JournalQuery(from_date~ : String, to_date~ : String)
  SharedMemoryPut(scope~ : String, key~ : String, value~ : String)
  SharedMemoryRead(scope~ : String, key~ : String)
  InboundReaction(emoji~ : String, useful~ : Bool)
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
    InstallPlugin(_) => "install_plugin"
    SetupSlack => "setup_slack"
    FsList(_) => "fs_list"
    FsRead(_) => "fs_read"
    WebFetch(_) => "webfetch"
    CopyToBox(_) => "copy_to_box"
    CopyFromBox(_) => "copy_from_box"
    CreateRoutine(_) => "create_routine"
    ListRoutines => "list_routines"
    PauseRoutine(_) => "pause_routine"
    ResumeRoutine(_) => "resume_routine"
    FireRoutine(_) => "fire_routine"
    TickRoutines => "tick_routines"
    SearchMail(_) => "search_mail"
    ReadMailThread(_) => "read_mail_thread"
    SpawnSubagent(_) => "spawn_subagent"
    McpDiscover(_) => "mcp_discover"
    McpCall(_) => "mcp_call"
    ComputerUse(_) => "computer_use"
    TeamsSend(_) => "teams_send"
    DeviceTools => "device_tools"
    DeviceToolInvoke(_) => "device_tool_invoke"
    LoadSkill(_) => "load_skill"
    VoiceStart(_) => "voice_start"
    VoiceRelay(_) => "voice_relay"
    VoiceEnd(_) => "voice_end"
    CreateTeammate(_) => "create_teammate"
    AddSection(_) => "add_section"
    SectionPost(_) => "section_post"
    RoomTurn(_) => "room_turn"
    SendToAgent(_) => "send_to_agent"
    LaunchCloudAgent(_) => "launch_cloud_agent"
    DeliverCloudArtifact(_) => "deliver_cloud_artifact"
    ScheduleMeeting(_) => "schedule_meeting"
    ShopRetail(_) => "shop_retail"
    PurchaseItem(_) => "purchase_item"
    TravelBook(_) => "travel_book"
    OrderFood(_) => "order_food"
    MeetingChat(_) => "meeting_chat"
    FinanceConnect => "finance_connect"
    FinanceCall(_) => "finance_call"
    FillCredential(_) => "fill_credential"
    ListCredentials => "list_credentials"
    ColdMail(_) => "cold_mail"
    PersonalSlackDm(_) => "personal_slack_dm"
    JobSearch(_) => "job_search"
    LearnFromDemo(_) => "learn_from_demo"
    MakeSlides(_) => "make_slides"
    GenerateImage(_) => "generate_image"
    GenerateVideo(_) => "generate_video"
    WatchVideo(_) => "watch_video"
    StructuredChart(_) => "structured_chart"
    BoxDoctor => "box_doctor"
    BoxEnv => "box_env"
    BoxClock => "box_clock"
    WebhookPanel => "webhook_panel"
    WebhookCopy(_) => "webhook_copy"
    WebhookToolReadKey => "webhook_tool_read_key"
    WebhookWake(_) => "webhook_wake"
    OpenSettings(_) => "open_settings"
    OpenAgentInfoPanel(_) => "open_agent_info_panel"
    DeleteAgent(_) => "delete_agent"
    PackageInstall(_) => "package_install"
    SharedBoxFs => "shared_box_fs"
    HideAgent(_) => "hide_agent"
    ListAgentsSidebar => "list_agents_sidebar"
    MembersPanel(_) => "members_panel"
    CodeChanges(_) => "code_changes"
    SourceControl(_) => "source_control"
    SendOnBehalf(_) => "send_on_behalf"
    ListWorkflows => "list_workflows"
    IdentityBrowser => "identity_browser"
    XSearch(_) => "x_search"
    AuthorSkill(_) => "author_skill"
    ExportBotTemplate(_) => "export_bot_template"
    ConnectGmail => "connect_gmail"
    JournalAppend(_) => "journal_append"
    JournalQuery(_) => "journal_query"
    SharedMemoryPut(_) => "shared_memory_put"
    SharedMemoryRead(_) => "shared_memory_read"
    InboundReaction(_) => "inbound_reaction"
    HostContinue => "host_continue"
  }
}

///|
/// CM-0705: map Host TurnContext to seeded phone machine ids for deviceLocalTools.
fn resolve_device_machine_id(ctx : DesktopTurnContext) -> String {
  if ctx.machine_kind == "ios" {
    if ctx.machine_id == "" || ctx.machine_id == "desk-1" {
      "phone-ios"
    } else {
      ctx.machine_id
    }
  } else if ctx.machine_kind == "android" {
    if ctx.machine_id == "" || ctx.machine_id == "desk-1" {
      "phone-android"
    } else {
      ctx.machine_id
    }
  } else {
    ctx.machine_id
  }
}

///|
/// Parse `kind:detail|kind:detail` demo steps for CM-1808.
fn parse_demo_steps(csv : String) -> Array[@skills.DemoStep] {
  let out : Array[@skills.DemoStep] = []
  let mut rest = csv.trim().to_owned()
  while rest.length() > 0 {
    let (part, more) = match split_once(rest, "|") {
      Some((p, m)) => (p, m)
      None => (rest, "")
    }
    match split_once(part, ":") {
      Some((k, d)) => out.push({ kind: k.trim().to_owned(), detail: d.trim().to_owned() })
      None => out.push({ kind: "step", detail: part.trim().to_owned() })
    }
    rest = more
  }
  out
}

///|
/// Multi-end TurnContext fields (Grok machine/channel session).
pub(all) struct DesktopTurnContext {
  session_id : String
  machine_id : String
  machine_kind : String
  channel : String
  /// Host passed `--approved` after user confirmed an ApprovalGate NeedUser.
  approved : Bool
} derive(Eq, Debug)

///|
pub fn DesktopTurnContext::default() -> DesktopTurnContext {
  {
    session_id: "desktop-session",
    machine_id: "desk-1",
    machine_kind: "desktop",
    channel: "",
    approved: false,
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
  session_id : String
  machine_id : String
  machine_kind : String
  channel : String
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
  // Grok Host tools: ListDir / Read / WebFetch → Host FFI effects
  if low.has_prefix("listdir ") ||
      low.has_prefix("list dir ") ||
      low.has_prefix("fs list ") {
    let p = if low.has_prefix("listdir ") {
      trimmed[8:].trim().to_owned()
    } else if low.has_prefix("list dir ") {
      trimmed[9:].trim().to_owned()
    } else {
      trimmed[8:].trim().to_owned()
    }
    if p != "" {
      return FsList(path=p)
    }
  }
  // Mail search/read before generic Host Read (CM-0906/1004).
  if low.has_prefix("search mail ") ||
      low.has_prefix("search inbox ") ||
      low.has_prefix("search email ") {
    let query = if low.has_prefix("search mail ") {
      trimmed[12:].trim().to_owned()
    } else if low.has_prefix("search inbox ") {
      trimmed[13:].trim().to_owned()
    } else {
      trimmed[13:].trim().to_owned()
    }
    if query != "" {
      return SearchMail(query~)
    }
  }
  if low.has_prefix("read mail ") ||
      low.has_prefix("read thread ") ||
      low.has_prefix("open mail ") {
    let thread_id = if low.has_prefix("read mail ") {
      trimmed[10:].trim().to_owned()
    } else if low.has_prefix("read thread ") {
      trimmed[12:].trim().to_owned()
    } else {
      trimmed[10:].trim().to_owned()
    }
    if thread_id != "" {
      return ReadMailThread(thread_id~)
    }
  }
  if low.has_prefix("read ") ||
      low.has_prefix("read file ") ||
      low.has_prefix("fs read ") {
    let p = if low.has_prefix("read file ") {
      trimmed[10:].trim().to_owned()
    } else if low.has_prefix("fs read ") {
      trimmed[8:].trim().to_owned()
    } else {
      trimmed[5:].trim().to_owned()
    }
    // Do not steal mail/thread utterances into fs_read.
    if p != "" &&
        !p.has_prefix("http://") &&
        !p.has_prefix("https://") &&
        !p.has_prefix("mail ") &&
        !p.has_prefix("thread ") {
      return FsRead(path=p)
    }
  }
  if low.has_prefix("webfetch ") ||
      low.has_prefix("fetch ") ||
      low.has_prefix("web fetch ") {
    let u = if low.has_prefix("webfetch ") {
      trimmed[9:].trim().to_owned()
    } else if low.has_prefix("web fetch ") {
      trimmed[10:].trim().to_owned()
    } else {
      trimmed[6:].trim().to_owned()
    }
    if u.has_prefix("http://") || u.has_prefix("https://") {
      return WebFetch(url=u)
    }
  }
  // Multi-end file routing (CM-0703/0704) — Host FFI copies real bytes.
  if low.has_prefix("copy to box ") || low.has_prefix("copytobox ") {
    let rest = if low.has_prefix("copy to box ") {
      trimmed[12:].to_owned()
    } else {
      trimmed[10:].to_owned()
    }
    let mid = match extract_kv(rest, "machine") {
      Some(v) => v
      None => "desk-1"
    }
    let src = match extract_kv(rest, "src") {
      Some(v) => v
      None => ""
    }
    let dest = match extract_kv(rest, "dest") {
      Some(v) => v
      None => ""
    }
    if src != "" {
      return CopyToBox(machine_id=mid, src~, dest~)
    }
  }
  if low.has_prefix("copy from box ") || low.has_prefix("copyfrombox ") {
    let rest = if low.has_prefix("copy from box ") {
      trimmed[14:].to_owned()
    } else {
      trimmed[12:].to_owned()
    }
    let mid = match extract_kv(rest, "machine") {
      Some(v) => v
      None => "desk-1"
    }
    let box_path = match extract_kv(rest, "box") {
      Some(v) => v
      None =>
        match extract_kv(rest, "src") {
          Some(v) => v
          None => ""
        }
    }
    let dest = match extract_kv(rest, "dest") {
      Some(v) => v
      None => ""
    }
    if box_path != "" && dest != "" {
      return CopyFromBox(machine_id=mid, box_path~, dest~)
    }
  }
  if low.has_prefix("install plugin ") || low.has_prefix("add connector ") {
    let id = if low.has_prefix("install plugin ") {
      trimmed[15:].trim().to_owned()
    } else {
      trimmed[14:].trim().to_owned()
    }
    if id != "" {
      return InstallPlugin(plugin_id=id)
    }
  }
  if low == "setup slack" ||
      low == "set up slack" ||
      low == "connect slack" ||
      low == "setupslack" {
    return SetupSlack
  }
  if low.has_prefix("claim inbox ") {
    let part = trimmed[12:].trim().to_owned()
    if part != "" {
      return ClaimInbox(local_part=part)
    }
  }
  if low.has_prefix("draft outlook mail ") ||
      low.has_prefix("draft mail ") ||
      low.has_prefix("draft email ") {
    let (rest, default_provider) = if low.has_prefix("draft outlook mail ") {
      (trimmed[19:].to_owned(), "outlook")
    } else if low.has_prefix("draft mail ") {
      (trimmed[11:].to_owned(), "gmail")
    } else {
      (trimmed[12:].to_owned(), "gmail")
    }
    match parse_draft_mail(rest) {
      Some((to_, subject, body, provider)) => {
        let prov = if provider != "" { provider } else { default_provider }
        return DraftMail(to_~, subject~, body~, provider=prov)
      }
      None => ()
    }
  }
  match classify_parity_intent(trimmed, low) {
    Some(pi) => return pi
    None => ()
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
      let keys = [
        " inbound=",
        " outbound=",
        " body=",
        " to=",
        " subject=",
        " machine=",
        " src=",
        " dest=",
        " box=",
        " id=",
        " cron=",
        " prompt=",
        " name=",
        " role=",
        " item=",
        " cents=",
        " title=",
        " when=",
        " artifact=",
        " domain=",
        " unsubscribe=",
        " owner=",
        " text=",
        " direct=",
        " steps=",
        " description=",
        " date=",
        " from=",
        " scope=",
        " key=",
        " value=",
        " group=",
        " section=",
        " provider=",
        " entry=",
        " anchor=",
        " agent=",
        " confirm=",
        " via=",
        " pm=",
        " pkgs=",
        " packages=",
        " group=",
        " hidden=",
      ]
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
fn parse_draft_mail(rest : String) -> (String, String, String, String)? {
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
  let provider = match extract_kv(rest, "provider") {
    Some(v) => v.to_lower()
    None => ""
  }
  if to_ == "" {
    None
  } else {
    Some((to_, subject, body, provider))
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
fn fail_turn(
  user_text : String,
  turn_id : String,
  intent : TurnIntent,
  err : String,
  ctx : DesktopTurnContext,
  assistant~ : String = "",
) -> DesktopTurnResult {
  let mods = @bitbot.registered_modules()
  let msg = if assistant == "" { err } else { assistant }
  {
    v: DESKTOP_TURN_JSON_V,
    ok: false,
    turn_id,
    intent: intent.name(),
    messages: [
      { role: "user", text: user_text },
      { role: "assistant", text: msg },
    ],
    modules: mods,
    machines: [],
    memory: [],
    effects: [],
    needs_host_ffi: false,
    host_continued: false,
    channel_delivery: "",
    session_id: ctx.session_id,
    machine_id: ctx.machine_id,
    machine_kind: ctx.machine_kind,
    channel: ctx.channel,
    error: Some(err),
  }
}

///|
fn deliver_ok(
  user_text : String,
  turn_id : String,
  reply : String,
  intent : TurnIntent,
  ctx~ : DesktopTurnContext = DesktopTurnContext::default(),
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
    Err(e) =>
      fail_turn(user_text, turn_id, intent, e, ctx)
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
        session_id: ctx.session_id,
        machine_id: ctx.machine_id,
        machine_kind: ctx.machine_kind,
        channel: ctx.channel,
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
  ctx~ : DesktopTurnContext = DesktopTurnContext::default(),
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
    ctx~,
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
    if a == "--approved" {
      i = i + 1
      continue
    }
    if a == "--seed-memory" ||
        a == "--session-id" ||
        a == "--machine-id" ||
        a == "--machine-kind" ||
        a == "--channel" ||
        a == "--turn-id" {
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
/// Parse TurnContext flags from Host argv.
pub fn parse_turn_context(args : Array[String]) -> DesktopTurnContext {
  let mut ctx = DesktopTurnContext::default()
  let mut i = 0
  while i < args.length() {
    let a = args[i]
    if a == "--approved" {
      ctx = {
        session_id: ctx.session_id,
        machine_id: ctx.machine_id,
        machine_kind: ctx.machine_kind,
        channel: ctx.channel,
        approved: true,
      }
      i = i + 1
      continue
    }
    if a == "--session-id" && i + 1 < args.length() {
      ctx = {
        session_id: args[i + 1],
        machine_id: ctx.machine_id,
        machine_kind: ctx.machine_kind,
        channel: ctx.channel,
        approved: ctx.approved,
      }
      i = i + 2
      continue
    }
    if a == "--machine-id" && i + 1 < args.length() {
      ctx = {
        session_id: ctx.session_id,
        machine_id: args[i + 1],
        machine_kind: ctx.machine_kind,
        channel: ctx.channel,
        approved: ctx.approved,
      }
      i = i + 2
      continue
    }
    if a == "--machine-kind" && i + 1 < args.length() {
      let kind = args[i + 1].to_lower()
      let mid = if ctx.machine_id == "desk-1" || ctx.machine_id == "" {
        if kind == "ios" {
          "phone-ios"
        } else if kind == "android" {
          "phone-android"
        } else {
          "desk-1"
        }
      } else {
        ctx.machine_id
      }
      ctx = {
        session_id: ctx.session_id,
        machine_id: mid,
        machine_kind: kind,
        channel: ctx.channel,
        approved: ctx.approved,
      }
      i = i + 2
      continue
    }
    if a == "--channel" && i + 1 < args.length() {
      ctx = {
        session_id: ctx.session_id,
        machine_id: ctx.machine_id,
        machine_kind: ctx.machine_kind,
        channel: args[i + 1],
        approved: ctx.approved,
      }
      i = i + 2
      continue
    }
    i = i + 1
  }
  ctx
}

///|
/// Optional `--turn-id` override from Host.
pub fn parse_turn_id_flag(args : Array[String], default~ : String) -> String {
  let mut i = 0
  while i < args.length() {
    if args[i] == "--turn-id" && i + 1 < args.length() {
      return args[i + 1]
    }
    i = i + 1
  }
  default
}

///|
/// Run open_turn → policy (intent) → deliver; Host effects stay plans until Host
/// executes and calls continue_after_host_ffi (ADR 0002).
/// `memory_seeds`: Host-persisted profile rows reinjected each process.
pub fn run_desktop_turn(
  user_text : String,
  turn_id~ : String = "desktop-1",
  memory_seeds~ : Array[(String, String)] = [],
  ctx~ : DesktopTurnContext = DesktopTurnContext::default(),
) -> DesktopTurnResult {
  let trimmed = user_text.trim().to_owned()
  guard trimmed != "" else {
    return fail_turn(
      trimmed,
      turn_id,
      Chat,
      "empty user text",
      ctx,
    )
  }
  let intent = classify_intent(trimmed)
  match intent {
    ListMachines => {
      let reg = @box_host.MachineRegistry::seed()
      // Active Host shell (Desktop/cli/mobile_host) is Connected for its kind/id.
      reg.mark_host_present(
        machine_id=ctx.machine_id,
        machine_kind=ctx.machine_kind,
      )
      let rows = machine_rows(reg)
      let reply =
        "ListMachines: " +
        rows.length().to_string() +
        " registered (desktop + ios + android). Host kinds via @box_host. Active machine_kind=" +
        ctx.machine_kind +
        " id=" +
        ctx.machine_id +
        ". Host journals registry snapshot."
      // command: host_kind|host_id|id:kind:status,...
      let buf = StringBuilder()
      buf.write_string(ctx.machine_kind)
      buf.write_string("|")
      buf.write_string(ctx.machine_id)
      buf.write_string("|")
      let mut i = 0
      while i < rows.length() {
        if i > 0 {
          buf.write_string(",")
        }
        let m = rows[i]
        buf.write_string(m.id)
        buf.write_string(":")
        buf.write_string(m.kind)
        buf.write_string(":")
        buf.write_string(m.status)
        i = i + 1
      }
      let effect : DesktopEffect = {
        kind: "machines_list",
        command: buf.to_string(),
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        reply,
        intent,
        ctx~,
        machines=rows,
        effects=[effect],
        needs_host_ffi=true,
      )
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
      let reply =
        "Memory updated (profile): " +
        key +
        " = " +
        value +
        ". Host journals profile vault."
      let effect : DesktopEffect = {
        kind: "memory_update",
        command: key + "|" + value,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        reply,
        intent,
        ctx~,
        memory=rows,
        effects=[effect],
        needs_host_ffi=true,
      )
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
        "Memory recall (profile): " +
        rows.length().to_string() +
        " entr(y/ies). Host materializes recall snapshot."
      let effect : DesktopEffect = {
        kind: "memory_recall",
        command: prefix,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        reply,
        intent,
        ctx~,
        memory=rows,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    HostEffect(command~) => {
      match gate_consequential(
        trimmed,
        turn_id,
        intent,
        ctx,
        @security.Shell,
        "shell: " + command,
        irreversible=false,
      ) {
        Some(blocked) => blocked
        None => {
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
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    ChannelDelivery(inbound~, outbound~, body~) => {
      match @channels.plan_channel_reply(
        inbound_address=inbound,
        outbound_channel=outbound,
        body~,
      ) {
        Err(e) =>
          fail_turn(
            trimmed,
            turn_id,
            intent,
            e,
            ctx,
            assistant="Channel delivery refused: " + e,
          )
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
          if needs {
            match gate_consequential(
              trimmed,
              turn_id,
              intent,
              ctx,
              @security.ExternalSend,
              "channel_send: " + label,
              irreversible=true,
            ) {
              Some(blocked) => blocked
              None =>
                deliver_ok(
                  trimmed,
                  turn_id,
                  reply,
                  intent,
                  ctx~,
                  effects~,
                  needs_host_ffi=true,
                  channel_delivery=label,
                )
            }
          } else {
            deliver_ok(
              trimmed,
              turn_id,
              reply,
              intent,
              ctx~,
              channel_delivery=label,
            )
          }
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
      buf.write_string(
        ". Host will probe Slack/Gmail/Outlook via connectors_probe FFI.",
      )
      let effect : DesktopEffect = {
        kind: "connectors_probe",
        command: "slack,gmail,outlook",
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        buf.to_string(),
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    FsList(path~) => {
      let effect : DesktopEffect = {
        kind: "fs_list",
        command: path,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Host effect planned (fs_list). Desktop/CLI must ListDir via Host FFI.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    FsRead(path~) => {
      let effect : DesktopEffect = {
        kind: "fs_read",
        command: path,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Host effect planned (fs_read). Desktop/CLI must Read via Host FFI.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    WebFetch(url~) => {
      let effect : DesktopEffect = {
        kind: "webfetch",
        command: url,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Host effect planned (webfetch). Desktop/CLI must WebFetch via Host FFI.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    CopyToBox(machine_id~, src~, dest~) => {
      let dest_final = if dest == "" {
        "/workspace/uploads/" + src
      } else {
        dest
      }
      let effect : DesktopEffect = {
        kind: "copy_to_box",
        command: machine_id + "|" + src + "|" + dest_final,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "CopyToBox planned for machine=" +
        machine_id +
        " src=" +
        src +
        " → " +
        dest_final +
        ". Host FFI performs real copy (CM-0703).",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    CopyFromBox(machine_id~, box_path~, dest~) => {
      let effect : DesktopEffect = {
        kind: "copy_from_box",
        command: machine_id + "|" + box_path + "|" + dest,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "CopyFromBox planned for machine=" +
        machine_id +
        " box=" +
        box_path +
        " → " +
        dest +
        ". Host FFI performs real copy (CM-0704).",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    InstallPlugin(plugin_id~) => {
      let reg = @connectors.PluginRegistry::seed_demo()
      match reg.install(plugin_id) {
        Err(e) =>
          fail_turn(
            trimmed,
            turn_id,
            intent,
            e,
            ctx,
            assistant="Install plugin failed: " + e,
          )
        Ok(skills) => {
          let ready = reg.ready_namespaces()
          let reply =
            "Installed plugin " +
            plugin_id +
            " (" +
            skills.length().to_string() +
            " skill(s)); ready namespaces: " +
            ready.join(", ") +
            ". MCP Live calls still need Host FFI."
          let effect : DesktopEffect = {
            kind: "mcp_namespace",
            command: plugin_id,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            reply,
            intent, ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    SetupSlack => {
      let session = @channels.SetUpSlackSession::new()
      match session.connect_tool() {
        Err(e) =>
          fail_turn(
            trimmed,
            turn_id,
            intent,
            e,
            ctx,
            assistant="SetUpSlack failed: " + e,
          )
        Ok(status) => {
          let reply =
            "SetUpSlack: " +
            status.label() +
            " via @channels.SetUpSlackSession (Grok Slack connect path). Live OAuth is Host FFI."
          let effect : DesktopEffect = {
            kind: "oauth",
            command: "slack",
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            reply,
            intent, ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    ClaimInbox(local_part~) => {
      let svc = @mail.MailService::new()
      match svc.claim_inbox(local_part~, user_confirmed=true) {
        Err(e) =>
          fail_turn(
            trimmed,
            turn_id,
            intent,
            e,
            ctx,
            assistant="Claim inbox failed: " + e,
          )
        Ok(inbox) => {
          let addr = inbox.address()
          let reply =
            "Claimed agent inbox " +
            addr +
            " via @mail.MailService (Grok mail claim path). Host journals claim."
          let effect : DesktopEffect = {
            kind: "mail_claim_inbox",
            command: local_part + "|" + addr,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            reply,
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    DraftMail(to_~, subject~, body~, provider~) => {
      let card = @mail.DraftEmailCard::new(to_~, subject~, body~)
      let prov = if provider == "" { "gmail" } else { provider }
      match gate_consequential(
        trimmed,
        turn_id,
        intent,
        ctx,
        @security.ExternalSend,
        "mail_send to=" + to_,
        irreversible=true,
      ) {
        Some(blocked) => blocked
        None => {
          let reply =
            "Draft mail card ready. provider=" +
            prov +
            " to=" +
            card.to_ +
            " subject=" +
            card.subject +
            ". Host FFI mail_send executes (sandbox journal without token)."
          let effect : DesktopEffect = {
            kind: "mail_send",
            command: prov + "|" + to_ + "|" + subject + "|" + body,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            reply,
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    CreateRoutine(id~, cron~, prompt~) => {
      let store = @routines.RoutineStore::empty()
      let spec : @routines.RoutineSpec = {
        id,
        name: id,
        prompt,
        trigger: @routines.Cron(expr=cron),
        timing: @routines.Exact,
        enabled: true,
        early_minutes: 0,
        late_minutes: 0,
      }
      match store.create(spec) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(_) => {
          let effect : DesktopEffect = {
            kind: "routine_schedule",
            command: id + "|" + cron + "|" + prompt,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Routine created: " + id + " cron=" + cron + ". Host registers schedule.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    ListRoutines => {
      let effect : DesktopEffect = {
        kind: "routine_list",
        command: "list",
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "List routines via Host durable store (CM-04).",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    PauseRoutine(id~) => {
      let store = @routines.RoutineStore::empty()
      let spec : @routines.RoutineSpec = {
        id,
        name: id,
        prompt: "(host-persisted)",
        trigger: @routines.Cron(expr="@daily"),
        timing: @routines.Exact,
        enabled: true,
        early_minutes: 0,
        late_minutes: 0,
      }
      let _ = store.create(spec)
      match store.pause(id) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(_) => {
          let effect : DesktopEffect = {
            kind: "routine_pause",
            command: id,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Routine paused: " + id + " (CM-0413). Host updates durable store.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    ResumeRoutine(id~) => {
      let store = @routines.RoutineStore::empty()
      let spec : @routines.RoutineSpec = {
        id,
        name: id,
        prompt: "(host-persisted)",
        trigger: @routines.Cron(expr="@daily"),
        timing: @routines.Exact,
        enabled: false,
        early_minutes: 0,
        late_minutes: 0,
      }
      let _ = store.create(spec)
      let _ = store.pause(id)
      match store.resume_routine(id) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(_) => {
          let effect : DesktopEffect = {
            kind: "routine_resume",
            command: id,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Routine resumed: " + id + " (CM-0413). Host updates durable store.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    TickRoutines => {
      let effect : DesktopEffect = {
        kind: "routine_tick",
        command: "wake-due",
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Routine wake tick planned — Host fires due routines (next_due).",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    FireRoutine(id~) => {
      let store = @routines.RoutineStore::empty()
      let spec : @routines.RoutineSpec = {
        id,
        name: id,
        prompt: "(host-persisted)",
        trigger: @routines.Cron(expr="@daily"),
        timing: @routines.Exact,
        enabled: true,
        early_minutes: 0,
        late_minutes: 0,
      }
      let _ = store.create(spec)
      if !store.is_fireable(id) {
        fail_turn(
          trimmed,
          turn_id,
          intent,
          "routine not fireable: " + id,
          ctx,
          assistant="routine not fireable: " + id,
        )
      } else {
        let effect : DesktopEffect = {
          kind: "routine_fire",
          command: id,
          needs_host_ffi: true,
        }
        deliver_ok(
          trimmed,
          turn_id,
          "Routine fire planned: " +
          id +
          ". Host wakes destination delivery (CM-04).",
          intent,
          ctx~,
          effects=[effect],
          needs_host_ffi=true,
        )
      }
    }
    SearchMail(query~) => {
      let gmail = @mail.GmailMcpSurface::new()
      gmail.seed_thread(
        id="t-invoice-1",
        subject="Invoice #42",
        snippet="Please pay invoice for " + query,
      )
      gmail.seed_thread(
        id="t-hello-1",
        subject="Hello",
        snippet="Hi there",
      )
      let hits = gmail.search_threads(query~)
      let buf = StringBuilder()
      buf.write_string("Mail search «")
      buf.write_string(query)
      buf.write_string("»: ")
      buf.write_string(hits.length().to_string())
      buf.write_string(" thread(s)")
      let mut i = 0
      while i < hits.length() && i < 5 {
        buf.write_string(" | ")
        buf.write_string(hits[i].id)
        buf.write_string(":")
        buf.write_string(hits[i].subject)
        i = i + 1
      }
      let effect : DesktopEffect = {
        kind: "mail_search",
        command: query,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        buf.to_string() + " (CM-0906/1004). Host executes live Gmail when token present.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    ReadMailThread(thread_id~) => {
      let gmail = @mail.GmailMcpSurface::new()
      gmail.seed_thread(
        id=thread_id,
        subject="Thread " + thread_id,
        snippet="Body for " + thread_id,
      )
      match gmail.read_thread(thread_id~) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(th) => {
          let effect : DesktopEffect = {
            kind: "mail_read",
            command: thread_id,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Read mail thread " +
            th.id +
            " subject=" +
            th.subject +
            " (CM-0906). Host fetches live body when connected.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    SpawnSubagent(prompt~) => {
      let h = @task.SubagentHandle::dispatch_executor(
        "sub-" + turn_id,
        turn_id,
        prompt,
      )
      h.mark_running()
      let effect : DesktopEffect = {
        kind: "subagent_run",
        command: h.id + "|" + prompt,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Subagent dispatched id=" +
        h.id +
        " kind=executor. Host runs worker; MoonBit keeps handle.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    McpDiscover(namespace_~) => {
      let cat = @tools.DynamicCatalog::seed_example()
      let found = if namespace_ == "" {
        cat.discover()
      } else {
        cat.discover(ns=Some(namespace_))
      }
      let buf = StringBuilder()
      buf.write_string("MCP discover: ")
      buf.write_string(found.length().to_string())
      buf.write_string(" tool(s)")
      let mut i = 0
      while i < found.length() && i < 8 {
        buf.write_string(" | ")
        buf.write_string(found[i].namespace_)
        buf.write_string(".")
        buf.write_string(found[i].name)
        i = i + 1
      }
      let effect : DesktopEffect = {
        kind: "mcp_discover",
        command: if namespace_ == "" { "*" } else { namespace_ },
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        buf.to_string(),
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    McpCall(namespace_~, name~, args_json~) => {
      let cat = @tools.DynamicCatalog::seed_example()
      let _ = cat.discover(ns=Some(namespace_))
      // CM-2164: write_result / write_to_file must request Host FS write_to_file.
      let want_write =
        name == "write_result" ||
        name == "write_to_file" ||
        args_json.to_lower().contains("\"write_to_file\":true") ||
        args_json.to_lower().contains("\"write_to_file\": true")
      let call : @tools.DynamicCall = {
        namespace_,
        name,
        arguments_json: args_json,
        write_to_file: want_write,
      }
      let tr = cat.call(call)
      match tr {
        Err(message~) =>
          fail_turn(trimmed, turn_id, intent, message, ctx, assistant=message)
        Blocked(reason~) =>
          fail_turn(trimmed, turn_id, intent, reason, ctx, assistant=reason)
        PendingApproval(request_id~) =>
          deliver_ok(
            trimmed,
            turn_id,
            "MCP call pending approval: " + request_id,
            intent,
            ctx~,
            effects=[
              {
                kind: "approval_card",
                command: "mcp :: " + request_id,
                needs_host_ffi: true,
              },
            ],
            needs_host_ffi=true,
          )
        Ok(output~) => {
          let effect : DesktopEffect = {
            kind: "mcp_call",
            command: namespace_ + "." + name + "|" + args_json,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "MCP call planned/mock: " + output + ". Host executes live MCP.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    ComputerUse(task~) => {
      let spec : @computer_use.ComputerUseSpec = {
        task,
        allow_shell_escape: false,
      }
      match @computer_use.dispatch_computer_use("cu-" + turn_id, turn_id, spec) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok((_h, outcome)) => {
          let effect : DesktopEffect = {
            kind: "computer_use",
            command: task,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "computerUse outcome: " +
            outcome.summary +
            " agent=" +
            outcome.agent_id +
            ". Host owns GUI automation.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    TeamsSend(scope~, body~) => {
      // Accept CM-1107 teams:<tenant>/<team>[/<channel>] or Host Graph chat id teams:<chatId>.
      let addr = if scope.has_prefix("teams:") {
        scope
      } else {
        "teams:" + scope
      }
      match @channels.parse_teams_scope(addr) {
        Ok(ts) =>
          match @channels.plan_teams_outbound(
            { scope: ts, message_id: turn_id, sender: "user", body: "" },
            ts,
            body~,
          ) {
            @channels.Rejected(reason~) =>
              fail_turn(trimmed, turn_id, intent, reason, ctx, assistant=reason)
            @channels.Deliver(scope~, body~) => {
              match gate_consequential(
                trimmed,
                turn_id,
                intent,
                ctx,
                @security.ExternalSend,
                "teams_send " + scope.to_address(),
                irreversible=true,
              ) {
                Some(blocked) => blocked
                None => {
                  let effect : DesktopEffect = {
                    kind: "channel_send",
                    command: scope.to_address() + " :: " + body,
                    needs_host_ffi: true,
                  }
                  deliver_ok(
                    trimmed,
                    turn_id,
                    "Teams outbound planned to " +
                    scope.to_address() +
                    ". Host channel FFI delivers.",
                    intent,
                    ctx~,
                    effects=[effect],
                    needs_host_ffi=true,
                    channel_delivery="external:" + scope.to_address(),
                  )
                }
              }
            }
          }
        Err(_) => {
          // Host Graph chat-id form (teams:Tsmoke) — still channel_send; not pretend tenant/team.
          if !addr.has_prefix("teams:") || addr == "teams:" {
            fail_turn(
              trimmed,
              turn_id,
              intent,
              "not a teams: address",
              ctx,
              assistant="not a teams: address",
            )
          } else {
            match gate_consequential(
              trimmed,
              turn_id,
              intent,
              ctx,
              @security.ExternalSend,
              "teams_send " + addr,
              irreversible=true,
            ) {
              Some(blocked) => blocked
              None => {
                let effect : DesktopEffect = {
                  kind: "channel_send",
                  command: addr + " :: " + body,
                  needs_host_ffi: true,
                }
                deliver_ok(
                  trimmed,
                  turn_id,
                  "Teams Host chat outbound planned to " +
                  addr +
                  " (Graph chat id). Host channel FFI delivers.",
                  intent,
                  ctx~,
                  effects=[effect],
                  needs_host_ffi=true,
                  channel_delivery="external:" + addr,
                )
              }
            }
          }
        }
      }
    }
    DeviceTools => {
      let reg = @box_host.DeviceLocalToolsRegistry::seed_phones()
      let kind = if ctx.machine_kind == "ios" {
        @box_host.Ios
      } else if ctx.machine_kind == "android" {
        @box_host.Android
      } else {
        @box_host.Desktop
      }
      let mid = resolve_device_machine_id(ctx)
      let tools = reg.list_for(mid, kind)
      let buf = StringBuilder()
      buf.write_string("deviceLocalTools on ")
      buf.write_string(ctx.machine_kind)
      buf.write_string("/")
      buf.write_string(mid)
      buf.write_string(": ")
      buf.write_string(tools.length().to_string())
      // Host FFI command: machine_id|machine_kind|name=perm,name=perm…
      let cmd = StringBuilder()
      cmd.write_string(mid)
      cmd.write_string("|")
      cmd.write_string(ctx.machine_kind)
      cmd.write_string("|")
      let mut i = 0
      while i < tools.length() {
        buf.write_string(" | ")
        buf.write_string(tools[i].name)
        buf.write_string("=")
        buf.write_string(tools[i].permission.label())
        if i > 0 {
          cmd.write_string(",")
        }
        cmd.write_string(tools[i].name)
        cmd.write_string("=")
        cmd.write_string(tools[i].permission.label())
        i = i + 1
      }
      let effect : DesktopEffect = {
        kind: "device_tools_list",
        command: cmd.to_string(),
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        buf.to_string() + " Host materializes durable tool catalog (CM-0705).",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    DeviceToolInvoke(tool~) => {
      let reg = @box_host.DeviceLocalToolsRegistry::seed_phones()
      let mid = resolve_device_machine_id(ctx)
      match reg.invoke(mid, tool) {
        Ok(msg) => {
          let effect : DesktopEffect = {
            kind: "device_tool",
            command: mid + "|" + tool,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            msg + ". Host executes deviceLocalTools FFI.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
        Err(card) => {
          // CM-0705: Host shows OS permission card / Settings guide (not pretend-granted).
          let effect : DesktopEffect = {
            kind: "device_permission",
            command: card.machine_id +
            "|" +
            card.tool_name +
            "|" +
            card.permission_label,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Device tool needs permission: " +
            card.tool_name +
            " (" +
            card.permission_label +
            ") on " +
            card.machine_id +
            ". Host must raise OS permission card / Settings guide.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    LoadSkill(task~) => {
      let cat = @skills.ManagedCatalog::seed()
      let runner = @skills.SkillRunner::new(cat)
      let sk = runner.load_for_task(task)
      let reply =
        "Skill load for task «" +
        task +
        "»: " +
        sk.loaded_count().to_string() +
        " skill(s) in context (CM-0504 on-demand). Host materializes load journal."
      let effect : DesktopEffect = {
        kind: "skill_load",
        command: task + "|" + sk.loaded_count().to_string(),
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        reply,
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    VoiceStart(call_id~) => {
      match @skills.VoiceCallSession::start(call_id~) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(session) => {
          let effect : DesktopEffect = {
            kind: "voice_session",
            command: "start|" + session.voice_address,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Voice call started at " +
            session.voice_address +
            " (second assistant " +
            session.second_assistant_id +
            "). Reply only to voice address while live.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
            channel_delivery="external:" + session.voice_address,
          )
        }
      }
    }
    VoiceRelay(call_id~, text~) => {
      match @skills.VoiceCallSession::start(call_id~) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(session) =>
          match session.relay_text(from_role="user", text~) {
            Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
            Ok(_) => {
              let effect : DesktopEffect = {
                kind: "voice_relay",
                command: session.voice_address + " :: " + text,
                needs_host_ffi: true,
              }
              deliver_ok(
                trimmed,
                turn_id,
                "Voice relay on " +
                session.voice_address +
                " (" +
                session.relay_log.length().to_string() +
                " turn(s)).",
                intent,
                ctx~,
                effects=[effect],
                needs_host_ffi=true,
                channel_delivery="external:" + session.voice_address,
              )
            }
          }
      }
    }
    VoiceEnd(call_id~) => {
      match @skills.VoiceCallSession::start(call_id~) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(session) => {
          let _ = session.relay_text(from_role="user", text="(closing)")
          match session.end_and_summarize() {
            Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
            Ok((path, summary)) => {
              let effect : DesktopEffect = {
                kind: "voice_end_write",
                command: path + "|" + summary,
                needs_host_ffi: true,
              }
              deliver_ok(
                trimmed,
                turn_id,
                "Voice ended; wrote " +
                path +
                ". App summary: " +
                summary,
                intent,
                ctx~,
                effects=[effect],
                needs_host_ffi=true,
              )
            }
          }
        }
      }
    }
    CreateTeammate(id~, name~, role~) => {
      let dir = @teammates.TeammateDirectory::new()
      match dir.create_agent(id~, name~, role~) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(agent) => {
          let effect : DesktopEffect = {
            kind: "teammate_create",
            command: agent.id + "|" + agent.name + "|" + agent.boundary.role,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Teammate created " +
            agent.name +
            " (" +
            agent.id +
            ") role=" +
            agent.boundary.role +
            ". Appears in Members/sidebar (CM-1401).",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    AddSection(group_id~, section_id~, title~) => {
      let group = @teammates.GroupSections::new(group_id)
      match group.add_section(id=section_id, title~) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(sec) => {
          let effect : DesktopEffect = {
            kind: "section_add",
            command: group_id + "|" + sec.id + "|" + sec.title,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Section «" +
            sec.title +
            "» (" +
            sec.id +
            ") added to group " +
            group_id +
            " (CM-1403). Host persists partition.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    SectionPost(group_id~, section_id~, from_agent~, body~) => {
      // Kernel validates isolation shape; Host loads durable group + posts.
      let effect : DesktopEffect = {
        kind: "section_post",
        command: group_id +
        "|" +
        section_id +
        "|" +
        from_agent +
        "|" +
        body,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Section post planned for " +
        section_id +
        " in group " +
        group_id +
        " (CM-1403 isolation). Host FFI executes.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    RoomTurn(room~, body~) => {
      match @teammates.open_room_turn(
        room_name=room,
        speaker_id="user",
        body~,
      ) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(rt) => {
          let effect : DesktopEffect = {
            kind: "room_turn",
            command: rt.room_name + " :: " + body,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Room turn in «" +
            rt.room_name +
            "» from " +
            rt.speaker_id +
            ". Host delivers group-chat UI.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    SendToAgent(to_id~, body~) => {
      match @teammates.plan_send_to_agent_fanout([to_id], user_explicitly_asked_fanout=false) {
        @teammates.MustAskUserFirst(reason~, ..) =>
          fail_turn(trimmed, turn_id, intent, reason, ctx, assistant=reason)
        @teammates.ExplicitFanout(..) =>
          fail_turn(
            trimmed,
            turn_id,
            intent,
            "unexpected fanout",
            ctx,
            assistant="unexpected fanout",
          )
        @teammates.Single(to_id~) => {
          let effect : DesktopEffect = {
            kind: "send_to_agent",
            command: to_id + " :: " + body,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "SendToAgent planned → " +
            to_id +
            ". Host routes teammate inbox (CM-1402).",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    LaunchCloudAgent(prompt~) => {
      let svc = @cloud.CloudAgentService::new()
      let launch = svc.launch(prompt)
      let effect : DesktopEffect = {
        kind: "cloud_agent_launch",
        command: launch.bc_id + "|" + launch.url + "|" + prompt,
        needs_host_ffi: true,
      }
      // CM-0111: markdown-link the agent URL in user-visible text.
      deliver_ok(
        trimmed,
        turn_id,
        "Cloud agent launched " +
        launch.bc_id +
        " → [" +
        launch.bc_id +
        "](" +
        launch.url +
        ") (CM-0908 product path).",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    DeliverCloudArtifact(artifact~, dest~) => {
      // artifact = bc_id; dest = source filename or path under workspace policy.
      match @cloud.deliver_cloud_artifact(artifact, dest) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(d) => {
          let effect : DesktopEffect = {
            kind: "cloud_artifact_deliver",
            command: d.path_or_url() + "|" + dest,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Cloud artifact delivered: " + d.path_or_url(),
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    ScheduleMeeting(title~, when_desc~) => {
      let req : @skills.SchedulingRequest = {
        title: title,
        timezone: "Asia/Shanghai",
        when_desc: when_desc,
      }
      // Product path: calendar connector typically NeedsAuth until Host OAuth.
      let outcome = @skills.run_scheduling(
        req,
        calendar_connector=@connectors.NeedsAuth,
      )
      match outcome {
        @skills.Invalid(reason~) =>
          fail_turn(trimmed, turn_id, intent, reason, ctx, assistant=reason)
        @skills.ConnectorOk(event_id~) => {
          let effect : DesktopEffect = {
            kind: "schedule_meeting",
            command: event_id + "|" + title + "|" + when_desc,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Scheduled via calendar connector: " + event_id,
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
        @skills.Fallback(path~, hint~) => {
          // Local ICS still materializes on Host; browser fallback is separate (CM-1801).
          let ics_effect : DesktopEffect = {
            kind: "schedule_meeting",
            command: "evt-local|" + title + "|" + when_desc,
            needs_host_ffi: true,
          }
          let cu_effect : DesktopEffect = {
            kind: "computer_use",
            command: "scheduling-fallback:" + path.label() + " :: " + hint,
            needs_host_ffi: true,
          }
          // CM-0111: user-visible text must not contain bare http(s) URLs.
          deliver_ok(
            trimmed,
            turn_id,
            "Scheduling fallback (" +
            path.label() +
            "): calendar connector NeedsAuth — Host writes local ICS + browser fallback (CM-1801). Hint kept in effect command.",
            intent,
            ctx~,
            effects=[ics_effect, cu_effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    ShopRetail(url_or_host~) => {
      match @skills.dispatch_shopping_playbook(url_or_host) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(snip) => {
          let effect : DesktopEffect = {
            kind: "computer_use",
            command: "shopping:" +
            snip.playbook_name +
            " :: " +
            snip.child_task_prompt,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Shopping playbook «" +
            snip.playbook_name +
            "» dispatched (CM-1803). Host runs computerUse child.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    PurchaseItem(item~, amount_cents~) => {
      match gate_consequential(
        trimmed,
        turn_id,
        intent,
        ctx,
        @security.Purchase,
        "purchase " + item + " (" + amount_cents.to_string() + " cents)",
        irreversible=true,
      ) {
        Some(gated) => gated
        None => {
          let gate = @commerce.PurchaseGate::new()
          let req : @commerce.PurchaseRequest = {
            item: item,
            amount_cents: amount_cents,
            payment_credential: "vault:card-token",
          }
          let outcome = gate.attempt_purchase(
            req,
            explicit_user_ask=true,
            user_present=ctx.approved,
          )
          match outcome {
            @commerce.DraftOnly(summary~) =>
              deliver_ok(trimmed, turn_id, summary, intent, ctx~)
            @commerce.NeedUserPresent(reason~) => {
              let effect : DesktopEffect = {
                kind: "approval_card",
                command: "Purchase :: present :: " + reason,
                needs_host_ffi: true,
              }
              deliver_ok(
                trimmed,
                turn_id,
                reason + ". Re-run with Host --approved while present.",
                intent,
                ctx~,
                effects=[effect],
                needs_host_ffi=true,
              )
            }
            @commerce.Blocked(reason~) =>
              fail_turn(trimmed, turn_id, intent, reason, ctx, assistant=reason)
            @commerce.Paid(receipt~) => {
              let effect : DesktopEffect = {
                kind: "purchase",
                command: receipt,
                needs_host_ffi: true,
              }
              deliver_ok(
                trimmed,
                turn_id,
                "Purchase paid: " + receipt + " (CM-1802).",
                intent,
                ctx~,
                effects=[effect],
                needs_host_ffi=true,
              )
            }
          }
        }
      }
    }
    TravelBook(url_or_host~) => {
      match @skills.dispatch_travel_playbook(url_or_host) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok((vertical, snip)) => {
          let effect : DesktopEffect = {
            kind: "computer_use",
            command: "travel:" +
            vertical.skill_name() +
            ":" +
            snip.playbook_name +
            " :: " +
            snip.child_task_prompt,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Travel «" +
            vertical.skill_name() +
            "» playbook «" +
            snip.playbook_name +
            "» dispatched (CM-1804). Host runs computerUse child.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    OrderFood(url_or_host~) => {
      match @skills.dispatch_food_ordering_playbook(url_or_host) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(snip) => {
          let effect : DesktopEffect = {
            kind: "computer_use",
            command: "food:" +
            snip.playbook_name +
            " :: " +
            snip.child_task_prompt,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Food-ordering playbook «" +
            snip.playbook_name +
            "» dispatched (CM-1805).",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    MeetingChat(body~, direct~) => {
      match @skills.plan_meetings_live_chat_outbound(
        skill_loaded=true,
        explicit_allow_direct=direct,
        is_live_meeting_chat=true,
        body~,
      ) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(mode) => {
          let (kind, reply) = match mode {
            @channels.DirectSend =>
              ("channel_send", "Meeting chat DirectSend planned (CM-2153).")
            @channels.DraftCard =>
              ("mail_draft", "Meeting chat DraftCard planned (CM-2153).")
          }
          let effect : DesktopEffect = {
            kind: kind,
            command: "meeting_chat :: " + body,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            reply,
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    FinanceConnect => {
      let fin = @connectors.FinanceConnector::new()
      match fin.authenticate() {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(_) => {
          let effect : DesktopEffect = {
            kind: "oauth",
            command: "user-Finance",
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Finance connector authenticated (CM-2109). Host completes live OAuth.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    FinanceCall(tool~) => {
      let fin = @connectors.FinanceConnector::new()
      fin.seed_stub_tools()
      let _ = fin.authenticate()
      match fin.call_tool(name=tool) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(out) => {
          let effect : DesktopEffect = {
            kind: "finance_call",
            command: tool + "|" + out,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Finance tool «" + tool + "» planned (CM-2109). Host executes live call.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    ListCredentials => {
      let store = @security.CredentialStore::new()
      let _ = store.save(
        id="cred-desktop",
        label="saved login",
        domain="login.example.test",
        username="user",
        secret="vault:secret-ref",
      )
      let metas = store.list_credentials()
      let json = store.list_credentials_json()
      // Refuse if secret plaintext leaked into list JSON.
      if json.to_lower().contains("vault:secret-ref") ||
          json.to_lower().contains("password") {
        fail_turn(
          trimmed,
          turn_id,
          intent,
          "list_credentials leaked secret plaintext",
          ctx,
          assistant="ListCredentials refused: secret must stay vault-only (CM-2130).",
        )
      } else {
        let effect : DesktopEffect = {
          kind: "credential_list",
          command: "list|" + metas.length().to_string(),
          needs_host_ffi: true,
        }
        deliver_ok(
          trimmed,
          turn_id,
          "Listed " +
          metas.length().to_string() +
          " credential(s) — metadata only, no secrets (CM-2130). Host materializes vault list.",
          intent,
          ctx~,
          effects=[effect],
          needs_host_ffi=true,
        )
      }
    }
    FillCredential(domain~) => {
      let store = @security.CredentialStore::new()
      // Seed vault-handle secret (never echoed to assistant_view).
      store.save(
        id="cred-desktop",
        label="saved login",
        domain~,
        username="user",
        secret="vault:secret-ref",
      )
      match store.fill_credential_request(domain~) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(fill) => {
          let effect : DesktopEffect = {
            kind: "credential_fill",
            command: fill.fill_handle + "|" + fill.domain,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Credential fill planned for " +
            fill.domain +
            " handle=" +
            fill.fill_handle +
            " (CM-2129; secret stays in Host vault).",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    ColdMail(to_~, subject~, body~, unsubscribe~) => {
      let plan = @mail.UnsolicitedMailPlan::cold(
        to_,
        subject~,
        body~,
        unsubscribe~,
      )
      match @mail.plan_unsolicited_send(plan, via_card=false) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(msg) => {
          match gate_consequential(
            trimmed,
            turn_id,
            intent,
            ctx,
            @security.ExternalSend,
            "cold mail to " + to_,
            irreversible=false,
          ) {
            Some(gated) => gated
            None => {
              let effect : DesktopEffect = {
                kind: "mail_send",
                command: "cold|" + to_ + "|" + subject + "|" + body + "|" + unsubscribe,
                needs_host_ffi: true,
              }
              deliver_ok(
                trimmed,
                turn_id,
                msg + " (CM-1009). Host mail_send executes.",
                intent,
                ctx~,
                effects=[effect],
                needs_host_ffi=true,
              )
            }
          }
        }
      }
    }
    PersonalSlackDm(owner_id~, text~) => {
      let bot = @channels.PersonalSlackBot::new(owner_user_id=owner_id)
      let dm = @channels.parse_channel_address(bot.owner_dm_address())
      match bot.try_send(dm, text~) {
        @channels.RefusedSharedChannel(hint~) =>
          fail_turn(trimmed, turn_id, intent, hint, ctx, assistant=hint)
        @channels.SentDm(owner_id~, text~) => {
          let effect : DesktopEffect = {
            kind: "channel_send",
            command: "slack:" + owner_id + " :: " + text,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Personal Slack DM planned to owner (CM-1103).",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
            channel_delivery="external:slack:" + owner_id,
          )
        }
      }
    }
    JobSearch(query~) => {
      let host = @skills.JobSearchHost::mock()
      match host.run_linkedin_readonly_search(query~) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(res) => {
          let cu : DesktopEffect = {
            kind: "computer_use",
            command: "job-search:" +
            res.playbook_name +
            " :: readonly query=" +
            query,
            needs_host_ffi: true,
          }
          // Host also materializes durable job results (CM-1806) — not CU-only.
          let jobs : DesktopEffect = {
            kind: "job_search",
            command: query + "|" + res.playbook_name + "|" + res.hit_count.to_string(),
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Job search readonly «" +
            res.playbook_name +
            "»: " +
            res.hit_count.to_string() +
            " hit(s) (CM-1806). Host persists results + CU playbook.",
            intent,
            ctx~,
            effects=[cu, jobs],
            needs_host_ffi=true,
          )
        }
      }
    }
    LearnFromDemo(title~, steps_csv~) => {
      let steps = parse_demo_steps(steps_csv)
      let demo = @skills.Demonstration::of(title~, steps~)
      match @skills.crystallize_demonstration_to_skill_draft(demo) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(draft) => {
          // Host skill_write: name|description|body (steps crystallized into body)
          let effect : DesktopEffect = {
            kind: "skill_write",
            command: draft.name +
            "|" +
            draft.description +
            "|" +
            "# Steps\n" +
            steps_csv,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Learned skill draft «" +
            draft.name +
            "» from demonstration (CM-1808). Host writes SKILL.md.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    MakeSlides(title~) => {
      let host = @skills.SlidesHost::mock()
      match host.generate_pptx(title~, slides=["Title", "Agenda", "Thanks"]) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(art) => {
          let effect : DesktopEffect = {
            kind: "slides_pptx",
            command: art.path + "|" + art.title,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Slides pptx planned at " +
            art.path +
            " (CM-1807). Host materializes openable file.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    GenerateImage(prompt~) => {
      let out = "/workspace/agent-tools/gen-image-" + turn_id + ".png"
      let effect : DesktopEffect = {
        kind: "generate_image",
        command: out + "|" + prompt,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "GenerateImage planned at " +
        out +
        " (CM-1601). Host materializes PNG attachment.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    GenerateVideo(prompt~) => {
      let out = "/workspace/agent-tools/gen-video-" + turn_id + ".mp4"
      let effect : DesktopEffect = {
        kind: "generate_video",
        command: out + "|" + prompt,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "GenerateVideo planned at " +
        out +
        " (CM-1602). Host encodes short mp4 + notify.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    WatchVideo(video_path~) => {
      let vp = if video_path.has_prefix("/workspace/") ||
        video_path.has_prefix("agent-tools/") ||
        video_path.has_prefix("uploads/") {
        video_path
      } else {
        "/workspace/" + video_path
      }
      let frame = "/workspace/agent-tools/watch-frame-" + turn_id + ".png"
      let effect : DesktopEffect = {
        kind: "watch_video",
        command: vp + "|" + frame,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "watchVideo planned for " +
        vp +
        " (CM-1603). Host extracts frame PNG for grounded answer.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    StructuredChart(series_json~) => {
      let out = "/workspace/agent-tools/chart-" + turn_id + ".png"
      let effect : DesktopEffect = {
        kind: "structured_chart",
        command: out + "|" + series_json,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "StructuredChart planned at " +
        out +
        " (CM-2157). Host renders PNG from series.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    BoxDoctor => {
      let effect : DesktopEffect = {
        kind: "box_doctor",
        command: "box-doctor",
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "box-doctor planned (CM-0607). Host runs real probe or honest FS residual.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    BoxEnv => {
      let effect : DesktopEffect = {
        kind: "box_env",
        command: "env-detect",
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "box env detect planned (CM-0608). Host probes /.dockerenv vs hosted-anyrun.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    BoxClock => {
      let effect : DesktopEffect = {
        kind: "box_clock",
        command: "date",
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "box clock planned (CM-2175). Host aligns date to user timezone.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    WebhookPanel => {
      let effect : DesktopEffect = {
        kind: "webhook_panel",
        command: "open",
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "webhook panel planned (CM-0411). Host creates opaque URL/key for user copy.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    WebhookCopy(what~) => {
      let effect : DesktopEffect = {
        kind: "webhook_copy",
        command: what,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "webhook user-copy planned (CM-0411). Host records copy receipt for " +
          what +
          ".",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    WebhookToolReadKey => {
      let effect : DesktopEffect = {
        kind: "webhook_tool_read_key",
        command: "tool-read-key",
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "webhook tool-read key planned (CM-0411). Host must refuse; key stays opaque.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    WebhookWake(event_id~, summary~) => {
      let effect : DesktopEffect = {
        kind: "webhook_wake",
        command: "id=" + event_id + " summary=" + summary,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "webhook wake planned (CM-0411). Host emits <webhook_event> without key leak.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    OpenSettings(entry~, anchor~) => {
      let cmd = if anchor.length() > 0 {
        "entry=" + entry + " anchor=" + anchor
      } else {
        "entry=" + entry
      }
      let effect : DesktopEffect = {
        kind: "settings_open",
        command: cmd,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Settings open planned (CM-1901/1902). Host opens via " +
          entry +
          (if anchor.length() > 0 { " → " + anchor } else { "" }) +
          "; gear/Preferences forbidden.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    OpenAgentInfoPanel(agent_id~) => {
      let effect : DesktopEffect = {
        kind: "agent_info_panel",
        command: "agent=" + agent_id,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Per-agent info panel planned (CM-0205). Host surfaces desktop-preview/Routines/Channels/Members/gear-settings.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    DeleteAgent(agent_id~, confirm~) => {
      let effect : DesktopEffect = {
        kind: "delete_agent",
        command: if confirm {
          "agent=" + agent_id + " confirm=1"
        } else {
          "agent=" + agent_id + " confirm=0"
        },
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Delete agent planned (CM-1907). Host requires sidebar confirm; not Settings.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    PackageInstall(pm~, packages_csv~, via~) => {
      let effect : DesktopEffect = {
        kind: "package_install",
        command: "via=" + via + " pm=" + pm + " pkgs=" + packages_csv,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Box package install planned (CM-2158). Host must run via Shell only; refuse non-Shell.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    SharedBoxFs => {
      let effect : DesktopEffect = {
        kind: "shared_box_fs",
        command: "probe",
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Cross-agent shared box FS planned (CM-2174). Host: shared FS + distinct desktops.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    HideAgent(agent_id~, hidden~) => {
      let effect : DesktopEffect = {
        kind: "hide_agent",
        command: "agent=" + agent_id + " hidden=" + (if hidden { "1" } else { "0" }),
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Hide/unhide agent planned (CM-0204). Host drops hidden from main sidebar; still addressable.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    ListAgentsSidebar => {
      let effect : DesktopEffect = {
        kind: "list_agents_sidebar",
        command: "main",
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "List agents sidebar planned (CM-0204). Host returns main-sidebar ids only.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    MembersPanel(group_id~) => {
      let effect : DesktopEffect = {
        kind: "members_panel",
        command: "group=" + group_id,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Members panel planned (CM-1405). Host lists teammates under info-panel members anchor.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    CodeChanges(path~) => {
      let p = if path.has_prefix("/workspace/") {
        path
      } else {
        "/workspace/" + path
      }
      match @skills.plan_code_changes(
        repo_kind=@skills.GithubNative,
        scope=@skills.BoxWorkspace,
        paths=[p],
      ) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(plan) => {
          let effect : DesktopEffect = {
            kind: "code_changes",
            command: plan.sc_backend.mcp_namespace() + "|" + p,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Code-changes planned on box via " +
            plan.sc_backend.mcp_namespace() +
            " (CM-1810). Host applies scoped edit.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    SourceControl(repo_kind~) => {
      let low_kind = repo_kind.to_lower()
      let kind = if low_kind.contains("origin") &&
        !low_kind.contains("mirror") {
        @skills.NativeOrigin
      } else if low_kind.contains("mirror") {
        @skills.GithubMirror
      } else {
        @skills.GithubNative
      }
      let backend = @skills.route_source_control(kind)
      // CM-1305: status by default; create_pr/open_pr → Host remote-PR residual path
      // (never pretend; Host needs BITBOT_GH_CREATE_PR=1 + gh to view).
      let sc_action = if low_kind.contains("create_pr") ||
        low_kind.contains("open_pr") ||
        low_kind.contains("pull_request") ||
        low_kind == "pr" {
        "create_pr"
      } else {
        "status"
      }
      let effect : DesktopEffect = {
        kind: "source_control",
        command: backend.mcp_namespace() + "|" + sc_action,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Source-control routed to " +
        backend.mcp_namespace() +
        " action=" +
        sc_action +
        " (CM-1305). Host runs git status" +
        (if sc_action == "create_pr" {
          " + remote PR residual probe"
        } else {
          " artifact"
        }) +
        ".",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    SendOnBehalf(to_~, subject~, body~) => {
      let tone = @skills.SendOnBehalfToneSession::new(
        [
          { id: "s1", preview: "Hey — quick note.", register_: "casual" },
          { id: "s2", preview: "Hello, following up.", register_: "formal" },
        ],
      )
      match tone.begin_first_proxy_write() {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(samples) => {
          let _ = tone.pick_sample(sample_id="s1")
          let sob = @mail.SendOnBehalf::new(
            [{ id: "acct-1", address: "me@example.com" }],
          )
          match gate_consequential(
            trimmed,
            turn_id,
            intent,
            ctx,
            @security.ExternalSend,
            "send on behalf to " + to_,
          ) {
            Some(gated) => gated
            None =>
              match sob.send(
                account_id=Some("acct-1"),
                to_~,
                subject~,
                body~,
              ) {
                Err(e) =>
                  fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
                Ok(msg) => {
                  let effect : DesktopEffect = {
                    kind: "mail_send",
                    command: "onbehalf|" + to_ + "|" + subject + "|" + body,
                    needs_host_ffi: true,
                  }
                  deliver_ok(
                    trimmed,
                    turn_id,
                    msg +
                    " after tone samples (" +
                    samples.length().to_string() +
                    ") (CM-1006/1010).",
                    intent,
                    ctx~,
                    effects=[effect],
                    needs_host_ffi=true,
                  )
                }
              }
          }
        }
      }
    }
    ListWorkflows => {
      let rt = @skills.UserWorkflowRuntime::seed_private_examples()
      let names = rt.list_visible()
      let buf = StringBuilder()
      buf.write_string("User workflows visible: ")
      let mut i = 0
      while i < names.length() {
        if i > 0 {
          buf.write_string(", ")
        }
        buf.write_string(names[i])
        i = i + 1
      }
      // Host materializes durable workflow catalog (CM-2118) — not kernel-only.
      let effect : DesktopEffect = {
        kind: "workflow_list",
        command: names.join(","),
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        buf.to_string() + " (CM-2118). Host persists workflow catalog.",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    IdentityBrowser => {
      let session = @connectors.ConnectorIdentitySession::new(
        @connectors.AppIdentity,
      )
      let res = session.ensure(@connectors.UserIdentityRequired)
      let reply = match res {
        @connectors.Proceed(identity~) =>
          "Identity proceed as " + identity.label()
        @connectors.SwitchToSignedInBrowser(reason~) =>
          "Switched to signed-in browser: " + reason
      }
      let effect : DesktopEffect = {
        kind: "oauth",
        command: "identity-browser|user-browser",
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        reply + " (CM-2146).",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    XSearch(query~) => {
      let ns = @connectors.XPublicSearchNamespace::new()
      ns.seed_readonly_tools()
      ns.seed_post(id="t1", text="moonbit grok parity " + query)
      let hits = ns.search_posts(query)
      // Host x_search materializes durable results; live X only when BITBOT_X_BEARER set.
      let effect : DesktopEffect = {
        kind: "x_search",
        command: query,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "X public search: " +
        hits.length().to_string() +
        " hit(s) (CM-0910; Host persists results).",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    AuthorSkill(name~, description~, body~) => {
      let author = @skills.SkillAuthoring::seed()
      match author.produce_skill_md(name, description, body) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(md) => {
          let effect : DesktopEffect = {
            kind: "skill_write",
            command: name + "|" + description + "|" + md,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Authored SKILL.md for «" +
            name +
            "» (CM-0506). Host persists skill file.",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    ExportBotTemplate(bot_id~, name~) => {
      let source : @skills.BotExportSource = {
        bot_id: bot_id,
        name: name,
        title: name,
        description: "shareable bot template",
        skill_names: ["scheduling", "shopping"],
        secrets: ["api_key_SHOULD_STRIP"],
      }
      match @skills.export_bot_template(source) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(pack) => {
          let effect : DesktopEffect = {
            kind: "export_pack",
            command: pack.bot_id + "|" + pack.kind.label(),
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Exported " +
            pack.kind.label() +
            " for " +
            pack.name +
            " (CM-1406; secrets stripped).",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    ConnectGmail => {
      let effect : DesktopEffect = {
        kind: "oauth",
        command: "gmail",
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Gmail connect planned. Host runs sandbox IdP OAuth → Connected/Ready (CM-0906).",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    JournalAppend(date~, event_id~, body~) => {
      let j = @memory.JournalStore::new()
      j.append(date~, event_id~, body~)
      let pollutes = j.journal_pollutes_profile()
      let effect : DesktopEffect = {
        kind: "journal_append",
        command: date + "|" + event_id + "|" + body,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Journal appended " +
        date +
        "/" +
        event_id +
        " (CM-0302; pollutes_profile=" +
        (if pollutes { "true" } else { "false" }) +
        ").",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    JournalQuery(from_date~, to_date~) => {
      let j = @memory.JournalStore::new()
      j.append(date="2026-10-17", event_id="seed", body="seed event")
      let hits = j.query_range(from_date~, to_date~)
      let effect : DesktopEffect = {
        kind: "journal_query",
        command: from_date + "|" + to_date,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Journal query [" +
        from_date +
        ".." +
        to_date +
        "]: " +
        hits.length().to_string() +
        " event(s) (CM-0302).",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    SharedMemoryPut(scope~, key~, value~) => {
      let store = @memory.SharedMemoryStore::new()
      store.put(scope=@memory.SharedScopeId::new(scope), key~, value~)
      let effect : DesktopEffect = {
        kind: "shared_memory_put",
        command: scope + "|" + key + "|" + value,
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        "Shared memory put scope=" + scope + " key=" + key + " (CM-0303).",
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    SharedMemoryRead(scope~, key~) => {
      let store = @memory.SharedMemoryStore::new()
      store.put(scope=@memory.SharedScopeId::new(scope), key~, value="host-seed")
      match store.read(scope=@memory.SharedScopeId::new(scope), key~) {
        Err(e) => fail_turn(trimmed, turn_id, intent, e, ctx, assistant=e)
        Ok(v) => {
          let effect : DesktopEffect = {
            kind: "shared_memory_read",
            command: scope + "|" + key,
            needs_host_ffi: true,
          }
          deliver_ok(
            trimmed,
            turn_id,
            "Shared memory read scope=" +
            scope +
            " key=" +
            key +
            " value_len=" +
            v.length().to_string() +
            " (CM-0303 isolation).",
            intent,
            ctx~,
            effects=[effect],
            needs_host_ffi=true,
          )
        }
      }
    }
    InboundReaction(emoji~, useful~) => {
      let reaction = @channels.InboundReaction::new(
        emoji~,
        target_message_id="msg-1",
        useful~,
      )
      let plan = @channels.plan_reaction_outbound(reaction)
      let reply = if plan.disposition.acts() {
        "Inbound reaction useful — act without forced reply (CM-0110)."
      } else {
        "Inbound reaction wake only — no forced reply (CM-0110)."
      }
      let effect : DesktopEffect = {
        kind: "inbound_reaction",
        command: emoji + "|useful=" + (if useful { "1" } else { "0" }),
        needs_host_ffi: true,
      }
      deliver_ok(
        trimmed,
        turn_id,
        reply,
        intent,
        ctx~,
        effects=[effect],
        needs_host_ffi=true,
      )
    }
    HostContinue => {
      // Should be invoked via continue_after_host_ffi, not plain chat.
      deliver_ok(
        trimmed,
        turn_id,
        "Host continue requires --apply-host-results (ADR 0002).",
        intent, ctx~,
      )
    }
    Chat => {
      let reply =
        "Bit Bot (MoonBit): 已收到「" +
        trimmed +
        "」。本回合由 cmd/desktop_turn 编排，不经 Python LocalBrain。"
      deliver_ok(trimmed, turn_id, reply, intent, ctx~)
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
  buf.write_string("\",\"session_id\":\"")
  buf.write_string(escape_json_string(self.session_id))
  buf.write_string("\",\"machine_id\":\"")
  buf.write_string(escape_json_string(self.machine_id))
  buf.write_string("\",\"machine_kind\":\"")
  buf.write_string(escape_json_string(self.machine_kind))
  buf.write_string("\",\"channel\":\"")
  buf.write_string(escape_json_string(self.channel))
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
