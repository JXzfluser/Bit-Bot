///|
/// CM-0406: Slack event kinds for listener shapes.
pub(all) enum SlackEventKind {
  Mention
  Keyword
  Message
  Reaction
} derive(Eq, Debug)

///|
pub extend SlackEventKind with Eq::{equal, not_equal}

///|
pub extend SlackEventKind with Debug::{to_repr}

///|
pub fn SlackEventKind::label(self : SlackEventKind) -> String {
  match self {
    Mention => "mention"
    Keyword => "keyword"
    Message => "message"
    Reaction => "reaction"
  }
}

///|
/// CM-0406: channel selector — channel id, #name, @user, or *.
pub fn validate_slack_channel_selector(sel : String) -> Result[Unit, String] {
  if sel.length() == 0 {
    return Err("channel selector must not be empty")
  }
  if sel == "*" {
    return Ok(())
  }
  if sel.has_prefix("#") || sel.has_prefix("@") {
    if sel.length() < 2 {
      return Err("channel selector #/@ needs a name")
    }
    return Ok(())
  }
  // Bare Slack channel id (C…) or other non-empty id.
  if sel[0] == 'C' || sel[0] == 'G' || sel[0] == 'D' {
    return Ok(())
  }
  Err("invalid Slack channel selector (use C… / #name / @user / *)")
}

///|
/// CM-0406: listener shape — event + channel selector + invite status.
pub(all) struct SlackListenerShape {
  event : SlackEventKind
  channel_selector : String
  invited : Bool
  keyword : String?
} derive(Eq, Debug)

///|
pub extend SlackListenerShape with Eq::{equal, not_equal}

///|
pub extend SlackListenerShape with Debug::{to_repr}

///|
/// CM-0406: validate listener shape; keyword event requires keyword.
pub fn validate_slack_listener(
  shape : SlackListenerShape,
) -> Result[Unit, String] {
  match validate_slack_channel_selector(shape.channel_selector) {
    Err(e) => return Err(e)
    Ok(_) => ()
  }
  match shape.event {
    Keyword =>
      match shape.keyword {
        None => Err("keyword event requires keyword filter")
        Some(k) =>
          if k.length() == 0 {
            Err("keyword must not be empty")
          } else {
            Ok(())
          }
      }
    Mention | Message | Reaction => Ok(())
  }
}

///|
/// CM-0406: when not invited, prompt must include /invite.
pub fn slack_invite_prompt(shape : SlackListenerShape) -> String? {
  if shape.invited {
    None
  } else {
    Some(
      "Bot is not in " +
      shape.channel_selector +
      "; please /invite the bot to that channel",
    )
  }
}

///|
/// CM-0406: validate + produce invite hint when needed.
pub fn prepare_slack_listener(
  shape : SlackListenerShape,
) -> Result[String?, String] {
  match validate_slack_listener(shape) {
    Err(e) => Err(e)
    Ok(_) => Ok(slack_invite_prompt(shape))
  }
}

///|
/// CM-0407: GitHub event kinds.
pub(all) enum GithubEventKind {
  Pr
  Ci
  Review
} derive(Eq, Debug)

///|
pub extend GithubEventKind with Eq::{equal, not_equal}

///|
pub extend GithubEventKind with Debug::{to_repr}

///|
pub fn GithubEventKind::label(self : GithubEventKind) -> String {
  match self {
    Pr => "pr"
    Ci => "ci"
    Review => "review"
  }
}

///|
/// Terminal PR states that auto-delete the babysit listener.
pub(all) enum PrTerminalState {
  Merged
  Closed
  Open
} derive(Eq, Debug)

///|
pub extend PrTerminalState with Eq::{equal, not_equal}

///|
pub extend PrTerminalState with Debug::{to_repr}

///|
pub fn PrTerminalState::is_terminal(self : PrTerminalState) -> Bool {
  match self {
    Merged | Closed => true
    Open => false
  }
}

///|
/// CM-0407: GitHub listener with optional PR scope + user allowlist.
pub(all) struct GithubListenerShape {
  event : GithubEventKind
  pr_scope : String?
  user_allowlist : Array[String]
} derive(Eq, Debug)

///|
pub extend GithubListenerShape with Eq::{equal, not_equal}

///|
pub extend GithubListenerShape with Debug::{to_repr}

///|
pub fn validate_github_listener(
  shape : GithubListenerShape,
) -> Result[Unit, String] {
  match shape.event {
    Pr =>
      match shape.pr_scope {
        None => Err("pr event requires pr_scope")
        Some(s) =>
          if s.length() == 0 {
            Err("pr_scope must not be empty")
          } else {
            Ok(())
          }
      }
    Ci | Review => Ok(())
  }
}

///|
/// CM-0407: default PR babysit package — RoutineSpec ready to create.
pub fn pr_babysit_default_package(
  routine_id~ : String,
  pr_ref~ : String,
) -> RoutineSpec {
  {
    id: routine_id,
    name: "PR babysit " + pr_ref,
    prompt: "Babysit " +
    pr_ref +
    "\nDestination: in-app chat; if no updates, stay silent.",
    trigger: Event(name="github:pr:" + pr_ref),
    timing: Exact,
    enabled: true,
    early_minutes: 0,
    late_minutes: 0,
  }
}

///|
/// CM-0407: on terminal PR state, auto-delete the listener/routine from store.
pub fn RoutineStore::handle_pr_terminal(
  self : RoutineStore,
  id : String,
  state : PrTerminalState,
) -> Result[Bool, String] {
  if !state.is_terminal() {
    return Ok(false)
  }
  match self.find_index(id) {
    None => Err("routine not found: " + id)
    Some(i) => {
      // Remove by rebuilding without index i.
      let new_specs : Array[RoutineSpec] = []
      let new_lives : Array[Lifecycle] = []
      let mut j = 0
      while j < self.specs.length() {
        if j != i {
          new_specs.push(self.specs[j])
          new_lives.push(self.lifecycles[j])
        }
        j = j + 1
      }
      // Clear and repush (Array has no clear in all versions — mutate length via replace).
      while self.specs.length() > 0 {
        let _ = self.specs.pop()
      }
      while self.lifecycles.length() > 0 {
        let _ = self.lifecycles.pop()
      }
      for s in new_specs {
        self.specs.push(s)
      }
      for l in new_lives {
        self.lifecycles.push(l)
      }
      Ok(true)
    }
  }
}

///|
/// CM-0408: Origin repo kind — native only; mirrors rejected.
pub(all) enum OriginRepoKind {
  Native
  Mirror
} derive(Eq, Debug)

///|
pub extend OriginRepoKind with Eq::{equal, not_equal}

///|
pub extend OriginRepoKind with Debug::{to_repr}

///|
/// CM-0408: Origin event kinds (PR / CI / review).
pub(all) enum OriginEventKind {
  Pr
  Ci
  Review
} derive(Eq, Debug)

///|
pub extend OriginEventKind with Eq::{equal, not_equal}

///|
pub extend OriginEventKind with Debug::{to_repr}

///|
pub fn OriginEventKind::label(self : OriginEventKind) -> String {
  match self {
    Pr => "pr"
    Ci => "ci"
    Review => "review"
  }
}

///|
/// CM-0408: Origin listener — native repos only; CI requires pr scope.
pub(all) struct OriginListenerShape {
  event : OriginEventKind
  repo : String
  repo_kind : OriginRepoKind
  pr_scope : String?
} derive(Eq, Debug)

///|
pub extend OriginListenerShape with Eq::{equal, not_equal}

///|
pub extend OriginListenerShape with Debug::{to_repr}

///|
/// CM-0408: validate Origin listener — reject mirror; CI needs pr.
pub fn validate_origin_listener(
  shape : OriginListenerShape,
) -> Result[Unit, String] {
  if shape.repo.length() == 0 {
    return Err("origin repo must not be empty")
  }
  match shape.repo_kind {
    Mirror =>
      return Err("origin rejects mirror repos; native Origin repos only")
    Native => ()
  }
  match shape.event {
    Ci =>
      match shape.pr_scope {
        None => Err("origin CI event requires pr scope")
        Some(s) =>
          if s.length() == 0 {
            Err("origin CI pr_scope must not be empty")
          } else {
            Ok(())
          }
      }
    Pr =>
      match shape.pr_scope {
        None => Err("origin pr event requires pr_scope")
        Some(s) =>
          if s.length() == 0 {
            Err("pr_scope must not be empty")
          } else {
            Ok(())
          }
      }
    Review => Ok(())
  }
}

///|
/// CM-0410: mail inbox listener with optional +tag filter.
pub(all) struct MailInboxListener {
  tag_filter : String?
} derive(Eq, Debug)

///|
pub extend MailInboxListener with Eq::{equal, not_equal}

///|
pub extend MailInboxListener with Debug::{to_repr}

///|
/// CM-0410: wake carries headers only — never the body.
pub(all) struct MailWakeHeaders {
  message_id : String
  thread_id : String
  from_address : String
  to_address : String
  subject : String
  tags : Array[String]
} derive(Eq, Debug)

///|
pub extend MailWakeHeaders with Eq::{equal, not_equal}

///|
pub extend MailWakeHeaders with Debug::{to_repr}

///|
fn tag_matches(filter : String?, tags : Array[String]) -> Bool {
  match filter {
    None => true
    Some(f) => {
      let want = if f.has_prefix("+") { f[1:].to_owned() } else { f }
      if want.length() == 0 {
        return true
      }
      for t in tags {
        let got = if t.has_prefix("+") { t[1:].to_owned() } else { t }
        if got == want {
          return true
        }
      }
      false
    }
  }
}

///|
/// CM-0410: Grok Bot inbox arrival → wake with headers only (+tag filter).
pub fn mail_inbox_wake(
  listener : MailInboxListener,
  headers : MailWakeHeaders,
) -> Result[MailWakeHeaders, String] {
  if !tag_matches(listener.tag_filter, headers.tags) {
    return Err("mail wake filtered out by +tag")
  }
  Ok(headers)
}

///|
/// CM-0410: serialize wake payload — headers only, no body.
pub fn mail_wake_payload(headers : MailWakeHeaders) -> String {
  "mail_wake message_id=" +
  headers.message_id +
  " thread_id=" +
  headers.thread_id +
  " from=" +
  headers.from_address +
  " to=" +
  headers.to_address +
  " subject=" +
  headers.subject
}

///|
/// True when a wake payload wrongly embeds a body (must stay false).
pub fn mail_wake_payload_leaks_body(payload : String, body : String) -> Bool {
  if body.length() == 0 {
    false
  } else {
    payload.contains(body)
  }
}

///|
/// CM-0411: webhook URL + key shown on user panel; key opaque to tools.
pub(all) struct WebhookPanelSecrets {
  url : String
  /// Opaque; never returned by assistant tool-read.
  key : String
} derive(Eq, Debug)

///|
pub extend WebhookPanelSecrets with Eq::{equal, not_equal}

///|
pub extend WebhookPanelSecrets with Debug::{to_repr}

///|
pub fn WebhookPanelSecrets::new(
  url~ : String,
  key~ : String,
) -> WebhookPanelSecrets {
  { url, key, }
}

///|
/// User copies URL/key from the panel (allowed).
pub fn WebhookPanelSecrets::user_copy_url(self : WebhookPanelSecrets) -> String {
  self.url
}

///|
pub fn WebhookPanelSecrets::user_copy_key(self : WebhookPanelSecrets) -> String {
  self.key
}

///|
/// CM-0411: assistant cannot tool-read the webhook key.
pub fn WebhookPanelSecrets::assistant_tool_read_key(
  self : WebhookPanelSecrets,
) -> Result[String, String] {
  let _ = self
  Err("webhook key is opaque; assistant cannot tool-read key")
}

///|
/// CM-0411: external POST wake carries <webhook_event> … </webhook_event>.
pub fn webhook_wake_payload(event_id~ : String, summary~ : String) -> String {
  "<webhook_event id=\"" + event_id + "\">" + summary + "</webhook_event>"
}

///|
pub fn webhook_wake_has_event_tag(payload : String) -> Bool {
  payload.contains("<webhook_event") && payload.contains("</webhook_event>")
}

///|
/// CM-0412: one path in a group listener (OR semantics).
pub(all) enum GroupListenerPath {
  Slack(selector~ : String)
  Github(pr_ref~ : String)
  Origin(repo~ : String)
  Cron(expr~ : String)
  Event(name~ : String)
  Mail(tag~ : String)
  Webhook
} derive(Eq, Debug)

///|
pub extend GroupListenerPath with Eq::{equal, not_equal}

///|
pub extend GroupListenerPath with Debug::{to_repr}

///|
/// CM-0412: group of listeners — any matching path wakes the same prompt.
pub(all) struct GroupListener {
  prompt : String
  paths : Array[GroupListenerPath]
} derive(Eq, Debug)

///|
pub extend GroupListener with Eq::{equal, not_equal}

///|
pub extend GroupListener with Debug::{to_repr}

///|
pub fn GroupListener::new(
  prompt~ : String,
  paths~ : Array[GroupListenerPath],
) -> GroupListener {
  { prompt, paths, }
}

///|
/// Cron may join a group (CM-0412).
pub fn GroupListener::allows_cron(self : GroupListener) -> Bool {
  for p in self.paths {
    match p {
      Cron(_) => return true
      _ => ()
    }
  }
  false
}

///|
fn path_matches(a : GroupListenerPath, b : GroupListenerPath) -> Bool {
  match (a, b) {
    (Slack(selector=s1), Slack(selector=s2)) => s1 == s2
    (Github(pr_ref=p1), Github(pr_ref=p2)) => p1 == p2
    (Origin(repo=r1), Origin(repo=r2)) => r1 == r2
    (Cron(expr=e1), Cron(expr=e2)) => e1 == e2
    (Event(name=n1), Event(name=n2)) => n1 == n2
    (Mail(tag=t1), Mail(tag=t2)) => t1 == t2
    (Webhook, Webhook) => true
    _ => false
  }
}

///|
/// CM-0412: OR — any matching path wakes with the same prompt.
pub fn GroupListener::wake_on(
  self : GroupListener,
  fired : GroupListenerPath,
) -> String? {
  for p in self.paths {
    if path_matches(p, fired) {
      return Some(self.prompt)
    }
  }
  None
}
