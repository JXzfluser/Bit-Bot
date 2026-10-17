///|
/// CM-1401: CreateAgent — new assistant appears in Members / sidebar.

///|
/// Role / capability boundary for a created teammate assistant.
pub(all) struct AgentRoleBoundary {
  role : String
  can_send_to_user : Bool
  can_use_shell : Bool
} derive(Eq, Debug)

///|
pub extend AgentRoleBoundary with Eq::{equal, not_equal}

///|
pub extend AgentRoleBoundary with Debug::{to_repr}

///|
/// Created teammate assistant record.
pub(all) struct CreatedAgent {
  id : String
  name : String
  boundary : AgentRoleBoundary
} derive(Eq, Debug)

///|
pub extend CreatedAgent with Eq::{equal, not_equal}

///|
pub extend CreatedAgent with Debug::{to_repr}

///|
/// Members + sidebar registry for teammate assistants.
pub(all) struct TeammateDirectory {
  members : Array[CreatedAgent]
  sidebar : @ui_protocol.AgentDirectory
}

///|
pub fn TeammateDirectory::new() -> TeammateDirectory {
  { members: [], sidebar: @ui_protocol.AgentDirectory::new(), }
}

///|
/// CM-1401: create a teammate assistant; appears in Members and main sidebar.
pub fn TeammateDirectory::create_agent(
  self : TeammateDirectory,
  id~ : String,
  name~ : String,
  role~ : String,
  can_send_to_user~ : Bool = false,
  can_use_shell~ : Bool = true,
) -> Result[CreatedAgent, String] {
  if id.length() == 0 || name.length() == 0 {
    return Err("CreateAgent requires id and name")
  }
  for m in self.members {
    if m.id == id {
      return Err("agent already exists: " + id)
    }
  }
  let agent = {
    id,
    name,
    boundary: { role, can_send_to_user, can_use_shell, },
  }
  self.members.push(agent)
  self.sidebar.register(
    @ui_protocol.AgentRecord::new(id~, name~, title=role, hidden=false),
  )
  Ok(agent)
}

///|
/// Member ids shown in the Members panel.
pub fn TeammateDirectory::member_ids(self : TeammateDirectory) -> Array[String] {
  let out : Array[String] = []
  for m in self.members {
    out.push(m.id)
  }
  out
}

///|
pub fn TeammateDirectory::in_members(
  self : TeammateDirectory,
  agent_id : String,
) -> Bool {
  for m in self.members {
    if m.id == agent_id {
      return true
    }
  }
  false
}

///|
pub fn TeammateDirectory::in_sidebar(
  self : TeammateDirectory,
  agent_id : String,
) -> Bool {
  self.sidebar.in_main_sidebar(agent_id)
}
