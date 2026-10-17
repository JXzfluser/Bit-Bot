///|
/// MCP / connector namespace identity (e.g. user-Gmail, cursor-github).
pub(all) struct McpNamespace {
  id : String
  display_name : String
  tool_count : Int32
} derive(Eq, Debug)

///|
pub extend McpNamespace with Eq::{not_equal, equal}

///|
pub extend McpNamespace with Debug::{to_repr}

///|
pub(all) enum ConnectorStatus {
  Ready
  Loading
  NeedsAuth
  NeedsGrant
  Error(message~ : String)
  Unavailable
} derive(Eq, Debug)

///|
pub extend ConnectorStatus with Eq::{not_equal, equal}

///|
pub extend ConnectorStatus with Debug::{to_repr}

///|
pub fn ConnectorStatus::is_usable(self : ConnectorStatus) -> Bool {
  match self {
    Ready => true
    Loading | NeedsAuth | NeedsGrant | Error(_) | Unavailable => false
  }
}

///|
pub(all) struct ConnectorHandle {
  mcp : McpNamespace
  status : ConnectorStatus
} derive(Eq, Debug)

///|
pub extend ConnectorHandle with Eq::{not_equal, equal}

///|
pub extend ConnectorHandle with Debug::{to_repr}
