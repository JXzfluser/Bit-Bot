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
  if low == "list routines" || low == "routines" || low == "show routines" {
    return Some(ListRoutines)
  }
  if low.has_prefix("pause routine ") {
    let id = trimmed[14:].trim().to_owned()
    if id != "" {
      return Some(PauseRoutine(id~))
    }
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
      low.has_prefix("open mail ") {
    let thread_id = if low.has_prefix("read mail ") {
      trimmed[10:].trim().to_owned()
    } else if low.has_prefix("read thread ") {
      trimmed[12:].trim().to_owned()
    } else {
      trimmed[10:].trim().to_owned()
    }
    if thread_id != "" {
      return Some(ReadMailThread(thread_id~))
    }
  }
  // CM-1801 scheduling skill (before routine `schedule routine`).
  if low.has_prefix("schedule meeting ") ||
      low.has_prefix("calendar event ") ||
      low.has_prefix("schedule event ") {
    let rest = if low.has_prefix("schedule meeting ") {
      trimmed[17:].to_owned()
    } else if low.has_prefix("calendar event ") {
      trimmed[15:].to_owned()
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
      (low.has_prefix("buy ") &&
      (low.contains("target.com") ||
        low.contains("bestbuy") ||
        low.contains("costco") ||
        low.contains("ebay") ||
        low.contains("etsy") ||
        low.contains("instacart") ||
        low.contains("facebook"))) {
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
          Some(_) => {
            // body after dropping direct= flag via split
            match split_once(rest.trim().to_owned(), " ") {
              Some((_, t)) => t.trim().to_owned()
              None => rest.trim().to_owned()
            }
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
      low == "show credentials" {
    return Some(ListCredentials)
  }
  if low.has_prefix("fill credential ") || low.has_prefix("autofill login ") {
    let rest = if low.has_prefix("fill credential ") {
      trimmed[16:].to_owned()
    } else {
      trimmed[15:].to_owned()
    }
    let domain = match extract_kv(rest, "domain") {
      Some(v) => v
      None => rest.trim().to_owned()
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
      low == "doctor box" {
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
      low.has_prefix("open settings ") ||
      low.has_prefix("settings ") {
    let rest = if low.has_prefix("open settings ") {
      trimmed[14:].trim().to_owned()
    } else if low.has_prefix("settings ") {
      trimmed[9:].trim().to_owned()
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
      None =>
        if rest == "" {
          "agent-bit"
        } else {
          rest
        }
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
      low == "main sidebar agents" {
    return Some(ListAgentsSidebar)
  }
  if low.has_prefix("hide agent ") || low.has_prefix("unhide agent ") {
    let hidden = low.has_prefix("hide agent ")
    let rest = if hidden {
      trimmed[11:].trim().to_owned()
    } else {
      trimmed[13:].trim().to_owned()
    }
    let agent_id = match extract_kv(rest, "agent") {
      Some(v) => v.trim().to_owned()
      None => rest.trim().to_owned()
    }
    if agent_id != "" {
      return Some(HideAgent(agent_id~, hidden~))
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
      None =>
        if rest == "" {
          "asst-alpha"
        } else {
          rest
        }
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
  if low == "reset computer" || low == "reset bot computer" {
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
  // CM-2103 product Host markdown math + mermaid render.
  if low.has_prefix("render markdown ") ||
      low.has_prefix("render math ") ||
      low.has_prefix("markdown math ") {
    let body = if low.has_prefix("render markdown ") {
      trimmed[16:].to_owned()
    } else if low.has_prefix("render math ") {
      trimmed[12:].to_owned()
    } else {
      trimmed[14:].to_owned()
    }
    if body.trim().length() > 0 {
      return Some(RenderMarkdown(body=body.trim().to_owned()))
    }
  }
  // CM-2178 product Host missing-permission → Settings guide.
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
      low.has_prefix("open members ") ||
      low.has_prefix("members panel ") {
    let rest = if low.has_prefix("open members ") {
      trimmed[13:].trim().to_owned()
    } else if low.has_prefix("members panel ") {
      trimmed[14:].trim().to_owned()
    } else {
      ""
    }
    let group_id = match extract_kv(rest, "group") {
      Some(v) => v.trim().to_owned()
      None =>
        if rest == "" {
          "group-1"
        } else {
          rest
        }
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
        if t != "" && !t.has_prefix("via=") && !t.has_prefix("pm=") && !t.has_prefix("pkgs=") && !t.has_prefix("packages=") {
          tokens.push(t)
        }
      }
      if tokens.length() >= 2 {
        // First token may be pm if not already set via kv
        let first = tokens[0].to_lower()
        if first == "apt" || first == "npm" || first == "pip" || first == "cargo" {
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
  if low.has_prefix("structured chart ") ||
      low.has_prefix("make chart ") ||
      low.has_prefix("chart series ") ||
      low.has_prefix("generate chart ") {
    let series_json = if low.has_prefix("structured chart ") {
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
      low == "switch to browser identity" {
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
  if low.has_prefix("author skill ") {
    let rest = trimmed[13:].to_owned()
    let name = match extract_kv(rest, "name") {
      Some(v) => v
      None => "custom-skill"
    }
    let description = match extract_kv(rest, "description") {
      Some(v) => v
      None => "user authored skill"
    }
    let body = match extract_kv(rest, "body") {
      Some(v) => v
      None => "Follow steps carefully."
    }
    return Some(AuthorSkill(name~, description~, body~))
  }
  if low == "connect gmail" || low == "setup gmail" || low == "gmail connect" {
    return Some(ConnectGmail)
  }
  // Journal query before append — "journal query …" also matches "journal " prefix.
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
  if low.has_prefix("journal ") || low.has_prefix("append journal ") {
    let rest = if low.has_prefix("append journal ") {
      trimmed[15:].to_owned()
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
  if low.has_prefix("export bot template ") || low.has_prefix("export bot ") {
    let rest = if low.has_prefix("export bot template ") {
      trimmed[20:].to_owned()
    } else {
      trimmed[11:].to_owned()
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
  if low.has_prefix("create routine ") || low.has_prefix("schedule routine ") {
    let rest = if low.has_prefix("create routine ") {
      trimmed[15:].to_owned()
    } else {
      trimmed[17:].to_owned()
    }
    let id = match extract_kv(rest, "id") {
      Some(v) => v
      None => "routine-1"
    }
    let cron = match extract_kv(rest, "cron") {
      Some(v) => v
      None => "@daily"
    }
    let prompt = match extract_kv(rest, "prompt") {
      Some(v) => v
      None => rest
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
      Some((tool, args)) => {
        match split_once(tool, ".") {
          Some((ns, name)) =>
            return Some(
              McpCall(
                namespace_=ns,
                name~,
                args_json=args.trim().to_owned(),
              ),
            )
          None => ()
        }
      }
      None => ()
    }
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
      low == "phone tools" {
    return Some(DeviceTools)
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
  if low.has_prefix("load skill ") || low.has_prefix("use skill ") {
    let task = if low.has_prefix("load skill ") {
      trimmed[11:].trim().to_owned()
    } else {
      trimmed[10:].trim().to_owned()
    }
    if task != "" {
      return Some(LoadSkill(task~))
    }
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
  if low.has_prefix("room ") || @teammates.has_room_cue(trimmed) {
    if @teammates.has_room_cue(trimmed) {
      match @teammates.open_room_turn_from_cue(
        cue_and_body=trimmed,
        speaker_id="user",
      ) {
        Ok(rt) => return Some(RoomTurn(room=rt.room_name, body=rt.body))
        Err(_) => ()
      }
    }
    if low.has_prefix("room ") {
      let rest = trimmed[5:].to_owned()
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
