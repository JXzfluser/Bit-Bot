///|
/// CM-0204: hidden flag — not in main sidebar but still addressable.

///|
pub(all) struct AgentRecord {
  id : String
  name : String
  title : String
  hidden : Bool
} derive(Eq, Debug)

///|
pub extend AgentRecord with Eq::{equal, not_equal}

///|
pub extend AgentRecord with Debug::{to_repr}

///|
pub fn AgentRecord::new(
  id~ : String,
  name~ : String,
  title~ : String = "",
  hidden~ : Bool = false,
) -> AgentRecord {
  { id, name, title, hidden, }
}

///|
/// Host-side agent directory: main sidebar vs addressable set.
pub(all) struct AgentDirectory {
  agents : Array[AgentRecord]
}

///|
pub fn AgentDirectory::new() -> AgentDirectory {
  { agents: [], }
}

///|
pub fn AgentDirectory::register(
  self : AgentDirectory,
  agent : AgentRecord,
) -> Unit {
  self.agents.push(agent)
}

///|
fn AgentDirectory::index_of(self : AgentDirectory, agent_id : String) -> Int32? {
  let mut i = 0
  while i < self.agents.length() {
    if self.agents[i].id == agent_id {
      return Some(i)
    }
    i = i + 1
  }
  None
}

///|
/// Main sidebar ids: only non-hidden agents.
pub fn AgentDirectory::main_sidebar_ids(self : AgentDirectory) -> Array[String] {
  let out : Array[String] = []
  for a in self.agents {
    if !a.hidden {
      out.push(a.id)
    }
  }
  out
}

///|
/// True when the agent appears in the main sidebar list.
pub fn AgentDirectory::in_main_sidebar(
  self : AgentDirectory,
  agent_id : String,
) -> Bool {
  for a in self.agents {
    if a.id == agent_id {
      return !a.hidden
    }
  }
  false
}

///|
/// CM-0204: hidden agents remain addressable by id (deep-link / mention / API).
pub fn AgentDirectory::is_addressable(
  self : AgentDirectory,
  agent_id : String,
) -> Bool {
  match self.index_of(agent_id) {
    Some(_) => true
    None => false
  }
}

///|
pub fn AgentDirectory::get(
  self : AgentDirectory,
  agent_id : String,
) -> Result[AgentRecord, String] {
  match self.index_of(agent_id) {
    None => Err("unknown agent: " + agent_id)
    Some(i) => Ok(self.agents[i])
  }
}

///|
/// Set hidden flag; addressability unchanged.
pub fn AgentDirectory::set_hidden(
  self : AgentDirectory,
  agent_id : String,
  hidden~ : Bool,
) -> Result[Unit, String] {
  match self.index_of(agent_id) {
    None => Err("unknown agent: " + agent_id)
    Some(i) => {
      let a = self.agents[i]
      self.agents[i] = { id: a.id, name: a.name, title: a.title, hidden, }
      Ok(())
    }
  }
}
