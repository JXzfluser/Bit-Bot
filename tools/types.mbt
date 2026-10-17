///|
/// Built-in tool identifiers mirroring the Grok Bot host surface.
/// Add constructors when new host tools ship; keep names stable.
pub(all) enum BuiltinTool {
  Shell
  Read
  AwaitShell
  CopyToBox
  CopyFromBox
  UploadFile
  DownloadFile
  WebSearch
  WebFetch
  ListMachines
  GetDynamicTools
  CallDynamicTool
  ClaimEmailInbox
  ListEmailInboxes
  CheckEmailInboxAvailability
  SearchEmailThreads
  ReadEmailThread
  ReadEmailAttachment
  DraftExternalMessage
  SendToUser
  WakeParent
} derive(Eq, Debug)

///|
pub extend BuiltinTool with Eq::{not_equal, equal}

///|
pub extend BuiltinTool with Debug::{to_repr}

///|
pub fn BuiltinTool::name(self : BuiltinTool) -> String {
  match self {
    Shell => "Shell"
    Read => "Read"
    AwaitShell => "AwaitShell"
    CopyToBox => "CopyToBox"
    CopyFromBox => "CopyFromBox"
    UploadFile => "UploadFile"
    DownloadFile => "DownloadFile"
    WebSearch => "WebSearch"
    WebFetch => "WebFetch"
    ListMachines => "ListMachines"
    GetDynamicTools => "GetDynamicTools"
    CallDynamicTool => "CallDynamicTool"
    ClaimEmailInbox => "ClaimEmailInbox"
    ListEmailInboxes => "ListEmailInboxes"
    CheckEmailInboxAvailability => "CheckEmailInboxAvailability"
    SearchEmailThreads => "SearchEmailThreads"
    ReadEmailThread => "ReadEmailThread"
    ReadEmailAttachment => "ReadEmailAttachment"
    DraftExternalMessage => "DraftExternalMessage"
    SendToUser => "SendToUser"
    WakeParent => "WakeParent"
  }
}

///|
/// Full catalog of built-in tools for registry seeding.
pub fn BuiltinTool::all() -> Array[BuiltinTool] {
  [
    Shell,
    Read,
    AwaitShell,
    CopyToBox,
    CopyFromBox,
    UploadFile,
    DownloadFile,
    WebSearch,
    WebFetch,
    ListMachines,
    GetDynamicTools,
    CallDynamicTool,
    ClaimEmailInbox,
    ListEmailInboxes,
    CheckEmailInboxAvailability,
    SearchEmailThreads,
    ReadEmailThread,
    ReadEmailAttachment,
    DraftExternalMessage,
    SendToUser,
    WakeParent,
  ]
}

///|
pub(all) struct ToolSpec {
  id : String
  description : String
  builtin : BuiltinTool?
  input_schema_json : String
  requires_approval : Bool
} derive(Eq, Debug)

///|
pub extend ToolSpec with Eq::{not_equal, equal}

///|
pub extend ToolSpec with Debug::{to_repr}

///|
pub(all) enum ToolResult {
  Ok(output~ : String)
  Err(message~ : String)
  PendingApproval(request_id~ : String)
  Blocked(reason~ : String)
} derive(Eq, Debug)

///|
pub extend ToolResult with Eq::{not_equal, equal}

///|
pub extend ToolResult with Debug::{to_repr}

///|
pub fn ToolResult::is_ok(self : ToolResult) -> Bool {
  match self {
    Ok(_) => true
    Err(_) | PendingApproval(_) | Blocked(_) => false
  }
}
