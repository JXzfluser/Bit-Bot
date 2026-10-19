///|
/// Parse decimal digits into a non-negative Int32 (cents / amounts).
fn parse_nonneg_i32(s : String) -> Int32 {
  let mut n : Int32 = 0
  let mut i = 0
  while i < s.length() {
    let c = s[i]
    if c >= '0' && c <= '9' {
      let digit : Int32 = match c {
        '0' => 0
        '1' => 1
        '2' => 2
        '3' => 3
        '4' => 4
        '5' => 5
        '6' => 6
        '7' => 7
        '8' => 8
        '9' => 9
        _ => 0
      }
      n = n * 10 + digit
    }
    i = i + 1
  }
  n
}

///|
/// Extra Grok-parity intent classification (routines/agents/MCP/Teams/device).
pub fn classify_parity_intent(trimmed : String, low : String) -> TurnIntent? {
  if low == "list routines" ||
    low == "routines" ||
    low == "show routines" ||
    low == "list scheduled" ||
    low == "list reminders" {
    return Some(ListRoutines)
  }
  if low.has_prefix("pause routine ") ||
    low.has_prefix("cancel scheduled ") ||
    low.has_prefix("cancel reminder ") ||
    low.has_prefix("pause reminder ") {
    let id = if low.has_prefix("pause routine ") {
      trimmed[14:].trim().to_owned()
    } else if low.has_prefix("cancel scheduled ") {
      trimmed[17:].trim().to_owned()
    } else if low.has_prefix("pause reminder ") {
      trimmed[15:].trim().to_owned()
    } else {
      trimmed[16:].trim().to_owned()
    }
    if id != "" {
      return Some(PauseRoutine(id~))
    }
  }
  if low == "cancel scheduled" ||
    low == "cancel reminder" ||
    low == "cancel scheduled message" {
    return Some(PauseRoutine(id="routine-1"))
  }
  if low == "schedule send" || low.has_prefix("schedule send ") {
    let prompt = if low.has_prefix("schedule send ") {
      trimmed[14:].trim().to_owned()
    } else {
      "scheduled send"
    }
    let p = if prompt != "" { prompt } else { "scheduled send" }
    return Some(
      CreateRoutine(id="sched-send-1", cron="0 9 * * *", prompt=p),
    )
  }
  if low.has_prefix("resume routine ") {
    let id = trimmed[15:].trim().to_owned()
    if id != "" {
      return Some(ResumeRoutine(id~))
    }
  }
  if low == "tick routines" ||
    low == "wake routines" ||
    low == "routine tick" ||
    low == "routines wake" {
    return Some(TickRoutines)
  }
  if low.has_prefix("fire routine ") || low.has_prefix("run routine ") {
    let id = if low.has_prefix("fire routine ") {
      trimmed[13:].trim().to_owned()
    } else {
      trimmed[12:].trim().to_owned()
    }
    if id != "" {
      return Some(FireRoutine(id~))
    }
  }
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
      return Some(SearchMail(query~))
    }
  }
  if low.has_prefix("read mail ") ||
    low.has_prefix("read thread ") ||
    low.has_prefix("open mail ") ||
    low.has_prefix("archive mail ") ||
    low.has_prefix("trash mail ") {
    let thread_id = if low.has_prefix("read mail ") {
      trimmed[10:].trim().to_owned()
    } else if low.has_prefix("read thread ") {
      trimmed[12:].trim().to_owned()
    } else if low.has_prefix("archive mail ") {
      trimmed[13:].trim().to_owned()
    } else if low.has_prefix("trash mail ") {
      trimmed[11:].trim().to_owned()
    } else {
      trimmed[10:].trim().to_owned()
    }
    if thread_id != "" {
      return Some(ReadMailThread(thread_id~))
    }
  }
  // CM-1801 scheduling skill (before routine `schedule routine`).
  if low == "list calendar" ||
    low == "calendar list" ||
    low == "show calendar" {
    return Some(
      ScheduleMeeting(title="CalendarList", when_desc="list"),
    )
  }
  if low.has_prefix("delete calendar ") || low.has_prefix("cancel calendar ") {
    let id = if low.has_prefix("delete calendar ") {
      trimmed[16:].trim().to_owned()
    } else {
      trimmed[16:].trim().to_owned()
    }
    let title = if id != "" { "Delete:" + id } else { "DeleteCalendar" }
    return Some(ScheduleMeeting(title~, when_desc="delete"))
  }
  if low.has_prefix("schedule meeting ") ||
    low.has_prefix("calendar event ") ||
    low.has_prefix("schedule event ") ||
    low.has_prefix("add calendar event ") {
    let rest = if low.has_prefix("schedule meeting ") {
      trimmed[17:].to_owned()
    } else if low.has_prefix("calendar event ") {
      trimmed[15:].to_owned()
    } else if low.has_prefix("add calendar event ") {
      trimmed[19:].to_owned()
    } else {
      trimmed[15:].to_owned()
    }
    let title = match extract_kv(rest, "title") {
      Some(v) => v
      None => rest.trim().to_owned()
    }
    let when_desc = match extract_kv(rest, "when") {
      Some(v) => v
      None => "unspecified"
    }
    if title != "" {
      return Some(ScheduleMeeting(title~, when_desc~))
    }
  }
  if low.has_prefix("launch cloud agent ") ||
    low.has_prefix("cloud agent ") ||
    low.has_prefix("launch cloud ") {
    let prompt = if low.has_prefix("launch cloud agent ") {
      trimmed[19:].trim().to_owned()
    } else if low.has_prefix("cloud agent ") {
      trimmed[12:].trim().to_owned()
    } else {
      trimmed[13:].trim().to_owned()
    }
    if prompt != "" {
      return Some(LaunchCloudAgent(prompt~))
    }
  }
  if low.has_prefix("deliver cloud artifact ") ||
    low.has_prefix("deliver artifact ") {
    let rest = if low.has_prefix("deliver cloud artifact ") {
      trimmed[23:].to_owned()
    } else {
      trimmed[17:].to_owned()
    }
    let artifact = match extract_kv(rest, "artifact") {
      Some(v) => v
      None =>
        match split_once(rest.trim().to_owned(), " ") {
          Some((a, _)) => a
          None => rest.trim().to_owned()
        }
    }
    let dest = match extract_kv(rest, "dest") {
      Some(v) => v
      None => "workspace"
    }
    if artifact != "" {
      return Some(DeliverCloudArtifact(artifact~, dest~))
    }
  }
  if low.has_prefix("shop ") ||
    low.has_prefix("shopping ") ||
    (
      low.has_prefix("buy ") &&
      (
        low.contains("target.com") ||
        low.contains("bestbuy") ||
        low.contains("costco") ||
        low.contains("ebay") ||
        low.contains("etsy") ||
        low.contains("instacart") ||
        low.contains("facebook")
      )
    ) {
    let host = if low.has_prefix("shop ") {
      trimmed[5:].trim().to_owned()
    } else if low.has_prefix("shopping ") {
      trimmed[9:].trim().to_owned()
    } else {
      trimmed[4:].trim().to_owned()
    }
    if host != "" {
      return Some(ShopRetail(url_or_host=host))
    }
  }
  if low.has_prefix("purchase ") || low.has_prefix("buy confirm ") {
    let rest = if low.has_prefix("purchase ") {
      trimmed[9:].to_owned()
    } else {
      trimmed[12:].to_owned()
    }
    let item = match extract_kv(rest, "item") {
      Some(v) => v
      None => rest.trim().to_owned()
    }
    let amount_cents = match extract_kv(rest, "cents") {
      Some(v) => parse_nonneg_i32(v)
      None => 0
    }
    if item != "" {
      return Some(PurchaseItem(item~, amount_cents~))
    }
  }
  // CM-1804 travel vertical
  if low.has_prefix("book flight ") ||
    low.has_prefix("book hotel ") ||
    low.has_prefix("rideshare ") ||
    low.has_prefix("travel ") {
    let host = if low.has_prefix("book flight ") {
      trimmed[12:].trim().to_owned()
    } else if low.has_prefix("book hotel ") {
      trimmed[11:].trim().to_owned()
    } else if low.has_prefix("rideshare ") {
      trimmed[10:].trim().to_owned()
    } else {
      trimmed[7:].trim().to_owned()
    }
    if host != "" {
      return Some(TravelBook(url_or_host=host))
    }
  }
  // CM-1805 food ordering
  if low.has_prefix("order food ") ||
    low.has_prefix("reserve table ") ||
    low.has_prefix("food order ") {
    let host = if low.has_prefix("order food ") {
      trimmed[11:].trim().to_owned()
    } else if low.has_prefix("reserve table ") {
      trimmed[14:].trim().to_owned()
    } else {
      trimmed[11:].trim().to_owned()
    }
    if host != "" {
      return Some(OrderFood(url_or_host=host))
    }
  }
  // CM-2153 meetings live chat
  if low.has_prefix("meeting chat ") || low.has_prefix("live meeting send ") {
    let rest = if low.has_prefix("meeting chat ") {
      trimmed[13:].to_owned()
    } else {
      trimmed[18:].to_owned()
    }
    let direct = low.contains(" direct") || rest.to_lower().contains("direct=1")
    let body = match extract_kv(rest, "body") {
      Some(v) => v
      None =>
        match extract_kv(rest, "direct") {
          Some(_) =>
            // body after dropping direct= flag via split
            match split_once(rest.trim().to_owned(), " ") {
              Some((_, t)) => t.trim().to_owned()
              None => rest.trim().to_owned()
            }
          None => rest.trim().to_owned()
        }
    }
    if body != "" && body.to_lower() != "direct=1" {
      return Some(MeetingChat(body~, direct~))
    }
  }
  if low == "connect finance" ||
    low == "finance connect" ||
    low == "authenticate finance" {
    return Some(FinanceConnect)
  }
  if low.has_prefix("finance ") || low.has_prefix("finance call ") {
    let tool = if low.has_prefix("finance call ") {
      trimmed[13:].trim().to_owned()
    } else {
      trimmed[8:].trim().to_owned()
    }
    if tool != "" && tool != "connect" {
      return Some(FinanceCall(tool~))
    }
  }
  if low == "list credentials" ||
    low == "list logins" ||
    low == "show credentials" ||
    low == "vault list" ||
    low == "open vault" ||
    low == "list secrets" ||
    low == "list vault" {
    return Some(ListCredentials)
  }
  if low == "fill credential" || low == "autofill login" {
    return Some(FillCredential(domain="login.example.test"))
  }
  if low.has_prefix("fill credential ") ||
    low.has_prefix("autofill login ") ||
    low.has_prefix("get credential ") ||
    low.has_prefix("store credential ") {
    let rest = if low.has_prefix("fill credential ") {
      trimmed[16:].to_owned()
    } else if low.has_prefix("autofill login ") {
      trimmed[15:].to_owned()
    } else if low.has_prefix("get credential ") {
      trimmed[15:].to_owned()
    } else {
      trimmed[17:].to_owned()
    }
    let domain = match extract_kv(rest, "domain") {
      Some(v) => v
      None =>
        match extract_kv(rest, "name") {
          Some(v) => v
          None => rest.trim().to_owned()
        }
    }
    if domain != "" {
      return Some(FillCredential(domain~))
    }
  }
  if low.has_prefix("cold email ") ||
    low.has_prefix("cold mail ") ||
    low.has_prefix("unsolicited mail ") {
    let rest = if low.has_prefix("cold email ") {
      trimmed[11:].to_owned()
    } else if low.has_prefix("cold mail ") {
      trimmed[10:].to_owned()
    } else {
      trimmed[17:].to_owned()
    }
    let to_ = match extract_kv(rest, "to") {
      Some(v) => v
      None => ""
    }
    let subject = match extract_kv(rest, "subject") {
      Some(v) => v
      None => "hello"
    }
    let body = match extract_kv(rest, "body") {
      Some(v) => v
      None => "outreach"
    }
    let unsubscribe = match extract_kv(rest, "unsubscribe") {
      Some(v) => v
      None => "mailto:unsub@example.com"
    }
    if to_ != "" {
      return Some(ColdMail(to_~, subject~, body~, unsubscribe~))
    }
  }
  if low.has_prefix("personal slack dm ") || low.has_prefix("personal slack ") {
    let rest = if low.has_prefix("personal slack dm ") {
      trimmed[18:].to_owned()
    } else {
      trimmed[15:].to_owned()
    }
    let owner_id = match extract_kv(rest, "owner") {
      Some(v) => v
      None => "Uowner"
    }
    let text = match extract_kv(rest, "text") {
      Some(v) => v
      None =>
        match split_once(rest.trim().to_owned(), " :: ") {
          Some((_, t)) => t.trim().to_owned()
          None => rest.trim().to_owned()
        }
    }
    if text != "" {
      return Some(PersonalSlackDm(owner_id~, text~))
    }
  }
  if low.has_prefix("job search ") ||
    low.has_prefix("linkedin search ") ||
    low.has_prefix("find jobs ") {
    let query = if low.has_prefix("job search ") {
      trimmed[11:].trim().to_owned()
    } else if low.has_prefix("linkedin search ") {
      trimmed[16:].trim().to_owned()
    } else {
      trimmed[10:].trim().to_owned()
    }
    if query != "" {
      return Some(JobSearch(query~))
    }
  }
  if low.has_prefix("learn from demo ") ||
    low.has_prefix("learn from demonstration ") {
    let rest = if low.has_prefix("learn from demo ") {
      trimmed[16:].to_owned()
    } else {
      trimmed[26:].to_owned()
    }
    let title = match extract_kv(rest, "title") {
      Some(v) => v
      None => "demo"
    }
    let steps_csv = match extract_kv(rest, "steps") {
      Some(v) => v
      None => "click:Start"
    }
    return Some(LearnFromDemo(title~, steps_csv~))
  }
  if low == "create canvas page" ||
    low == "publish page" ||
    low == "create canvas" ||
    low == "open canvas" ||
    low == "close canvas" ||
    low == "export canvas" ||
    low.has_prefix("create canvas page ") ||
    low.has_prefix("publish page ") ||
    low.has_prefix("open canvas ") ||
    low.has_prefix("export canvas ") {
    let mut title = if low.has_prefix("create canvas page ") {
      trimmed[19:].trim().to_owned()
    } else if low.has_prefix("publish page ") {
      trimmed[13:].trim().to_owned()
    } else if low.has_prefix("open canvas ") {
      trimmed[12:].trim().to_owned()
    } else if low.has_prefix("export canvas ") {
      trimmed[14:].trim().to_owned()
    } else if low == "close canvas" {
      "CloseCanvas"
    } else if low == "export canvas" {
      "ExportCanvas"
    } else if low == "open canvas" {
      "OpenCanvas"
    } else {
      "Canvas"
    }
    if title == "" {
      title = "Canvas"
    }
    return Some(MakeSlides(title~))
  }
  if low.has_prefix("make slides ") ||
    low.has_prefix("generate pptx ") ||
    low.has_prefix("generate slides ") {
    let title = if low.has_prefix("make slides ") {
      trimmed[12:].trim().to_owned()
    } else if low.has_prefix("generate pptx ") {
      trimmed[14:].trim().to_owned()
    } else {
      trimmed[16:].trim().to_owned()
    }
    if title != "" {
      return Some(MakeSlides(title~))
    }
  }
  // CM-1601 / 1602 / 1603 product Host media (not H5 matrix-only).
  if low.has_prefix("generate image ") ||
    low.has_prefix("make image ") ||
    low.has_prefix("draw image ") {
    let prompt = if low.has_prefix("generate image ") {
      trimmed[15:].trim().to_owned()
    } else if low.has_prefix("make image ") {
      trimmed[11:].trim().to_owned()
    } else {
      trimmed[11:].trim().to_owned()
    }
    if prompt != "" {
      return Some(GenerateImage(prompt~))
    }
  }
  if low.has_prefix("generate video ") ||
    low.has_prefix("make video ") ||
    low.has_prefix("render video ") {
    let prompt = if low.has_prefix("generate video ") {
      trimmed[15:].trim().to_owned()
    } else if low.has_prefix("make video ") {
      trimmed[11:].trim().to_owned()
    } else {
      trimmed[13:].trim().to_owned()
    }
    if prompt != "" {
      return Some(GenerateVideo(prompt~))
    }
  }
  if low == "watch video" {
    return Some(WatchVideo(video_path="agent-tools/gen-video-desktop-1.mp4"))
  }
  if low.has_prefix("watch video ") ||
    low.has_prefix("analyze video ") ||
    low.has_prefix("understand video ") {
    let video_path = if low.has_prefix("watch video ") {
      trimmed[12:].trim().to_owned()
    } else if low.has_prefix("analyze video ") {
      trimmed[14:].trim().to_owned()
    } else {
      trimmed[17:].trim().to_owned()
    }
    if video_path != "" {
      return Some(WatchVideo(video_path~))
    }
  }
  // CM-0607 product Host box-doctor self-check.
  if low == "box doctor" ||
    low == "run box doctor" ||
    low == "check box" ||
    low == "box-doctor" ||
    low == "doctor box" ||
    low == "ping host" ||
    low == "health check" ||
    low == "host health" ||
    low == "report bug" ||
    low == "bug report" {
    return Some(BoxDoctor)
  }
  // CM-0608 product Host Docker vs anyrun env detect.
  if low == "box env" ||
    low == "detect box env" ||
    low == "box runtime" ||
    low == "detect runtime" ||
    low == "dockerenv" {
    return Some(BoxEnv)
  }
  // CM-2175 product Host box clock align to user timezone.
  if low == "box clock" ||
    low == "check box clock" ||
    low == "align clock" ||
    low == "box time" ||
    low.has_prefix("box clock ") {
    return Some(BoxClock)
  }
  // CM-0411 product Host webhook panel (opaque key; user copy; wake tag).
  if low == "open webhook" ||
    low == "webhook panel" ||
    low == "show webhook" ||
    low == "open webhook panel" {
    return Some(WebhookPanel)
  }
  if low == "copy webhook url" || low == "webhook copy url" {
    return Some(WebhookCopy(what="url"))
  }
  if low == "copy webhook key" || low == "webhook copy key" {
    return Some(WebhookCopy(what="key"))
  }
  if low == "tool-read webhook key" ||
    low == "tool read webhook key" ||
    low == "read webhook key" {
    return Some(WebhookToolReadKey)
  }
  if low.has_prefix("webhook wake ") {
    let rest = trimmed[13:].trim().to_owned()
    let mut event_id = "evt-1"
    let mut summary = rest
    // Optional id=<id> summary=<text> kv form.
    if rest.has_prefix("id=") {
      let after = rest[3:].to_owned()
      match split_once(after, " summary=") {
        Some((eid, sum)) => {
          event_id = eid.trim().to_owned()
          summary = sum.trim().to_owned()
        }
        None => {
          event_id = after.trim().to_owned()
          summary = "POST /hooks received"
        }
      }
    } else {
      summary = rest
    }
    if summary.length() == 0 {
      summary = "POST /hooks received"
    }
    return Some(WebhookWake(event_id~, summary~))
  }
  // CM-1901/1902 product Host Settings (closed entry set + deep-link anchors).
  if low == "open settings" ||
    low == "settings" ||
    low == "open settings panel" ||
    low == "toggle theme" ||
    low == "dark mode" ||
    low == "light mode" ||
    low == "dark mode on" ||
    low == "light mode on" ||
    low == "set locale" ||
    low == "rate app" ||
    low == "rate bitbot" ||
    low == "send feedback" ||
    low == "list models" ||
    low == "switch model" ||
    low == "model picker" ||
    low.has_prefix("open settings ") ||
    low.has_prefix("settings ") ||
    low.has_prefix("set locale ") ||
    low.has_prefix("switch model ") ||
    low.has_prefix("list models ") ||
    low.has_prefix("set theme ") {
    let rest = if low.has_prefix("open settings ") {
      trimmed[14:].trim().to_owned()
    } else if low.has_prefix("settings ") {
      trimmed[9:].trim().to_owned()
    } else if low.has_prefix("set theme ") {
      "theme"
    } else if low == "toggle theme" ||
      low == "dark mode" ||
      low == "light mode" ||
      low == "dark mode on" ||
      low == "light mode on" {
      "theme"
    } else if low == "set locale" || low.has_prefix("set locale ") {
      "locale"
    } else if low == "rate app" ||
      low == "rate bitbot" ||
      low == "send feedback" {
      "feedback"
    } else if low == "list models" ||
      low == "switch model" ||
      low == "model picker" ||
      low.has_prefix("switch model ") ||
      low.has_prefix("list models ") {
      "models"
    } else {
      ""
    }
    let mut entry = "sidebar-account-button"
    let mut anchor = ""
    if rest == "cmd+," || rest == "shortcut" || rest == "keyboard" {
      entry = "keyboard-shortcut"
    } else if rest == "palette" || rest == "command palette" {
      entry = "command-palette"
    } else if rest.has_prefix("entry=") {
      match extract_kv(rest, "entry") {
        Some(v) => entry = v.trim().to_owned()
        None => ()
      }
      match extract_kv(rest, "anchor") {
        Some(v) => anchor = v.trim().to_owned()
        None => ()
      }
    } else if rest.has_prefix("anchor=") || rest.has_prefix("id=") {
      match extract_kv(rest, "anchor") {
        Some(v) => anchor = v.trim().to_owned()
        None =>
          match extract_kv(rest, "id") {
            Some(v) => anchor = v.trim().to_owned()
            None => ()
          }
      }
    } else if rest != "" && !rest.has_prefix("entry=") {
      // Bare token as anchor id (e.g. "open settings theme").
      anchor = rest.trim().to_owned()
    }
    // Forbidden gear / Preferences still emit effect; Host refuses honestly.
    return Some(OpenSettings(entry~, anchor~))
  }
  // CM-0205 product Host per-agent info panel.
  if low.has_prefix("open agent info ") ||
    low.has_prefix("agent info ") ||
    low.has_prefix("info panel ") ||
    low == "open agent info" ||
    low == "agent info panel" {
    let rest = if low.has_prefix("open agent info ") {
      trimmed[16:].trim().to_owned()
    } else if low.has_prefix("agent info ") {
      trimmed[11:].trim().to_owned()
    } else if low.has_prefix("info panel ") {
      trimmed[11:].trim().to_owned()
    } else {
      "agent-bit"
    }
    let agent_id = match extract_kv(rest, "agent") {
      Some(v) => v.trim().to_owned()
      None => if rest == "" { "agent-bit" } else { rest }
    }
    if agent_id != "" {
      return Some(OpenAgentInfoPanel(agent_id~))
    }
  }
  // CM-2174 product Host cross-agent shared box FS.
  if low == "shared box fs" ||
    low == "cross agent shared fs" ||
    low == "probe shared box" ||
    low == "shared fs probe" ||
    low == "check shared box fs" {
    return Some(SharedBoxFs)
  }
  // CM-0204 product Host hidden agents (sidebar filter; still addressable).
  if low == "list agents" ||
    low == "list sidebar agents" ||
    low == "main sidebar agents" ||
    low == "open agents sidebar" ||
    low == "agents sidebar" {
    return Some(ListAgentsSidebar)
  }
  if low.has_prefix("hide agent ") ||
    low.has_prefix("unhide agent ") ||
    low.has_prefix("show agent ") ||
    low.has_prefix("pin agent ") ||
    low.has_prefix("unpin agent ") {
    let hidden = low.has_prefix("hide agent ") || low.has_prefix("unpin agent ")
    let rest = if low.has_prefix("hide agent ") {
      trimmed[11:].trim().to_owned()
    } else if low.has_prefix("unhide agent ") {
      trimmed[13:].trim().to_owned()
    } else if low.has_prefix("show agent ") {
      trimmed[11:].trim().to_owned()
    } else if low.has_prefix("pin agent ") {
      trimmed[10:].trim().to_owned()
    } else {
      trimmed[12:].trim().to_owned()
    }
    let agent_id = match extract_kv(rest, "agent") {
      Some(v) => v.trim().to_owned()
      None => rest.trim().to_owned()
    }
    if agent_id != "" {
      return Some(HideAgent(agent_id~, hidden~))
    }
  }
  if low.has_prefix("rename agent ") {
    let rest = trimmed[13:].trim().to_owned()
    let agent_id = match extract_kv(rest, "agent") {
      Some(v) => v.trim().to_owned()
      None =>
        match split_once(rest, " ") {
          Some((id, _)) => id.trim().to_owned()
          None => rest
        }
    }
    if agent_id != "" {
      return Some(OpenAgentInfoPanel(agent_id~))
    }
  }
  // CM-0206 product Host per-assistant notification settings.
  if low.has_prefix("notify settings ") ||
    low == "notify settings" ||
    low.has_prefix("show notify ") {
    let rest = if low.has_prefix("notify settings ") {
      trimmed[16:].trim().to_owned()
    } else if low.has_prefix("show notify ") {
      trimmed[12:].trim().to_owned()
    } else {
      ""
    }
    let assistant_id = match extract_kv(rest, "assistant") {
      Some(v) => v.trim().to_owned()
      None => if rest == "" { "asst-alpha" } else { rest }
    }
    return Some(NotifySettings(assistant_id~))
  }
  if low.has_prefix("set notify ") {
    let rest = trimmed[11:].trim().to_owned()
    let assistant_id = match extract_kv(rest, "assistant") {
      Some(v) => v.trim().to_owned()
      None => "asst-alpha"
    }
    let toggle = match extract_kv(rest, "toggle") {
      Some(v) => v.trim().to_owned()
      None => "sound"
    }
    let enabled = match extract_kv(rest, "enabled") {
      Some(v) => {
        let t = v.trim().to_lower()
        t == "1" || t == "true" || t == "on" || t == "yes"
      }
      None => false
    }
    return Some(SetNotify(assistant_id~, toggle~, enabled~))
  }
  if low == "mute channel" ||
    low == "mute chat" ||
    low == "mute notifications" ||
    low == "enable notifications" ||
    low == "disable notifications" ||
    low == "unmute channel" ||
    low == "unmute chat" ||
    low == "do not disturb" ||
    low == "do not disturb on" ||
    low == "do not disturb off" ||
    low == "focus mode" ||
    low == "focus mode on" ||
    low == "focus mode off" ||
    low == "typing indicator" ||
    low == "read receipts" ||
    low == "set presence online" ||
    low == "raise hand" ||
    low == "lower hand" ||
    low == "push to talk" ||
    low == "toggle mute mic" ||
    low.has_prefix("set status ") ||
    low.has_prefix("custom status ") ||
    low.has_prefix("set presence ") {
    let enabled = if low.has_prefix("set status ") {
      let st = trimmed[11:].trim().to_lower()
      !(st == "away" || st == "dnd" || st == "offline" || st == "busy")
    } else if low.has_prefix("custom status ") || low.has_prefix("set presence ") {
      let st = if low.has_prefix("custom status ") {
        trimmed[14:].trim().to_lower()
      } else {
        trimmed[13:].trim().to_lower()
      }
      !(st == "away" || st == "dnd" || st == "offline" || st == "busy")
    } else {
      low.has_prefix("unmute") ||
      low == "typing indicator" ||
      low == "read receipts" ||
      low == "do not disturb off" ||
      low == "focus mode off" ||
      low == "enable notifications" ||
      low == "set presence online" ||
      low == "raise hand" ||
      low == "push to talk"
    }
    let toggle = if low == "do not disturb" ||
      low == "do not disturb on" ||
      low == "do not disturb off" ||
      low == "focus mode" ||
      low == "focus mode on" ||
      low == "focus mode off" ||
      low.has_prefix("set status ") {
      "desktop"
    } else if low == "typing indicator" {
      "sound"
    } else if low == "read receipts" {
      "mentions_only"
    } else if low == "mute notifications" {
      "desktop"
    } else {
      "desktop"
    }
    return Some(SetNotify(assistant_id="asst-alpha", toggle~, enabled~))
  }
  // CM-1903/1904/1905 product Host computer lifecycle + local-execution.
  if low == "update computer" ||
    low == "update bot computer" ||
    low.has_prefix("update computer ") {
    let rest = if low.has_prefix("update computer ") {
      trimmed[16:].trim().to_owned()
    } else {
      ""
    }
    let confirm_step = match extract_kv(rest, "confirm") {
      Some(v) => parse_nonneg_i32(v)
      None =>
        if rest == "confirm" || rest == "confirm=1" {
          1
        } else if rest == "confirm=2" {
          2
        } else {
          0
        }
    }
    return Some(UpdateComputer(confirm_step~))
  }
  if low == "reset computer" ||
    low == "reset bot computer" ||
    low == "factory reset" ||
    low == "wipe data" {
    return Some(ResetComputer)
  }
  if low == "local execution off" ||
    low == "disable local execution" ||
    low == "local execution on" ||
    low == "enable local execution" ||
    low.has_prefix("local execution ") {
    let on = if low == "local execution off" ||
      low == "disable local execution" ||
      low.has_suffix(" enabled=0") ||
      low.has_suffix(" off") {
      false
    } else {
      true
    }
    return Some(LocalExecution(enabled=on))
  }
  // CM-0605 product Host read-only screenshot (real frame when DISPLAY/tools).
  if low == "screenshot" ||
    low == "take screenshot" ||
    low == "capture screenshot" ||
    low == "screen shot" ||
    low == "list windows" ||
    low == "share screen" ||
    low == "screen share" ||
    low == "start screen share" ||
    low == "stop screen share" ||
    low == "stop share screen" ||
    low == "screen share stop" ||
    low.has_prefix("screenshot ") ||
    low.has_prefix("take screenshot ") {
    let rest = if low.has_prefix("screenshot ") {
      trimmed[11:].trim().to_owned()
    } else if low.has_prefix("take screenshot ") {
      trimmed[16:].trim().to_owned()
    } else {
      ""
    }
    let agent_id = match extract_kv(rest, "agent") {
      Some(v) => v.trim().to_owned()
      None => if rest != "" && !rest.contains("=") { rest } else { "executor" }
    }
    return Some(Screenshot(agent_id~))
  }
  // CM-1906 product Host Updates tab ≠ Update Computer.
  if low == "check updates" ||
    low == "check for updates" ||
    low == "open updates" ||
    low == "updates tab" ||
    low == "update channel" ||
    low == "open update channel" ||
    low == "app updates" ||
    low == "version info" ||
    low == "about version" ||
    low == "app version" ||
    low == "about bitbot" ||
    low == "about bit bot" ||
    low == "about" {
    return Some(CheckUpdates)
  }
  // CM-1507 product Host auto-review / rules / security-keys Settings anchors.
  if low == "auto review settings" ||
    low == "open auto review" ||
    low == "auto-review settings" ||
    low == "security keys settings" ||
    low == "open auto-review" ||
    low == "auto review anchors" {
    return Some(AutoReviewSettings)
  }
  // CM-0802 product Host box-chrome launcher (not bare chrome).
  if low == "launch bare chrome" ||
    low == "bare chrome" ||
    low == "launch chrome bare" {
    return Some(BoxChromeProbe(want_bare=true))
  }
  if low == "box chrome probe" ||
    low == "box-chrome probe" ||
    low == "probe box chrome" ||
    low == "probe box-chrome" ||
    low == "launch box chrome" ||
    low == "box chrome launcher" ||
    low == "box-chrome launcher" {
    return Some(BoxChromeProbe(want_bare=false))
  }
  // CM-2101/2128 product Host ReactToMessage pill toggle.
  if low == "react message" ||
    low == "add reaction" ||
    low == "remove reaction" ||
    low == "pin message" ||
    low == "pin this message" ||
    low == "unpin message" ||
    low.has_prefix("react message ") ||
    low.has_prefix("react to message ") ||
    low.has_prefix("toggle reaction ") ||
    low.has_prefix("add reaction ") ||
    low.has_prefix("pin message ") ||
    low.has_prefix("unpin message ") {
    let rest = if low.has_prefix("react to message ") {
      trimmed[17:].trim().to_owned()
    } else if low.has_prefix("toggle reaction ") {
      trimmed[16:].trim().to_owned()
    } else if low.has_prefix("add reaction ") {
      trimmed[13:].trim().to_owned()
    } else if low.has_prefix("pin message ") {
      trimmed[12:].trim().to_owned()
    } else if low.has_prefix("unpin message ") {
      trimmed[14:].trim().to_owned()
    } else if low.has_prefix("react message ") {
      trimmed[14:].trim().to_owned()
    } else {
      ""
    }
    let message_id = match extract_kv(rest, "msg") {
      Some(v) => v.trim().to_owned()
      None =>
        match extract_kv(rest, "message") {
          Some(v) => v.trim().to_owned()
          None => "msg-1"
        }
    }
    let emoji = match extract_kv(rest, "emoji") {
      Some(v) => v.trim().to_owned()
      None =>
        // Positional trailing token as emoji if present.
        match split_once(rest, " ") {
          Some((_, e)) => {
            let t = e.trim().to_owned()
            if t.has_prefix("emoji=") {
              t[6:].trim().to_owned()
            } else if t != "" {
              t
            } else {
              "👍"
            }
          }
          None => "👍"
        }
    }
    return Some(ReactMessage(message_id~, emoji~))
  }
  // CM-2103 product Host markdown math + mermaid render.
  if low == "export markdown" || low == "markdown export" {
    return Some(RenderMarkdown(body="# export"))
  }
  if low.has_prefix("render markdown ") ||
    low.has_prefix("render math ") ||
    low.has_prefix("markdown math ") ||
    low.has_prefix("export markdown ") {
    let body = if low.has_prefix("render markdown ") {
      trimmed[16:].to_owned()
    } else if low.has_prefix("render math ") {
      trimmed[12:].to_owned()
    } else if low.has_prefix("export markdown ") {
      trimmed[16:].to_owned()
    } else {
      trimmed[14:].to_owned()
    }
    if body.trim().length() > 0 {
      return Some(RenderMarkdown(body=body.trim().to_owned()))
    }
  }
  // CM-2178 product Host missing-permission → Settings guide.
  if low == "summarize thread" ||
    low.has_prefix("summarize thread ") ||
    low == "guide permission" {
    return Some(GuidePermission(kind="summarize", detail="thread"))
  }
  if low.has_prefix("guide permission ") ||
    low.has_prefix("missing permission ") ||
    low.has_prefix("permission guide ") {
    let rest = if low.has_prefix("guide permission ") {
      trimmed[17:].trim().to_owned()
    } else if low.has_prefix("missing permission ") {
      trimmed[19:].trim().to_owned()
    } else {
      trimmed[17:].trim().to_owned()
    }
    let kind = match extract_kv(rest, "kind") {
      Some(v) => v.trim().to_owned()
      None => "needs-auth"
    }
    let detail = match extract_kv(rest, "ns") {
      Some(v) => v.trim().to_owned()
      None =>
        match extract_kv(rest, "tool") {
          Some(v) => v.trim().to_owned()
          None =>
            match extract_kv(rest, "detail") {
              Some(v) => v.trim().to_owned()
              None =>
                if rest != "" && !rest.has_prefix("kind=") {
                  rest
                } else {
                  "user-Gmail"
                }
            }
        }
    }
    return Some(GuidePermission(kind~, detail~))
  }
  // CM-1405 product Host Members panel.
  if low == "open members" ||
    low == "members panel" ||
    low == "show members" ||
    low == "list members" ||
    low == "members" ||
    low == "invite to channel" ||
    low == "generate invite" ||
    low == "accept invite" ||
    low == "decline invite" ||
    low.has_prefix("open members ") ||
    low.has_prefix("members panel ") ||
    low.has_prefix("list members ") ||
    low.has_prefix("invite to channel ") ||
    low.has_prefix("generate invite ") ||
    low.has_prefix("accept invite ") ||
    low.has_prefix("invite user ") ||
    low.has_prefix("invite ") ||
    low.has_prefix("kick user ") ||
    low.has_prefix("kick ") ||
    low.has_prefix("remove member ") ||
    low.has_prefix("block user ") ||
    low.has_prefix("unblock user ") ||
    low == "block user" ||
    low == "unblock user" ||
    low == "share invite link" ||
    low == "revoke invite" ||
    low == "transfer ownership" ||
    low == "switch workspace" ||
    low == "list workspaces" ||
    low == "create workspace" ||
    low == "open activity" ||
    low == "open inbox" ||
    low == "open mentions" ||
    low.has_prefix("switch workspace ") ||
    low.has_prefix("create workspace ") {
    let rest = if low.has_prefix("open members ") {
      trimmed[13:].trim().to_owned()
    } else if low.has_prefix("members panel ") {
      trimmed[14:].trim().to_owned()
    } else if low.has_prefix("list members ") {
      trimmed[13:].trim().to_owned()
    } else if low == "invite to channel" ||
      low == "generate invite" ||
      low == "accept invite" ||
      low == "decline invite" ||
      low == "open members" ||
      low == "members panel" ||
      low == "show members" ||
      low == "list members" ||
      low == "members" ||
      low == "share invite link" ||
      low == "revoke invite" ||
      low == "transfer ownership" ||
      low == "switch workspace" ||
      low == "list workspaces" ||
      low == "create workspace" ||
      low == "open activity" ||
      low == "open inbox" ||
      low == "open mentions" {
      ""
    } else if low.has_prefix("invite to channel ") {
      trimmed[18:].trim().to_owned()
    } else if low.has_prefix("generate invite ") {
      trimmed[16:].trim().to_owned()
    } else if low.has_prefix("accept invite ") {
      trimmed[14:].trim().to_owned()
    } else if low.has_prefix("invite user ") {
      trimmed[12:].trim().to_owned()
    } else if low.has_prefix("invite ") {
      trimmed[7:].trim().to_owned()
    } else if low.has_prefix("kick user ") {
      trimmed[10:].trim().to_owned()
    } else if low.has_prefix("kick ") {
      trimmed[5:].trim().to_owned()
    } else if low.has_prefix("remove member ") {
      trimmed[14:].trim().to_owned()
    } else if low.has_prefix("block user ") {
      trimmed[11:].trim().to_owned()
    } else if low.has_prefix("unblock user ") {
      trimmed[13:].trim().to_owned()
    } else if low == "block user" || low == "unblock user" {
      ""
    } else {
      ""
    }
    let group_id = match extract_kv(rest, "group") {
      Some(v) => v.trim().to_owned()
      None => if rest == "" { "group-1" } else { rest }
    }
    return Some(MembersPanel(group_id~))
  }
  // CM-2158 product Host box package install (Shell only).
  if low.has_prefix("install package ") ||
    low.has_prefix("box install ") ||
    low.has_prefix("package install ") {
    let rest = if low.has_prefix("install package ") {
      trimmed[16:].trim().to_owned()
    } else if low.has_prefix("package install ") {
      trimmed[16:].trim().to_owned()
    } else {
      trimmed[12:].trim().to_owned()
    }
    let mut via = "shell"
    let mut pm = "npm"
    let mut packages_csv = ""
    match extract_kv(rest, "via") {
      Some(v) => via = v.trim().to_owned()
      None => ()
    }
    match extract_kv(rest, "pm") {
      Some(v) => pm = v.trim().to_owned()
      None => ()
    }
    match extract_kv(rest, "pkgs") {
      Some(v) => packages_csv = v.trim().to_owned()
      None =>
        match extract_kv(rest, "packages") {
          Some(v) => packages_csv = v.trim().to_owned()
          None => ()
        }
    }
    // Positional: "install package npm left-pad" or "box install apt curl,jq"
    if packages_csv == "" {
      let parts = rest.split(" ")
      let tokens : Array[String] = []
      for p in parts {
        let t = p.trim().to_owned()
        if t != "" &&
          !t.has_prefix("via=") &&
          !t.has_prefix("pm=") &&
          !t.has_prefix("pkgs=") &&
          !t.has_prefix("packages=") {
          tokens.push(t)
        }
      }
      if tokens.length() >= 2 {
        // First token may be pm if not already set via kv
        let first = tokens[0].to_lower()
        if first == "apt" ||
          first == "npm" ||
          first == "pip" ||
          first == "cargo" {
          pm = first
          let mut i = 1
          while i < tokens.length() {
            if packages_csv != "" {
              packages_csv = packages_csv + ","
            }
            packages_csv = packages_csv + tokens[i]
            i = i + 1
          }
        } else {
          packages_csv = tokens[0]
          let mut i = 1
          while i < tokens.length() {
            packages_csv = packages_csv + "," + tokens[i]
            i = i + 1
          }
        }
      } else if tokens.length() == 1 {
        packages_csv = tokens[0]
      }
    }
    if packages_csv != "" {
      return Some(PackageInstall(pm~, packages_csv~, via~))
    }
  }
  // CM-1907 product Host delete agent (sidebar confirm; not Settings).
  if low.has_prefix("delete agent ") || low.has_prefix("confirm delete agent ") {
    let confirmed = low.has_prefix("confirm delete agent ")
    let rest = if confirmed {
      trimmed[21:].trim().to_owned()
    } else {
      trimmed[13:].trim().to_owned()
    }
    let agent_id = match extract_kv(rest, "agent") {
      Some(v) => v.trim().to_owned()
      None => rest.trim().to_owned()
    }
    if agent_id != "" {
      return Some(DeleteAgent(agent_id~, confirm=confirmed))
    }
  }
  // CM-2157 product Host structured chart (Pillow PNG via Host FFI).
  if low == "structured chart" ||
    low.has_prefix("structured chart ") ||
    low.has_prefix("make chart ") ||
    low.has_prefix("chart series ") ||
    low.has_prefix("generate chart ") {
    let series_json = if low == "structured chart" {
      "{\"alpha\":1,\"beta\":2}"
    } else if low.has_prefix("structured chart ") {
      trimmed[17:].trim().to_owned()
    } else if low.has_prefix("make chart ") {
      trimmed[11:].trim().to_owned()
    } else if low.has_prefix("chart series ") {
      trimmed[13:].trim().to_owned()
    } else {
      trimmed[15:].trim().to_owned()
    }
    if series_json != "" {
      return Some(StructuredChart(series_json~))
    }
  }
  if low == "clear chat" ||
    low == "clear chat history" ||
    low == "delete chat" ||
    low == "archive chat" ||
    low == "new chat" {
    return Some(HideAgent(agent_id="asst-chat", hidden=true))
  }
  if low.has_prefix("code changes ") || low.has_prefix("edit code ") {
    let path = if low.has_prefix("code changes ") {
      trimmed[13:].trim().to_owned()
    } else {
      trimmed[10:].trim().to_owned()
    }
    if path != "" {
      return Some(CodeChanges(path~))
    }
  }
  if low.has_prefix("source control ") || low.has_prefix("route sc ") {
    let kind = if low.has_prefix("source control ") {
      trimmed[15:].trim().to_owned()
    } else {
      trimmed[9:].trim().to_owned()
    }
    if kind != "" {
      return Some(SourceControl(repo_kind=kind))
    }
  }
  if low.has_prefix("send on behalf ") || low.has_prefix("proxy send ") {
    let rest = if low.has_prefix("send on behalf ") {
      trimmed[15:].to_owned()
    } else {
      trimmed[11:].to_owned()
    }
    let to_ = match extract_kv(rest, "to") {
      Some(v) => v
      None => ""
    }
    let subject = match extract_kv(rest, "subject") {
      Some(v) => v
      None => "proxy"
    }
    let body = match extract_kv(rest, "body") {
      Some(v) => v
      None => "hello"
    }
    if to_ != "" {
      return Some(SendOnBehalf(to_~, subject~, body~))
    }
  }
  if low == "list workflows" ||
    low == "user workflows" ||
    low == "show workflows" {
    return Some(ListWorkflows)
  }
  if low == "use user browser" ||
    low == "identity browser" ||
    low == "open identity browser" ||
    low == "switch to browser identity" ||
    low == "open identity" ||
    low == "switch identity" {
    return Some(IdentityBrowser)
  }
  if low.has_prefix("x search ") ||
    low.has_prefix("search x ") ||
    low.has_prefix("twitter search ") {
    let query = if low.has_prefix("x search ") {
      trimmed[9:].trim().to_owned()
    } else if low.has_prefix("search x ") {
      trimmed[9:].trim().to_owned()
    } else {
      trimmed[15:].trim().to_owned()
    }
    if query != "" {
      return Some(XSearch(query~))
    }
  }
  // Product X post → Host x_post draft-first (Desktop button was chat fallback).
  if low.has_prefix("x post ") ||
    low.has_prefix("post tweet ") ||
    low.has_prefix("tweet ") ||
    low.has_prefix("create post ") ||
    low.has_prefix("draft post ") ||
    low.has_prefix("reply tweet ") {
    let text = if low.has_prefix("x post ") {
      trimmed[7:].trim().to_owned()
    } else if low.has_prefix("post tweet ") {
      trimmed[11:].trim().to_owned()
    } else if low.has_prefix("tweet ") {
      trimmed[6:].trim().to_owned()
    } else if low.has_prefix("create post ") {
      trimmed[12:].trim().to_owned()
    } else if low.has_prefix("draft post ") {
      trimmed[11:].trim().to_owned()
    } else {
      // reply tweet <id> <body>
      let rest = trimmed[12:].trim().to_owned()
      match split_once(rest, " ") {
        Some((_, body)) => body.trim().to_owned()
        None => rest
      }
    }
    if text != "" {
      return Some(XPost(text~))
    }
  }
  if low.has_prefix("author skill ") ||
    low.has_prefix("edit skill ") ||
    low.has_prefix("delete skill ") ||
    low.has_prefix("update skill ") {
    let rest = if low.has_prefix("author skill ") {
      trimmed[13:].to_owned()
    } else if low.has_prefix("edit skill ") {
      trimmed[11:].to_owned()
    } else if low.has_prefix("delete skill ") {
      trimmed[13:].to_owned()
    } else {
      trimmed[13:].to_owned()
    }
    let name = match extract_kv(rest, "name") {
      Some(v) => v
      None =>
        if rest != "" && !rest.contains("=") {
          rest.trim().to_owned()
        } else {
          "custom-skill"
        }
    }
    let description = match extract_kv(rest, "description") {
      Some(v) => v
      None =>
        if low.has_prefix("delete skill ") {
          "deleted skill"
        } else {
          "user authored skill"
        }
    }
    let body = match extract_kv(rest, "body") {
      Some(v) => v
      None =>
        if low.has_prefix("delete skill ") {
          "# deleted"
        } else {
          "Follow steps carefully."
        }
    }
    return Some(AuthorSkill(name~, description~, body~))
  }
  if low == "connect gmail" ||
    low == "setup gmail" ||
    low == "gmail connect" ||
    low == "oauth gmail" ||
    low == "gmail oauth" ||
    low == "authorize gmail" ||
    low == "reauth gmail" ||
    low == "refresh token gmail" {
    return Some(ConnectGmail)
  }
  if low == "reauth slack" || low == "authorize slack" || low == "refresh token slack" {
    return Some(SetupSlack)
  }
  if low == "connect outlook" ||
    low == "setup outlook" ||
    low == "outlook connect" {
    return Some(ConnectOutlook)
  }
  if low == "disconnect slack" ||
    low == "disconnect gmail" ||
    low == "revoke token" ||
    low == "disconnect connector" {
    // Product disconnect/revoke → same Host oauth / settings honesty path.
    if low == "disconnect gmail" {
      return Some(ConnectGmail)
    }
    if low == "disconnect slack" {
      return Some(SetupSlack)
    }
    return Some(OpenSettings(entry="sidebar-account-button", anchor="connectors"))
  }
  // Journal query before append — bare "journal query" also matches "journal " prefix.
  if low == "bookmark message" ||
    low == "save message" ||
    low == "bookmark" ||
    low == "journal query" ||
    low == "query journal" ||
    low == "note list" ||
    low == "list notes" ||
    low == "list bookmarks" ||
    low.has_prefix("bookmark message ") ||
    low.has_prefix("save message ") ||
    low.has_prefix("bookmark url ") {
    return Some(JournalQuery(from_date="2026-01-01", to_date="2099-12-31"))
  }
  if low.has_prefix("query journal ") || low.has_prefix("journal query ") {
    let rest = if low.has_prefix("query journal ") {
      trimmed[14:].to_owned()
    } else {
      trimmed[14:].to_owned()
    }
    let from_date = match extract_kv(rest, "from") {
      Some(v) => v
      None => "2026-01-01"
    }
    let to_date = match extract_kv(rest, "to") {
      Some(v) => v
      None => "2026-12-31"
    }
    return Some(JournalQuery(from_date~, to_date~))
  }
  if low.has_prefix("journal ") ||
    low.has_prefix("append journal ") ||
    low.has_prefix("note create ") ||
    low.has_prefix("append note ") ||
    low.has_prefix("create note ") {
    let rest = if low.has_prefix("append journal ") {
      trimmed[15:].to_owned()
    } else if low.has_prefix("note create ") {
      trimmed[12:].to_owned()
    } else if low.has_prefix("create note ") {
      trimmed[12:].to_owned()
    } else if low.has_prefix("append note ") {
      trimmed[12:].to_owned()
    } else {
      trimmed[8:].to_owned()
    }
    let date = match extract_kv(rest, "date") {
      Some(v) => v
      None => "2026-10-17"
    }
    let event_id = match extract_kv(rest, "id") {
      Some(v) => v
      None => "evt-1"
    }
    let body = match extract_kv(rest, "body") {
      Some(v) => v
      None => rest.trim().to_owned()
    }
    if body != "" {
      return Some(JournalAppend(date~, event_id~, body~))
    }
  }
  // CM-0112 product Host durable todo checklist.
  if low == "list todos" ||
    low == "todo list" ||
    low == "open todo" ||
    low == "todos" ||
    low == "checklist" ||
    low == "clear todos" {
    return Some(TodoWrite(command=low))
  }
  if low == "mark as done" ||
    low == "mark done" ||
    low.has_prefix("mark done ") ||
    low.has_prefix("mark as done ") ||
    low.has_prefix("complete todo ") {
    let rest = if low.has_prefix("mark as done ") {
      trimmed[13:].trim().to_owned()
    } else if low.has_prefix("mark done ") {
      trimmed[10:].trim().to_owned()
    } else if low.has_prefix("complete todo ") {
      trimmed[14:].trim().to_owned()
    } else {
      "todo-1"
    }
    let id = if rest != "" { rest } else { "todo-1" }
    return Some(TodoWrite(command=id + "|done|done"))
  }
  if low.has_prefix("todo write ") ||
    low.has_prefix("write todo ") ||
    low.has_prefix("add todo ") ||
    low.has_prefix("create todo ") ||
    low.has_prefix("task create ") {
    let rest = if low.has_prefix("todo write ") {
      trimmed[11:].trim().to_owned()
    } else if low.has_prefix("write todo ") {
      trimmed[11:].trim().to_owned()
    } else if low.has_prefix("add todo ") {
      trimmed[9:].trim().to_owned()
    } else if low.has_prefix("create todo ") {
      trimmed[12:].trim().to_owned()
    } else {
      trimmed[12:].trim().to_owned()
    }
    if rest != "" {
      return Some(TodoWrite(command=rest))
    }
  }
  if low.has_prefix("shared memory put ") || low.has_prefix("share memory ") {
    let rest = if low.has_prefix("shared memory put ") {
      trimmed[18:].to_owned()
    } else {
      trimmed[13:].to_owned()
    }
    let scope = match extract_kv(rest, "scope") {
      Some(v) => v
      None => "team"
    }
    let key = match extract_kv(rest, "key") {
      Some(v) => v
      None => ""
    }
    let value = match extract_kv(rest, "value") {
      Some(v) => v
      None => ""
    }
    if key != "" {
      return Some(SharedMemoryPut(scope~, key~, value~))
    }
  }
  if low.has_prefix("shared memory read ") || low.has_prefix("read shared ") {
    let rest = if low.has_prefix("shared memory read ") {
      trimmed[19:].to_owned()
    } else {
      trimmed[12:].to_owned()
    }
    let scope = match extract_kv(rest, "scope") {
      Some(v) => v
      None => "team"
    }
    let key = match extract_kv(rest, "key") {
      Some(v) => v
      None => rest.trim().to_owned()
    }
    if key != "" {
      return Some(SharedMemoryRead(scope~, key~))
    }
  }
  if @channels.has_inbound_reaction_cue(trimmed) {
    // Avoid matching the substring "act" inside "reaction".
    let useful = low.contains("useful") ||
      low.contains(" act") ||
      low.has_prefix("act ") ||
      low == "act" ||
      low.has_suffix(" act")
    let emoji = if low.contains(":+1:") || low.contains("thumbs") {
      "+1"
    } else if low.contains("heart") {
      "heart"
    } else {
      "reaction"
    }
    return Some(InboundReaction(emoji~, useful~))
  }
  if low.has_prefix("export bot template ") ||
    low.has_prefix("export bot ") ||
    low.has_prefix("export skill ") ||
    low.has_prefix("share bot ") ||
    low == "backup chat" ||
    low == "share link" ||
    low == "share bot" ||
    low == "copy invite" ||
    low == "export chat" ||
    low == "export pack" ||
    low == "export pdf" ||
    low == "print page" ||
    low == "pdf export" ||
    low == "restore backup" ||
    low == "fork chat" ||
    low == "star chat" ||
    low == "unstar chat" ||
    low.has_prefix("backup chat ") ||
    low.has_prefix("share link ") ||
    low.has_prefix("copy invite ") ||
    low.has_prefix("export chat ") ||
    low.has_prefix("restore backup ") ||
    low.has_prefix("export pdf ") {
    let rest = if low.has_prefix("export bot template ") {
      trimmed[20:].to_owned()
    } else if low.has_prefix("export bot ") {
      trimmed[11:].to_owned()
    } else if low.has_prefix("export skill ") {
      "id=" + trimmed[13:].trim().to_owned() + " name=" + trimmed[13:].trim().to_owned()
    } else if low.has_prefix("share bot ") {
      "id=" + trimmed[10:].trim().to_owned() + " name=Share"
    } else if low.has_prefix("backup chat ") {
      trimmed[12:].to_owned()
    } else if low.has_prefix("share link ") {
      trimmed[11:].to_owned()
    } else if low.has_prefix("export pdf ") {
      "id=pdf-" + trimmed[11:].trim().to_owned() + " name=PDF"
    } else if low == "backup chat" ||
      low == "share link" ||
      low == "share bot" ||
      low == "export pack" ||
      low == "export pdf" ||
      low == "print page" ||
      low == "pdf export" {
      "id=bot-export name=Export"
    } else {
      ""
    }
    let bot_id = match extract_kv(rest, "id") {
      Some(v) => v
      None => "bot-1"
    }
    let name = match extract_kv(rest, "name") {
      Some(v) => v
      None => bot_id
    }
    return Some(ExportBotTemplate(bot_id~, name~))
  }
  if low.has_prefix("create routine ") ||
    low.has_prefix("schedule routine ") ||
    low.has_prefix("create reminder ") ||
    low.has_prefix("set reminder ") {
    let rest = if low.has_prefix("create routine ") {
      trimmed[15:].to_owned()
    } else if low.has_prefix("schedule routine ") {
      trimmed[17:].to_owned()
    } else if low.has_prefix("create reminder ") {
      trimmed[16:].to_owned()
    } else {
      trimmed[13:].to_owned()
    }
    let id = match extract_kv(rest, "id") {
      Some(v) => v
      None =>
        match extract_kv(rest, "name") {
          Some(v) => v
          None => "routine-1"
        }
    }
    let cron = match extract_kv(rest, "cron") {
      Some(v) => v
      None => "@daily"
    }
    let prompt = match extract_kv(rest, "prompt") {
      Some(v) => v
      None =>
        match extract_kv(rest, "action") {
          Some(v) => v
          None => rest
        }
    }
    if prompt != "" {
      return Some(CreateRoutine(id~, cron~, prompt~))
    }
  }
  if low.has_prefix("spawn subagent ") ||
    low.has_prefix("subagent ") ||
    low.has_prefix("dispatch agent ") {
    let prompt = if low.has_prefix("spawn subagent ") {
      trimmed[15:].trim().to_owned()
    } else if low.has_prefix("dispatch agent ") {
      trimmed[15:].trim().to_owned()
    } else {
      trimmed[9:].trim().to_owned()
    }
    if prompt != "" {
      return Some(SpawnSubagent(prompt~))
    }
  }
  if low.has_prefix("mcp discover") || low.has_prefix("discover mcp") {
    let ns = if low.has_prefix("mcp discover ") {
      trimmed[13:].trim().to_owned()
    } else if low.has_prefix("discover mcp ") {
      trimmed[13:].trim().to_owned()
    } else {
      ""
    }
    return Some(McpDiscover(namespace_=ns))
  }
  if low.has_prefix("mcp call ") {
    let rest = trimmed[9:].trim().to_owned()
    // mcp call user-Gmail.search_threads {"q":"a"}
    match split_once(rest, " ") {
      Some((tool, args)) =>
        match split_once(tool, ".") {
          Some((ns, name)) =>
            return Some(
              McpCall(namespace_=ns, name~, args_json=args.trim().to_owned()),
            )
          None => ()
        }
      None => ()
    }
  }
  if low == "focus window" || low == "minimize window" {
    return Some(ComputerUse(task=low))
  }
  if low.has_prefix("computer use ") || low.has_prefix("computeruse ") {
    let task = if low.has_prefix("computer use ") {
      trimmed[13:].trim().to_owned()
    } else {
      trimmed[12:].trim().to_owned()
    }
    if task != "" {
      return Some(ComputerUse(task~))
    }
  }
  // Channel message product phrasing → ChannelDelivery Host path.
  if low == "edit message" ||
    low == "delete message" ||
    low == "forward message" ||
    low == "set topic" ||
    low == "set description" ||
    low == "archive dm" ||
    low == "unarchive dm" ||
    low == "list channels" ||
    low == "create channel" ||
    low == "archive channel" ||
    low == "leave channel" ||
    low == "star channel" ||
    low == "unstar channel" ||
    low == "open thread" ||
    low == "close thread" ||
    low == "collapse thread" ||
    low == "reply in thread" ||
    low == "save for later" ||
    low == "snooze message" ||
    low == "translate message" ||
    low == "search in channel" ||
    low.has_prefix("edit message ") ||
    low.has_prefix("delete message ") ||
    low.has_prefix("forward message ") ||
    low.has_prefix("set topic ") ||
    low.has_prefix("create channel ") ||
    low.has_prefix("archive channel ") ||
    low.has_prefix("leave channel ") ||
    low.has_prefix("rename channel ") ||
    low.has_prefix("topic channel ") ||
    low.has_prefix("reply in thread ") ||
    low.has_prefix("search messages ") ||
    low.has_prefix("open thread ") {
    let body = if low.has_prefix("edit message ") {
      trimmed[14:].trim().to_owned()
    } else if low.has_prefix("delete message ") {
      trimmed[16:].trim().to_owned()
    } else if low.has_prefix("forward message ") {
      trimmed[17:].trim().to_owned()
    } else if low.has_prefix("set topic ") {
      trimmed[10:].trim().to_owned()
    } else if low.has_prefix("create channel ") {
      "create channel " + trimmed[15:].trim().to_owned()
    } else if low.has_prefix("archive channel ") {
      "archive channel " + trimmed[16:].trim().to_owned()
    } else if low.has_prefix("leave channel ") {
      "leave channel " + trimmed[14:].trim().to_owned()
    } else if low.has_prefix("rename channel ") {
      "rename channel " + trimmed[15:].trim().to_owned()
    } else if low.has_prefix("topic channel ") {
      "set topic " + trimmed[14:].trim().to_owned()
    } else if low.has_prefix("reply in thread ") {
      trimmed[16:].trim().to_owned()
    } else if low.has_prefix("search messages ") {
      "search " + trimmed[16:].trim().to_owned()
    } else if low.has_prefix("open thread ") {
      "open thread " + trimmed[12:].trim().to_owned()
    } else {
      low
    }
    let b = if body != "" { body } else { low }
    return Some(
      ChannelDelivery(
        inbound=Some("slack:Csmoke"),
        outbound=Some("slack:Csmoke"),
        body=b,
      ),
    )
  }
  if low == "mark unread" || low.has_prefix("mark unread ") {
    return Some(SearchMail(query="is:unread"))
  }
  if low.has_prefix("teams send ") || low.has_prefix("send teams ") {
    let rest = if low.has_prefix("teams send ") {
      trimmed[11:].to_owned()
    } else {
      trimmed[11:].to_owned()
    }
    match split_once(rest, " :: ") {
      Some((scope, body)) => {
        let s = scope.trim().to_owned()
        let b = body.trim().to_owned()
        if s != "" && b != "" {
          return Some(TeamsSend(scope=s, body=b))
        }
      }
      None => ()
    }
  }
  if low == "device tools" ||
    low == "list device tools" ||
    low == "phone tools" ||
    low == "device status" ||
    low.has_prefix("device status ") {
    return Some(DeviceTools)
  }
  if low == "clipboard" ||
    low == "clipboard read" ||
    low == "copy to clipboard" ||
    low == "paste from clipboard" ||
    low == "read clipboard" {
    return Some(DeviceToolInvoke(tool="clipboard"))
  }
  if low.has_prefix("device tool ") || low.has_prefix("invoke device ") {
    let tool = if low.has_prefix("device tool ") {
      trimmed[12:].trim().to_owned()
    } else {
      trimmed[14:].trim().to_owned()
    }
    if tool != "" {
      return Some(DeviceToolInvoke(tool~))
    }
  }
  // Product phrasing → same Host device_tool kinds (multi-end quick actions).
  if low == "take photo" ||
      low == "take a photo" ||
      low == "capture photo" ||
      low.has_prefix("take photo ") {
    return Some(DeviceToolInvoke(tool="camera"))
  }
  if low == "record video" ||
      low == "take video" ||
      low.has_prefix("record video ") {
    return Some(DeviceToolInvoke(tool="mic"))
  }
  if low == "record audio" ||
      low == "record voice" ||
      low.has_prefix("record audio ") {
    return Some(DeviceToolInvoke(tool="mic"))
  }
  if low == "scan document" ||
      low == "scan doc" ||
      low.has_prefix("scan document ") {
    return Some(DeviceToolInvoke(tool="camera"))
  }
  if low == "scan qr" || low == "nfc read" || low == "wifi status" || low == "battery status" {
    let tool = if low == "scan qr" {
      "camera"
    } else if low == "nfc read" {
      "contacts"
    } else if low == "wifi status" || low == "battery status" {
      "location"
    } else {
      "camera"
    }
    return Some(DeviceToolInvoke(tool~))
  }
  if low == "list skills" ||
    low == "skills list" ||
    low == "open skills" ||
    low == "skills panel" ||
    low == "reload skills" {
    return Some(ListSkills(query=""))
  }
  if low.has_prefix("list skills ") || low.has_prefix("skills list ") {
    let q = if low.has_prefix("list skills ") {
      trimmed[12:].trim().to_owned()
    } else {
      trimmed[12:].trim().to_owned()
    }
    return Some(ListSkills(query=q))
  }
  if low.has_prefix("load skill ") ||
    low.has_prefix("use skill ") ||
    low.has_prefix("install skill ") {
    let task = if low.has_prefix("load skill ") {
      trimmed[11:].trim().to_owned()
    } else if low.has_prefix("install skill ") {
      trimmed[14:].trim().to_owned()
    } else {
      trimmed[10:].trim().to_owned()
    }
    if task != "" {
      return Some(LoadSkill(task~))
    }
  }
  if low == "start huddle" ||
    low == "huddle start" ||
    low == "join huddle" {
    return Some(VoiceStart(call_id="huddle-1"))
  }
  if low == "end huddle" || low == "huddle end" || low == "leave huddle" {
    return Some(VoiceEnd(call_id="huddle-1"))
  }
  if low.has_prefix("voice start ") || low.has_prefix("start voice ") {
    let id = if low.has_prefix("voice start ") {
      trimmed[12:].trim().to_owned()
    } else {
      trimmed[12:].trim().to_owned()
    }
    if id != "" {
      return Some(VoiceStart(call_id=id))
    }
  }
  if low.has_prefix("voice relay ") {
    let rest = trimmed[12:].trim().to_owned()
    match split_once(rest, " :: ") {
      Some((cid, text)) => {
        let c = cid.trim().to_owned()
        let t = text.trim().to_owned()
        if c != "" && t != "" {
          return Some(VoiceRelay(call_id=c, text=t))
        }
      }
      None => ()
    }
  }
  if low.has_prefix("voice end ") || low.has_prefix("end voice ") {
    let id = if low.has_prefix("voice end ") {
      trimmed[10:].trim().to_owned()
    } else {
      trimmed[10:].trim().to_owned()
    }
    if id != "" {
      return Some(VoiceEnd(call_id=id))
    }
  }
  if low == "create teammate" || low == "create agent" {
    return Some(
      CreateTeammate(id="asst-1", name="Teammate", role="executor"),
    )
  }
  if low.has_prefix("create teammate ") || low.has_prefix("create agent ") {
    let rest = if low.has_prefix("create teammate ") {
      trimmed[16:].to_owned()
    } else {
      trimmed[13:].to_owned()
    }
    let id = match extract_kv(rest, "id") {
      Some(v) => v
      None => "asst-1"
    }
    let name = match extract_kv(rest, "name") {
      Some(v) => v
      None => id
    }
    let role = match extract_kv(rest, "role") {
      Some(v) => v
      None => "executor"
    }
    return Some(CreateTeammate(id~, name~, role~))
  }
  // CM-1403 sections collaboration partitions
  if low.has_prefix("add section ") || low.has_prefix("create section ") {
    let rest = if low.has_prefix("add section ") {
      trimmed[12:].to_owned()
    } else {
      trimmed[15:].to_owned()
    }
    let group_id = match extract_kv(rest, "group") {
      Some(v) => v
      None => "group-1"
    }
    let section_id = match extract_kv(rest, "id") {
      Some(v) => v
      None =>
        match extract_kv(rest, "section") {
          Some(v) => v
          None => ""
        }
    }
    let title = match extract_kv(rest, "title") {
      Some(v) => v
      None => section_id
    }
    if section_id != "" {
      return Some(AddSection(group_id~, section_id~, title~))
    }
  }
  if low.has_prefix("section post ") || low.has_prefix("post section ") {
    let rest = if low.has_prefix("section post ") {
      trimmed[13:].to_owned()
    } else {
      trimmed[13:].to_owned()
    }
    let group_id = match extract_kv(rest, "group") {
      Some(v) => v
      None => "group-1"
    }
    let section_id = match extract_kv(rest, "section") {
      Some(v) => v
      None =>
        match extract_kv(rest, "id") {
          Some(v) => v
          None => ""
        }
    }
    let from_agent = match extract_kv(rest, "from") {
      Some(v) => v
      None => "user"
    }
    let body = match extract_kv(rest, "body") {
      Some(v) => v
      None => ""
    }
    if section_id != "" && body != "" {
      return Some(SectionPost(group_id~, section_id~, from_agent~, body~))
    }
  }
  // join/leave room <name> → RoomTurn (Host room_turn fanout).
  if low.has_prefix("join room ") {
    let room = trimmed[10:].trim().to_owned()
    if room != "" {
      return Some(RoomTurn(room~, body="joined the room"))
    }
  }
  if low.has_prefix("leave room ") {
    let room = trimmed[11:].trim().to_owned()
    if room != "" {
      return Some(RoomTurn(room~, body="left the room"))
    }
  }
  // Product room phrasing: room / post to room / message room / send to room.
  // Prefer ` :: ` or `: `; else first token = room name, remainder = body.
  if low.has_prefix("room ") ||
    low.has_prefix("post to room ") ||
    low.has_prefix("post in room ") ||
    low.has_prefix("message room ") ||
    low.has_prefix("send to room ") ||
    low.has_prefix("send room message ") ||
    low.has_prefix("send room ") ||
    @teammates.has_room_cue(trimmed) {
    if @teammates.has_room_cue(trimmed) {
      match
        @teammates.open_room_turn_from_cue(
          cue_and_body=trimmed,
          speaker_id="user",
        ) {
        Ok(rt) => return Some(RoomTurn(room=rt.room_name, body=rt.body))
        Err(_) => ()
      }
    }
    let rest = if low.has_prefix("post to room ") {
      trimmed[13:].to_owned()
    } else if low.has_prefix("post in room ") {
      trimmed[13:].to_owned()
    } else if low.has_prefix("message room ") {
      trimmed[13:].to_owned()
    } else if low.has_prefix("send to room ") {
      trimmed[13:].to_owned()
    } else if low.has_prefix("send room message ") {
      trimmed[18:].to_owned()
    } else if low.has_prefix("send room ") {
      trimmed[10:].to_owned()
    } else if low.has_prefix("room turn ") {
      // Optional "room turn <name> …" product alias.
      trimmed[10:].to_owned()
    } else if low.has_prefix("room ") {
      trimmed[5:].to_owned()
    } else {
      ""
    }
    if rest != "" {
      match split_once(rest, " :: ") {
        Some((room, body)) => {
          let r = room.trim().to_owned()
          let b = body.trim().to_owned()
          if r != "" && b != "" {
            return Some(RoomTurn(room=r, body=b))
          }
        }
        None => ()
      }
      match split_once(rest, ": ") {
        Some((room, body)) => {
          let r = room.trim().to_owned()
          let b = body.trim().to_owned()
          // Avoid swallowing URLs / times — require a room token without spaces/colons.
          if r != "" && b != "" && !r.contains(" ") && !r.contains(":") {
            return Some(RoomTurn(room=r, body=b))
          }
        }
        None => ()
      }
      match split_once(rest.trim().to_owned(), " ") {
        Some((room, body)) => {
          let r = room.trim().to_owned()
          let b = body.trim().to_owned()
          if r != "" && b != "" {
            return Some(RoomTurn(room=r, body=b))
          }
        }
        None => ()
      }
    }
  }
  if low.has_prefix("send to agent ") || low.has_prefix("message agent ") {
    let rest = if low.has_prefix("send to agent ") {
      trimmed[14:].to_owned()
    } else {
      trimmed[14:].to_owned()
    }
    match split_once(rest, " :: ") {
      Some((to_id, body)) => {
        let t = to_id.trim().to_owned()
        let b = body.trim().to_owned()
        if t != "" && b != "" {
          return Some(SendToAgent(to_id=t, body=b))
        }
      }
      None => ()
    }
  }
  None
}

///|
/// ApprovalGate for consequential product effects (Grok-like).
/// Returns Some(result) when the turn should stop at approval/deny.
pub fn gate_consequential(
  user_text : String,
  turn_id : String,
  intent : TurnIntent,
  ctx : DesktopTurnContext,
  class_ : @security.ApprovalClass,
  summary : String,
  irreversible~ : Bool = false,
) -> DesktopTurnResult? {
  if ctx.approved {
    return None
  }
  let gate = @security.ApprovalGate::default()
  let req : @security.ApprovalRequest = {
    id: turn_id + "-gate",
    class_,
    summary,
    payload_json: "{\"text\":\"" + escape_json_string(user_text) + "\"}",
    irreversible,
  }
  match gate.review(req) {
    @security.Allow => None
    @security.Deny(reason~) =>
      Some(fail_turn(user_text, turn_id, intent, reason, ctx, assistant=reason))
    @security.NeedUser(reason~) => {
      let effect : DesktopEffect = {
        kind: "approval_card",
        command: class_.label() + " :: " + summary + " :: " + reason,
        needs_host_ffi: true,
      }
      Some(
        deliver_ok(
          user_text,
          turn_id,
          "Approval required (" +
          class_.label() +
          "): " +
          reason +
          ". Re-run with Host --approved after user confirms.",
          intent,
          ctx~,
          effects=[effect],
          needs_host_ffi=true,
        ),
      )
    }
    @security.Escalate => {
      let effect : DesktopEffect = {
        kind: "approval_card",
        command: class_.label() + " :: escalate :: " + summary,
        needs_host_ffi: true,
      }
      Some(
        deliver_ok(
          user_text,
          turn_id,
          "Escalated for approval: " + summary,
          intent,
          ctx~,
          effects=[effect],
          needs_host_ffi=true,
        ),
      )
    }
  }
}
