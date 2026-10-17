///|
/// Tool call DTO — Host executes via box_host / HostAbi; kernel only describes.
pub(all) struct ToolCall {
  id : String
  name : String
  arguments_json : String
  machine_id : String?
} derive(Eq, Debug)

///|
pub extend ToolCall with Eq::{equal, not_equal}

///|
pub extend ToolCall with Debug::{to_repr}

///|
pub(all) enum Effect {
  ExecTool(call~ : ToolCall)
  Deliver(turn_id~ : String, body~ : String)
  RequestApproval(request_id~ : String, summary~ : String)
} derive(Eq, Debug)

///|
pub extend Effect with Eq::{equal, not_equal}

///|
pub extend Effect with Debug::{to_repr}

///|
pub fn ToolCall::echo(id : String, text : String) -> ToolCall {
  { id, name: "echo", arguments_json: text, machine_id: None, }
}
