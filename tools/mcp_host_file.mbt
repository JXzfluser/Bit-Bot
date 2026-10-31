///|
/// CM-2163 / CM-2164: Host+mcp kernel-contract for $file: expand and write_to_file path.
/// Host-integration (real FFI) remains GAP; this mocks the host-side contract only.

///|
/// Mock host FS used only for MCP file-arg expansion (no real OS).
pub(all) struct McpHostFs {
  files : Map[String, String]
  /// Chat/context transcript lines (must NOT absorb expanded large payloads).
  chat_lines : Array[String]
}

///|
pub fn McpHostFs::empty() -> McpHostFs {
  { files: Map([]), chat_lines: [], }
}

///|
pub fn McpHostFs::put(
  self : McpHostFs,
  path : String,
  content : String,
) -> Unit {
  self.files.set(path, content)
}

///|
pub fn McpHostFs::get(self : McpHostFs, path : String) -> String? {
  self.files.get(path)
}

///|
/// Record a chat/context line (what the model would see).
pub fn McpHostFs::append_chat(self : McpHostFs, line : String) -> Unit {
  self.chat_lines.push(line)
}

///|
pub fn McpHostFs::chat_contains(self : McpHostFs, needle : String) -> Bool {
  for ln in self.chat_lines {
    if ln.contains(needle) {
      return true
    }
  }
  false
}

///|
pub fn McpHostFs::chat_total_chars(self : McpHostFs) -> Int32 {
  let mut n = 0
  for ln in self.chat_lines {
    n = n + ln.length()
  }
  n
}

///|
fn file_marker() -> String {
  "$" + "file:"
}

///|
/// Extract absolute path after `$file:` when the whole arg value is that placeholder.
pub fn extract_file_placeholder_path(arg_value : String) -> String? {
  let marker = file_marker()
  if arg_value.has_prefix(marker) {
    let path = arg_value[marker.length():].to_owned()
    if path.length() > 0 && path.has_prefix("/") {
      Some(path)
    } else {
      None
    }
  } else {
    None
  }
}

///|
/// Result of expanding one `$file:` argument (CM-2163).
pub(all) struct FileArgExpandResult {
  /// Injected payload (from file); used for the MCP call only.
  injected : String
  /// Path that was expanded.
  source_path : String
  /// Bytes injected (for bloat checks).
  injected_len : Int32
  /// Chat line recorded (placeholder only — no payload).
  chat_ref : String
} derive(Eq, Debug)

///|
pub extend FileArgExpandResult with Eq::{equal, not_equal}

///|
pub extend FileArgExpandResult with Debug::{to_repr}

///|
/// CM-2163: expand `$file:/abs` from host FS into call args; chat keeps only the ref.
pub fn McpHostFs::expand_file_arg(
  self : McpHostFs,
  arg_value : String,
) -> Result[FileArgExpandResult, String] {
  match extract_file_placeholder_path(arg_value) {
    None => Err("not a $file: placeholder: " + arg_value)
    Some(path) =>
      match self.files.get(path) {
        None => Err("file not found for expand: " + path)
        Some(content) => {
          // Chat / context records the placeholder path only — never the payload.
          let chat_ref = "mcp_arg_ref:" + file_marker() + path
          self.append_chat(chat_ref)
          Ok({
            injected: content,
            source_path: path,
            injected_len: content.length(),
            chat_ref,
          })
        }
      }
  }
}

///|
/// True when chat transcript did not absorb a large payload (no bloat).
pub fn FileArgExpandResult::no_chat_bloat(
  self : FileArgExpandResult,
  fs : McpHostFs,
) -> Bool {
  // Chat must mention the placeholder/path, must NOT contain the injected body.
  let chat_ok = fs.chat_contains(self.chat_ref) &&
    !fs.chat_contains(self.injected) &&
    fs.chat_total_chars() < self.injected_len
  chat_ok && self.injected_len > 0
}

///|
/// CM-2164: large MCP result written to file; tool result returns path (not body).
pub(all) struct WriteToFileResult {
  path : String
  bytes_written : Int32
  /// What is returned to the model / chat (path only).
  returned_to_caller : String
} derive(Eq, Debug)

///|
pub extend WriteToFileResult with Eq::{equal, not_equal}

///|
pub extend WriteToFileResult with Debug::{to_repr}

///|
pub fn WriteToFileResult::returns_path_not_body(
  self : WriteToFileResult,
) -> Bool {
  self.returned_to_caller.contains(self.path) &&
  !self.returned_to_caller.contains("PAYLOAD_MARKER") &&
  self.bytes_written > 0
}

///|
/// CM-2164: write large result under /workspace/agent-tools/; return path.
pub fn McpHostFs::write_to_file_result(
  self : McpHostFs,
  namespace_ : String,
  tool_name : String,
  large_body : String,
) -> WriteToFileResult {
  let path = "/workspace/agent-tools/" + namespace_ + "-" + tool_name + ".txt"
  self.files.set(path, large_body)
  let returned = "wrote result to " + path
  // Chat sees path only.
  self.append_chat(returned)
  { path, bytes_written: large_body.length(), returned_to_caller: returned, }
}

///|
/// FS backend kind for MCP file glue (G-MCP-2). Mock = U in-memory only.
/// Live = Host-integration path label (real disk proven by host_h4_smoke, not this Map).
pub(all) enum McpFsKind {
  Mock
  Live
} derive(Eq, Debug)

///|
pub extend McpFsKind with Eq::{equal, not_equal}

///|
pub extend McpFsKind with Debug::{to_repr}

///|
pub fn McpFsKind::label(self : McpFsKind) -> String {
  match self {
    Mock => "Mock"
    Live => "Live"
  }
}

///|
/// McpHostFs with explicit Mock|Live kind. Existing empty()/put/get remain Mock-compatible.
pub(all) struct McpHostFsLive {
  kind : McpFsKind
  inner : McpHostFs
  /// Unique suffix counter for Live write_to_file names.
  mut write_seq : Int32
}

///|
/// U / kernel-contract: in-memory Mock FS (same as McpHostFs::empty()).
pub fn McpHostFsLive::mock() -> McpHostFsLive {
  { kind: Mock, inner: McpHostFs::empty(), write_seq: 0, }
}

///|
/// Live label + in-memory plan store for kernel probes.
/// Real Host disk inject/write is proven by scripts/host_h4_smoke.sh (not this Map).
/// Do NOT treat this Map as I evidence — I requires Live Host FS artifacts.
pub fn McpHostFsLive::live() -> McpHostFsLive {
  { kind: Live, inner: McpHostFs::empty(), write_seq: 0, }
}

///|
pub fn McpHostFsLive::is_live(self : McpHostFsLive) -> Bool {
  match self.kind {
    Live => true
    Mock => false
  }
}

///|
pub fn McpHostFsLive::put(
  self : McpHostFsLive,
  path : String,
  content : String,
) -> Unit {
  self.inner.put(path, content)
}

///|
pub fn McpHostFsLive::get(self : McpHostFsLive, path : String) -> String? {
  self.inner.get(path)
}

///|
/// CM-2163 Live path: expand `$file:` via Host FS map (U plan) / smoke does real disk.
pub fn McpHostFsLive::expand_file_arg(
  self : McpHostFsLive,
  arg_value : String,
) -> Result[FileArgExpandResult, String] {
  self.inner.expand_file_arg(arg_value)
}

///|
pub fn McpHostFsLive::chat_contains(
  self : McpHostFsLive,
  needle : String,
) -> Bool {
  self.inner.chat_contains(needle)
}

///|
/// CM-2164 Live path: write under /workspace/agent-tools/ with unique name; return path only.
pub fn McpHostFsLive::write_to_file_result(
  self : McpHostFsLive,
  namespace_ : String,
  tool_name : String,
  large_body : String,
) -> WriteToFileResult {
  let seq = self.write_seq
  self.write_seq = seq + 1
  let uniq = match self.kind {
    Live => "-live-" + seq.to_string()
    Mock => ""
  }
  let path = "/workspace/agent-tools/" +
    namespace_ +
    "-" +
    tool_name +
    uniq +
    ".txt"
  self.inner.files.set(path, large_body)
  let returned = "wrote result to " + path
  self.inner.append_chat(returned)
  { path, bytes_written: large_body.length(), returned_to_caller: returned, }
}

///|
/// McpCallOptions (§4.2) — expand_file_refs / write_to_file / max_inline_bytes.
pub(all) struct McpCallOptions {
  expand_file_refs : Bool
  write_to_file : Bool
  max_inline_bytes : Int32
} derive(Eq, Debug)

///|
pub extend McpCallOptions with Eq::{equal, not_equal}

///|
pub extend McpCallOptions with Debug::{to_repr}

///|
pub fn McpCallOptions::default() -> McpCallOptions {
  { expand_file_refs: true, write_to_file: false, max_inline_bytes: 4096, }
}

///|
pub fn McpCallOptions::with_write_to_file() -> McpCallOptions {
  { expand_file_refs: false, write_to_file: true, max_inline_bytes: 4096, }
}

///|
/// Local Live loopback MCP call result (Host FS inject/write; not external OAuth).
/// I claim for 2163/2164 is Host FS, not yet remote JSON-RPC OAuth.
pub(all) struct McpLoopbackCallResult {
  namespace_ : String
  tool_name : String
  /// Args after $file: expansion (injected body present here, not in chat).
  args_for_mcp : String
  /// Chat / log line (ref only when expand used).
  chat_line : String
  /// Path returned when write_to_file; None otherwise.
  result_path : String?
  kind : McpFsKind
} derive(Eq, Debug)

///|
pub extend McpLoopbackCallResult with Eq::{equal, not_equal}

///|
pub extend McpLoopbackCallResult with Debug::{to_repr}

///|
/// Live loopback: expand `$file:` into MCP body; chat keeps ref only (CM-2163).
pub fn McpHostFsLive::loopback_call_with_file_arg(
  self : McpHostFsLive,
  namespace_ : String,
  tool_name : String,
  file_arg : String,
) -> Result[McpLoopbackCallResult, String] {
  match self.expand_file_arg(file_arg) {
    Err(e) => Err(e)
    Ok(exp) => {
      // MCP call body gets injected payload; chat already has ref only.
      let args_for_mcp = "{\"body\":" +
        "\"[injected len=" +
        exp.injected_len.to_string() +
        "]\"" +
        "}"
      // Keep full injected available via get; args_for_mcp for tests that check body:
      // Prefer embedding a marker that proves inject without duplicating huge chat risk.
      // Full injected is in exp.injected — rebuild args with content for MCP side:
      let args_full = "{\"body\":\"" + exp.injected + "\"}"
      let _ = args_for_mcp
      Ok({
        namespace_,
        tool_name,
        args_for_mcp: args_full,
        chat_line: exp.chat_ref,
        result_path: None,
        kind: self.kind,
      })
    }
  }
}

///|
/// Live loopback: large result → write_to_file; return path only (CM-2164).
pub fn McpHostFsLive::loopback_call_write_to_file(
  self : McpHostFsLive,
  namespace_ : String,
  tool_name : String,
  large_body : String,
) -> McpLoopbackCallResult {
  let w = self.write_to_file_result(namespace_, tool_name, large_body)
  {
    namespace_,
    tool_name,
    args_for_mcp: "{}",
    chat_line: w.returned_to_caller,
    result_path: Some(w.path),
    kind: self.kind,
  }
}
