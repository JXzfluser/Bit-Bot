///|
/// CM-0107: SendToUser voice_memo=true — spoken complete sentences, no markdown lists;
/// silent until the first voice memo is delivered.

///|
/// Result of a voice-memo delivery attempt.
pub(all) struct VoiceMemoDelivery {
  turn_id : String
  spoken_text : String
  voice_memo : Bool
} derive(Eq, Debug)

///|
pub extend VoiceMemoDelivery with Eq::{equal, not_equal}

///|
pub extend VoiceMemoDelivery with Debug::{to_repr}

///|
fn line_is_markdown_list_item(line : String) -> Bool {
  let mut i = 0
  while i < line.length() {
    let c = line[i]
    if c == ' ' || c == '\t' {
      i = i + 1
    } else {
      break
    }
  }
  if i >= line.length() {
    return false
  }
  let rest = line[i:].to_owned()
  if rest.has_prefix("- ") || rest.has_prefix("* ") || rest.has_prefix("+ ") {
    return true
  }
  // numbered list: "1. " / "12. "
  let mut j = 0
  while j < rest.length() {
    let c = rest[j]
    if c >= '0' && c <= '9' {
      j = j + 1
    } else {
      break
    }
  }
  j > 0 && j + 1 < rest.length() && rest[j] == '.' && rest[j + 1] == ' '
}

///|
/// True when body is spoken-sentence style: non-empty, no markdown list lines.
pub fn is_spoken_sentence_style(body : String) -> Bool {
  if body.length() == 0 {
    return false
  }
  let mut start = 0
  let n = body.length()
  while start <= n {
    let mut end = start
    while end < n && body[end] != '\n' {
      end = end + 1
    }
    let line = body[start:end].to_owned()
    if line_is_markdown_list_item(line) {
      return false
    }
    if end >= n {
      break
    }
    start = end + 1
  }
  true
}

///|
/// CM-0107: before any voice_memo, the turn must stay silent (no outbound).
pub fn TurnContext::is_silent_before_voice_memo(self : TurnContext) -> Bool {
  self.outbound.length() == 0
}

///|
/// CM-0107: deliver a voice memo — spoken complete sentences only; voice_memo=true.
pub fn TurnContext::deliver_voice_memo(
  self : TurnContext,
  spoken_text~ : String,
  audio_path~ : String = "/workspace/fixtures/voice/memo.wav",
) -> Result[(TurnContext, VoiceMemoDelivery), String] {
  guard !(self.phase is Ended) else { Err("turn ended") }
  guard is_spoken_sentence_style(spoken_text) else {
    Err("voice_memo requires spoken complete sentences without markdown lists")
  }
  let env = @ui_protocol.SendEnvelope::{
    turn_id: self.turn_id.value,
    parts: [@ui_protocol.Voice(audio_path~, transcript=Some(spoken_text))],
    channel_hint: None,
  }
  let next = { ..self, phase: Working, outbound: self.outbound + [env], }
  let delivery = { turn_id: self.turn_id.value, spoken_text, voice_memo: true, }
  Ok((next, delivery))
}

///|
/// CM-0107 helper: count Voice parts across outbound envelopes.
pub fn TurnContext::voice_memo_count(self : TurnContext) -> Int32 {
  let mut n = 0
  for env in self.outbound {
    for p in env.parts {
      match p {
        @ui_protocol.Voice(_) => n = n + 1
        _ => ()
      }
    }
  }
  n
}
