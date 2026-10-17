///|
/// CM-2154: [agent] inbound / InboundKind::Agent — divert; do NOT answer as user question.
pub(all) enum InboundHandleResult {
  /// User question path — may answer / ack.
  AnswerAsUser(text~ : String)
  /// Agent/teammate divert — must not treat as user Q.
  DivertAgent(payload~ : String)
  /// Hidden / routine — silent path.
  DivertNonUser(kind~ : InboundKind, payload~ : String)
} derive(Eq, Debug)

///|
pub extend InboundHandleResult with Eq::{equal, not_equal}

///|
pub extend InboundHandleResult with Debug::{to_repr}

///|
pub fn InboundHandleResult::is_user_question(
  self : InboundHandleResult,
) -> Bool {
  match self {
    AnswerAsUser(_) => true
    DivertAgent(_) | DivertNonUser(_) => false
  }
}

///|
pub fn InboundHandleResult::answered_as_user(
  self : InboundHandleResult,
) -> Bool {
  self.is_user_question()
}

///|
fn strip_leading_ws_inbound(s : String) -> String {
  let mut i = 0
  while i < s.length() {
    let c = s[i]
    if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
      i = i + 1
    } else {
      break
    }
  }
  s[i:].to_owned()
}

///|
/// Detect `[agent]` / `[agent …]` cue prefix.
pub fn has_agent_cue(text : String) -> Bool {
  let t = strip_leading_ws_inbound(text)
  t.has_prefix("[agent]") || t.has_prefix("[agent ")
}

///|
/// Strip `[agent]` cue; return payload.
pub fn strip_agent_cue(text : String) -> String {
  let trimmed = strip_leading_ws_inbound(text)
  if trimmed.has_prefix("[agent]") {
    return strip_leading_ws_inbound(trimmed[7:].to_owned())
  }
  if trimmed.has_prefix("[agent ") {
    match trimmed.find("]") {
      None => trimmed
      Some(at) => strip_leading_ws_inbound(trimmed[at + 1:].to_owned())
    }
  } else {
    trimmed
  }
}

///|
/// CM-2154: classify and handle inbound — Agent divert never AnswerAsUser.
pub fn handle_inbound(
  kind~ : InboundKind,
  text~ : String,
) -> InboundHandleResult {
  if has_agent_cue(text) || kind is Agent {
    let payload = if has_agent_cue(text) { strip_agent_cue(text) } else { text }
    return DivertAgent(payload~)
  }
  match kind {
    User => AnswerAsUser(text~)
    Hidden | Routine => DivertNonUser(kind~, payload=text)
    Agent => DivertAgent(payload=text)
  }
}

///|
/// Open a turn from possibly agent-cued text; resolves kind to Agent when cue present.
pub fn open_turn_from_inbound(
  turn_id~ : String,
  text~ : String,
  kind~ : InboundKind = User,
) -> (TurnContext, InboundHandleResult) {
  let handled = handle_inbound(kind~, text~)
  let resolved_kind = match handled {
    DivertAgent(_) => Agent
    DivertNonUser(kind~, ..) => kind
    AnswerAsUser(_) => User
  }
  let visible = match handled {
    DivertAgent(payload~) => payload
    AnswerAsUser(text~) => text
    DivertNonUser(payload~, ..) => payload
  }
  let ctx = open_turn(turn_id~, text=visible, kind=resolved_kind)
  (ctx, handled)
}
