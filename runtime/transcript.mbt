///|
/// CM-2150: ReadTranscript — read own / child / other-assistant tool traces.

///|
pub(all) enum TranscriptScope {
  Own
  Child
  OtherAssistant
} derive(Eq, Debug)

///|
pub extend TranscriptScope with Eq::{equal, not_equal}

///|
pub extend TranscriptScope with Debug::{to_repr}

///|
pub fn TranscriptScope::label(self : TranscriptScope) -> String {
  match self {
    Own => "own"
    Child => "child"
    OtherAssistant => "other"
  }
}

///|
/// One recorded tool call inside a transcript.
pub(all) struct ToolCallTrace {
  tool_name : String
  args_json : String
  result_snippet : String
} derive(Eq, Debug)

///|
pub extend ToolCallTrace with Eq::{equal, not_equal}

///|
pub extend ToolCallTrace with Debug::{to_repr}

///|
pub(all) enum TranscriptEntryKind {
  AssistantText
  ToolCall
  SystemNote
} derive(Eq, Debug)

///|
pub extend TranscriptEntryKind with Eq::{equal, not_equal}

///|
pub extend TranscriptEntryKind with Debug::{to_repr}

///|
pub(all) struct TranscriptEntry {
  scope : TranscriptScope
  agent_id : String
  kind : TranscriptEntryKind
  tool_call : ToolCallTrace?
  text : String
} derive(Eq, Debug)

///|
pub extend TranscriptEntry with Eq::{equal, not_equal}

///|
pub extend TranscriptEntry with Debug::{to_repr}

///|
pub fn TranscriptEntry::is_tool_call(self : TranscriptEntry) -> Bool {
  match self.kind {
    ToolCall => true
    AssistantText | SystemNote => false
  }
}

///|
/// In-memory transcript store (kernel-contract mock).
pub(all) struct TranscriptStore {
  entries : Array[TranscriptEntry]
}

///|
pub fn TranscriptStore::new() -> TranscriptStore {
  { entries: [], }
}

///|
pub fn TranscriptStore::record_text(
  self : TranscriptStore,
  scope : TranscriptScope,
  agent_id~ : String,
  text~ : String,
) -> Unit {
  self.entries.push({
    scope,
    agent_id,
    kind: AssistantText,
    tool_call: None,
    text,
  })
}

///|
pub fn TranscriptStore::record_tool_call(
  self : TranscriptStore,
  scope : TranscriptScope,
  agent_id~ : String,
  tool_name~ : String,
  args_json~ : String,
  result_snippet~ : String,
) -> Unit {
  self.entries.push({
    scope,
    agent_id,
    kind: ToolCall,
    tool_call: Some({ tool_name, args_json, result_snippet, }),
    text: "",
  })
}

///|
/// CM-2150: ReadTranscript for a scope — must include tool call traces.
pub fn TranscriptStore::read_transcript(
  self : TranscriptStore,
  scope : TranscriptScope,
  agent_id~ : String? = None,
) -> Array[TranscriptEntry] {
  let out : Array[TranscriptEntry] = []
  for e in self.entries {
    let scope_ok = e.scope == scope
    let id_ok = match agent_id {
      None => true
      Some(id) => e.agent_id == id
    }
    if scope_ok && id_ok {
      out.push(e)
    }
  }
  out
}

///|
/// True when the read result contains at least one tool call.
pub fn transcript_includes_tool_calls(entries : Array[TranscriptEntry]) -> Bool {
  for e in entries {
    if e.is_tool_call() {
      return true
    }
  }
  false
}

///|
/// Audit helper: read own/child/other and require tool calls present for audit need.
pub fn read_transcript_for_audit(
  store : TranscriptStore,
  scope : TranscriptScope,
  agent_id~ : String,
) -> Result[Array[TranscriptEntry], String] {
  let entries = store.read_transcript(scope, agent_id=Some(agent_id))
  if entries.length() == 0 {
    return Err("transcript empty for audit")
  }
  if !transcript_includes_tool_calls(entries) {
    return Err("ReadTranscript must include tool calls for audit")
  }
  Ok(entries)
}
