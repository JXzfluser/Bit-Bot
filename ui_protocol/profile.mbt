///|
/// CM-0201 / CM-0203: agent display profile (name / title / description).
pub(all) struct AgentProfile {
  id : String
  name : String
  title : String
  description : String
} derive(Eq, Debug)

///|
pub extend AgentProfile with Eq::{equal, not_equal}

///|
pub extend AgentProfile with Debug::{to_repr}

///|
pub fn AgentProfile::new(
  id~ : String,
  name~ : String,
  title~ : String,
  description~ : String,
) -> AgentProfile {
  { id, name, title, description, }
}

///|
/// Snapshot of one sidebar row for an agent.
pub(all) struct SidebarEntry {
  agent_id : String
  display_name : String
  title : String
} derive(Eq, Debug)

///|
pub extend SidebarEntry with Eq::{equal, not_equal}

///|
pub extend SidebarEntry with Debug::{to_repr}

///|
/// Info panel fields shown beside the chat.
pub(all) struct InfoPanelSnapshot {
  agent_id : String
  name : String
  title : String
  description : String
} derive(Eq, Debug)

///|
pub extend InfoPanelSnapshot with Eq::{equal, not_equal}

///|
pub extend InfoPanelSnapshot with Debug::{to_repr}

///|
/// CM-0201 / CM-0203: sidebar + transcript host model.
pub(all) struct SidebarModel {
  entries : Array[SidebarEntry]
  mut active_agent_id : String?
  mut info_panel : InfoPanelSnapshot?
  mut transcript_cleared_for : String?
  mut pending_delete_id : String?
}

///|
pub fn SidebarModel::new() -> SidebarModel {
  {
    entries: [],
    active_agent_id: None,
    info_panel: None,
    transcript_cleared_for: None,
    pending_delete_id: None,
  }
}

///|
/// CM-0203: new agent appears in the sidebar list.
pub fn SidebarModel::add_agent(
  self : SidebarModel,
  profile : AgentProfile,
) -> Unit {
  self.entries.push({
    agent_id: profile.id,
    display_name: profile.name,
    title: profile.title,
  })
  self.active_agent_id = Some(profile.id)
  self.info_panel = Some({
    agent_id: profile.id,
    name: profile.name,
    title: profile.title,
    description: profile.description,
  })
}

///|
fn SidebarModel::index_of(self : SidebarModel, agent_id : String) -> Int32? {
  let mut i = 0
  while i < self.entries.length() {
    if self.entries[i].agent_id == agent_id {
      return Some(i)
    }
    i = i + 1
  }
  None
}

///|
/// CM-0201: UpdateAgentProfile; sidebar + info panel reflect immediately.
pub fn SidebarModel::update_agent_profile(
  self : SidebarModel,
  profile : AgentProfile,
) -> Result[Unit, String] {
  match self.index_of(profile.id) {
    None => Err("agent not in sidebar: " + profile.id)
    Some(i) => {
      self.entries[i] = {
        agent_id: profile.id,
        display_name: profile.name,
        title: profile.title,
      }
      self.info_panel = Some({
        agent_id: profile.id,
        name: profile.name,
        title: profile.title,
        description: profile.description,
      })
      Ok(())
    }
  }
}

///|
/// CM-0201 helper: read current sidebar + panel snapshot for an agent.
pub fn SidebarModel::snapshot_for(
  self : SidebarModel,
  agent_id : String,
) -> Result[(SidebarEntry, InfoPanelSnapshot), String] {
  match self.index_of(agent_id) {
    None => Err("agent not in sidebar: " + agent_id)
    Some(i) => {
      let entry = self.entries[i]
      match self.info_panel {
        Some(panel) =>
          if panel.agent_id == agent_id {
            Ok((entry, panel))
          } else {
            Err("info panel not reflecting agent: " + agent_id)
          }
        None => Err("info panel empty")
      }
    }
  }
}

///|
/// CM-0203: delete requires confirm; until confirmed, agent stays listed.
pub fn SidebarModel::request_delete(
  self : SidebarModel,
  agent_id : String,
) -> Result[Unit, String] {
  match self.index_of(agent_id) {
    None => Err("cannot delete unknown agent: " + agent_id)
    Some(_) => {
      self.pending_delete_id = Some(agent_id)
      Ok(())
    }
  }
}

///|
/// CM-0203: confirm delete removes sidebar entry and clears transcript.
pub fn SidebarModel::confirm_delete(
  self : SidebarModel,
  agent_id : String,
  confirmed~ : Bool,
) -> Result[Unit, String] {
  if !confirmed {
    return Err("delete requires user confirm")
  }
  match self.pending_delete_id {
    Some(pending) =>
      if pending != agent_id {
        return Err("pending delete mismatch")
      }
    None => return Err("delete requires confirm first")
  }
  match self.index_of(agent_id) {
    None => Err("agent already gone: " + agent_id)
    Some(i) => {
      let _ = self.entries.remove(i)
      self.pending_delete_id = None
      self.transcript_cleared_for = Some(agent_id)
      match self.active_agent_id {
        Some(aid) =>
          if aid == agent_id {
            self.active_agent_id = None
            self.info_panel = None
          }
        None => ()
      }
      Ok(())
    }
  }
}

///|
pub fn SidebarModel::contains(self : SidebarModel, agent_id : String) -> Bool {
  match self.index_of(agent_id) {
    Some(_) => true
    None => false
  }
}

///|
pub fn SidebarModel::transcript_was_cleared(
  self : SidebarModel,
  agent_id : String,
) -> Bool {
  match self.transcript_cleared_for {
    Some(id) => id == agent_id
    None => false
  }
}
