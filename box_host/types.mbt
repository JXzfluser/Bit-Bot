///|
/// Filesystem surface of the shared agent box.
pub(all) struct BoxFs {
  root : String
  workspace : String
} derive(Eq, Debug)

///|
pub extend BoxFs with Eq::{not_equal, equal}

///|
pub extend BoxFs with Debug::{to_repr}

///|
pub fn BoxFs::default() -> BoxFs {
  { root: "/", workspace: "/workspace", }
}

///|
pub fn BoxFs::resolve(self : BoxFs, rel : String) -> String {
  self.workspace + "/" + rel
}

///|
pub(all) struct ShellRequest {
  command : String
  working_directory : String?
  block_until_ms : Int32
  machine_id : String?
} derive(Eq, Debug)

///|
pub extend ShellRequest with Eq::{not_equal, equal}

///|
pub extend ShellRequest with Debug::{to_repr}

///|
pub fn ShellRequest::on_box(command : String) -> ShellRequest {
  { command, working_directory: None, block_until_ms: 30000, machine_id: None, }
}

///|
/// Per-agent desktop / browser session placeholder on the shared box.
pub(all) struct DesktopSession {
  agent_id : String
  display : String
  browser_attached : Bool
} derive(Eq, Debug)

///|
pub extend DesktopSession with Eq::{not_equal, equal}

///|
pub extend DesktopSession with Debug::{to_repr}

///|
pub fn DesktopSession::placeholder(agent_id : String) -> DesktopSession {
  { agent_id, display: ":0", browser_attached: false, }
}
