///|
pub(all) enum SubagentType {
  Executor
  Browser
  ComputerUse
  Research
  /// CM-1203: knowledgeWork — long-material / knowledge整理子代理.
  KnowledgeWork
  /// CM-1204: watchVideo / videoReview — video path in, conclusion out.
  WatchVideo
  Custom(name~ : String)
} derive(Eq, Debug)

///|
pub extend SubagentType with Eq::{not_equal, equal}

///|
pub extend SubagentType with Debug::{to_repr}

///|
pub fn SubagentType::label(self : SubagentType) -> String {
  match self {
    Executor => "executor"
    Browser => "browser"
    ComputerUse => "computer_use"
    Research => "research"
    KnowledgeWork => "knowledgeWork"
    WatchVideo => "watchVideo"
    Custom(name~) => name
  }
}

///|
pub(all) struct TaskRequest {
  id : String
  prompt : String
  subagent : SubagentType
  parent_turn_id : String?
  deadline_ms : Int64?
} derive(Eq, Debug)

///|
pub extend TaskRequest with Eq::{not_equal, equal}

///|
pub extend TaskRequest with Debug::{to_repr}

///|
pub(all) struct Teammate {
  id : String
  role : String
  subagent : SubagentType
  active : Bool
} derive(Eq, Debug)

///|
pub extend Teammate with Eq::{not_equal, equal}

///|
pub extend Teammate with Debug::{to_repr}

///|
pub fn Teammate::can_accept(self : Teammate, req : TaskRequest) -> Bool {
  self.active && self.subagent == req.subagent
}
