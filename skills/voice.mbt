///|
/// CM-2005: voice:<call> live call — second-assistant call; text relay;
/// on end write voice-calls/ JSON; reply only to voice address; summarize into app.

///|
pub fn voice_skill_name() -> String {
  "voice"
}

///|
/// One relayed text turn during a live voice call.
pub(all) struct VoiceRelayTurn {
  from_role : String
  text : String
} derive(Eq, Debug)

///|
pub extend VoiceRelayTurn with Eq::{equal, not_equal}

///|
pub extend VoiceRelayTurn with Debug::{to_repr}

///|
/// Live voice call session (second assistant on the call).
pub(all) struct VoiceCallSession {
  call_id : String
  /// voice:<call_id> — only valid reply target during the call.
  voice_address : String
  /// Second assistant participating on the call.
  second_assistant_id : String
  mut live : Bool
  relay_log : Array[VoiceRelayTurn]
  /// Path of JSON written on end under voice-calls/.
  mut ended_json_path : String?
  /// In-app summary after end (not sent to voice address).
  mut app_summary : String?
}

///|
/// Start a live voice:<call> session with a second assistant.
pub fn VoiceCallSession::start(
  call_id~ : String,
  second_assistant_id~ : String = "asst-voice-2",
) -> Result[VoiceCallSession, String] {
  if call_id.length() == 0 {
    return Err("voice call_id must not be empty")
  }
  if call_id.contains(":") || call_id.contains("/") {
    return Err("voice call_id must be a bare id")
  }
  Ok({
    call_id,
    voice_address: "voice:" + call_id,
    second_assistant_id,
    live: true,
    relay_log: [],
    ended_json_path: None,
    app_summary: None,
  })
}

///|
pub fn VoiceCallSession::is_live(self : VoiceCallSession) -> Bool {
  self.live
}

///|
/// CM-2005: during the call, outbound must target only the voice address.
pub fn VoiceCallSession::assert_reply_voice_only(
  self : VoiceCallSession,
  outbound_channel~ : String?,
) -> Result[Unit, String] {
  if !self.live {
    return Err("call already ended; do not reply on voice address")
  }
  match outbound_channel {
    None => Err("live voice call requires reply to voice address")
    Some(ch) =>
      if ch == self.voice_address || ch == "voice:" + self.call_id {
        Ok(())
      } else {
        Err(
          "live voice call: reply only to " + self.voice_address + "; got " + ch,
        )
      }
  }
}

///|
/// Text relay between assistants / user during the live call.
pub fn VoiceCallSession::relay_text(
  self : VoiceCallSession,
  from_role~ : String,
  text~ : String,
) -> Result[Unit, String] {
  if !self.live {
    return Err("cannot relay on ended call")
  }
  if text.length() == 0 {
    return Err("relay text must not be empty")
  }
  self.relay_log.push({ from_role, text, })
  Ok(())
}

///|
fn json_quote(s : String) -> String {
  // Kernel-contract: strip quote/backslash/newline from identifiers.
  let mut clean = ""
  let mut i = 0
  while i < s.length() {
    let c = s[i]
    if c != '"' && c != '\\' && c != '\n' && c != '\r' {
      clean = clean + s[i:i + 1].to_owned()
    } else {
      clean = clean + "_"
    }
    i = i + 1
  }
  "\"" + clean + "\""
}

///|
/// Build voice-calls/<call_id>.json body (kernel-contract mock FS string).
pub fn VoiceCallSession::build_end_json(self : VoiceCallSession) -> String {
  let sb = StringBuilder()
  sb.write_string("{")
  sb.write_string("\"call_id\":")
  sb.write_string(json_quote(self.call_id))
  sb.write_string(",\"voice_address\":")
  sb.write_string(json_quote(self.voice_address))
  sb.write_string(",\"second_assistant_id\":")
  sb.write_string(json_quote(self.second_assistant_id))
  sb.write_string(",\"relay_count\":")
  sb.write_string(self.relay_log.length().to_string())
  sb.write_string(",\"relays\":[")
  let mut i = 0
  while i < self.relay_log.length() {
    if i > 0 {
      sb.write_string(",")
    }
    let r = self.relay_log[i]
    sb.write_string("{\"from\":")
    sb.write_string(json_quote(r.from_role))
    sb.write_string(",\"text\":")
    sb.write_string(json_quote(r.text))
    sb.write_string("}")
    i = i + 1
  }
  sb.write_string("]}")
  sb.to_string()
}

///|
/// CM-2005: end call → write voice-calls/ JSON + in-app summary (not voice reply).
pub fn VoiceCallSession::end_and_summarize(
  self : VoiceCallSession,
) -> Result[(String, String), String] {
  if !self.live {
    return Err("call already ended")
  }
  self.live = false
  let json_body = self.build_end_json()
  let path = "voice-calls/" + self.call_id + ".json"
  if json_body.length() == 0 {
    return Err("voice-calls JSON must not be empty")
  }
  self.ended_json_path = Some(path)
  let summary = "Voice call " +
    self.call_id +
    " ended; " +
    self.relay_log.length().to_string() +
    " relay turns; second assistant " +
    self.second_assistant_id +
    "."
  self.app_summary = Some(summary)
  Ok((path, summary))
}

///|
/// True when a path is under the voice-calls/ artifact directory.
pub fn is_voice_calls_json_path(path : String) -> Bool {
  path.has_prefix("voice-calls/") && path.has_suffix(".json")
}
