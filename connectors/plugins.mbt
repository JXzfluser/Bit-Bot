///|
/// CM-0503: plugin / connector bundle that ships skills.
pub(all) struct PluginSkillSpec {
  name : String
  description : String
  skill_md : String
} derive(Eq, Debug)

///|
pub extend PluginSkillSpec with Eq::{equal, not_equal}

///|
pub extend PluginSkillSpec with Debug::{to_repr}

///|
/// GP-A3: MCP tool shipped by a plugin (enable/disable per tool, spec §2.5).
pub(all) struct PluginToolSpec {
  name : String
  description : String
} derive(Eq, Debug)

///|
pub extend PluginToolSpec with Eq::{equal, not_equal}

///|
pub extend PluginToolSpec with Debug::{to_repr}

///|
pub(all) struct PluginBundle {
  id : String
  display_name : String
  skills : Array[PluginSkillSpec]
  /// MCP namespace id exposed after install (CM-0904). Empty = skills-only.
  mcp_namespace : String
  /// GP-A3: declared MCP tools (catalog surface; enabled flags live Host-side).
  mcp_tools : Array[PluginToolSpec]
} derive(Eq, Debug)

///|
pub extend PluginBundle with Eq::{equal, not_equal}

///|
pub extend PluginBundle with Debug::{to_repr}

///|
/// Registry of installable / installed plugins (connector surface).
/// CM-0904: after InstallPlugin / add-connector, namespace is usable (Ready).
pub(all) struct PluginRegistry {
  available : Array[PluginBundle]
  installed_ids : Array[String]
  /// Namespace → status after install.
  namespace_ready : Map[String, ConnectorStatus]
}

///|
pub fn PluginRegistry::empty() -> PluginRegistry {
  { available: [], installed_ids: [], namespace_ready: Map([]), }
}

///|
pub fn PluginRegistry::seed_demo() -> PluginRegistry {
  let reg = PluginRegistry::empty()
  reg.available.push({
    id: "plugin-slides",
    display_name: "Slides helper",
    skills: [
      {
        name: "slides-quickstart",
        description: "Create slide decks from outlines.",
        skill_md: "# slides-quickstart\n\nUse slides tools after install.\n",
      },
    ],
    mcp_namespace: "user-Slides",
    mcp_tools: [
      { name: "make_deck", description: "Render a deck from an outline.", },
      { name: "list_templates", description: "List available deck templates.", },
    ],
  })
  reg.available.push({
    id: "plugin-calendar",
    display_name: "Calendar sync",
    skills: [
      {
        name: "calendar-sync",
        description: "Sync calendar events via connector.",
        skill_md: "# calendar-sync\n\nRead calendar after connector auth.\n",
      },
    ],
    mcp_namespace: "user-Calendar",
    mcp_tools: [
      { name: "list_events", description: "List upcoming calendar events.", },
    ],
  })
  reg
}

///|
/// Install plugin by id; returns its skill specs for the skills catalog.
/// CM-0904: also marks mcp_namespace Ready / usable.
pub fn PluginRegistry::install(
  self : PluginRegistry,
  plugin_id : String,
) -> Result[Array[PluginSkillSpec], String] {
  for b in self.available {
    if b.id == plugin_id {
      let mut already = false
      for id in self.installed_ids {
        if id == plugin_id {
          already = true
          break
        }
      }
      if !already {
        self.installed_ids.push(plugin_id)
      }
      if b.mcp_namespace.length() > 0 {
        self.namespace_ready.set(b.mcp_namespace, Ready)
      }
      let out : Array[PluginSkillSpec] = []
      for s in b.skills {
        out.push(s)
      }
      return Ok(out)
    }
  }
  Err("unknown plugin: " + plugin_id)
}

///|
/// CM-0904 alias: add-connector installs and readies the namespace.
pub fn PluginRegistry::add_connector(
  self : PluginRegistry,
  plugin_id : String,
) -> Result[Array[PluginSkillSpec], String] {
  self.install(plugin_id)
}

///|
pub fn PluginRegistry::is_installed(
  self : PluginRegistry,
  plugin_id : String,
) -> Bool {
  for id in self.installed_ids {
    if id == plugin_id {
      return true
    }
  }
  false
}

///|
/// CM-0904: namespace status after install (Ready ⇒ usable).
pub fn PluginRegistry::namespace_status(
  self : PluginRegistry,
  namespace_ : String,
) -> ConnectorStatus {
  match self.namespace_ready.get(namespace_) {
    Some(s) => s
    None => Unavailable
  }
}

///|
pub fn PluginRegistry::namespace_usable(
  self : PluginRegistry,
  namespace_ : String,
) -> Bool {
  self.namespace_status(namespace_).is_usable()
}

///|
pub fn PluginRegistry::mcp_namespace_for(
  self : PluginRegistry,
  plugin_id : String,
) -> String? {
  for b in self.available {
    if b.id == plugin_id {
      if b.mcp_namespace.length() > 0 {
        return Some(b.mcp_namespace)
      }
      return None
    }
  }
  None
}

///|
/// CM-2107: UninstallPlugin — remove install + clear namespace readiness.
pub fn PluginRegistry::uninstall(
  self : PluginRegistry,
  plugin_id : String,
) -> Result[String, String] {
  let mut found = false
  let mut ns = ""
  for b in self.available {
    if b.id == plugin_id {
      found = true
      ns = b.mcp_namespace
      break
    }
  }
  if !found {
    return Err("unknown plugin: " + plugin_id)
  }
  if !self.is_installed(plugin_id) {
    return Err("plugin not installed: " + plugin_id)
  }
  // Rebuild installed_ids without plugin_id.
  let kept : Array[String] = []
  for id in self.installed_ids {
    if id != plugin_id {
      kept.push(id)
    }
  }
  // Clear and repush (Array has no clear in all targets — rebuild field).
  while self.installed_ids.length() > 0 {
    let _ = self.installed_ids.pop()
  }
  for id in kept {
    self.installed_ids.push(id)
  }
  if ns.length() > 0 {
    self.namespace_ready.remove(ns)
  }
  Ok(ns)
}

///|
/// Namespaces currently Ready after install (for GetDynamicTools visibility).
pub fn PluginRegistry::ready_namespaces(self : PluginRegistry) -> Array[String] {
  let out : Array[String] = []
  for b in self.available {
    if b.mcp_namespace.length() > 0 && self.namespace_usable(b.mcp_namespace) {
      out.push(b.mcp_namespace)
    }
  }
  out
}

///|
/// CM-2108: GetPlugin metadata — id + skills list.
pub(all) struct PluginMetadata {
  id : String
  display_name : String
  skills : Array[PluginSkillSpec]
  mcp_namespace : String
  mcp_tools : Array[PluginToolSpec]
} derive(Eq, Debug)

///|
pub extend PluginMetadata with Eq::{equal, not_equal}

///|
pub extend PluginMetadata with Debug::{to_repr}

///|
/// CM-2108: GetPlugin — returns plugin id and skills list.
pub fn PluginRegistry::get_plugin(
  self : PluginRegistry,
  plugin_id : String,
) -> Result[PluginMetadata, String] {
  for b in self.available {
    if b.id == plugin_id {
      let skills : Array[PluginSkillSpec] = []
      for s in b.skills {
        skills.push(s)
      }
      let tools : Array[PluginToolSpec] = []
      for t in b.mcp_tools {
        tools.push(t)
      }
      return Ok({
        id: b.id,
        display_name: b.display_name,
        skills,
        mcp_namespace: b.mcp_namespace,
        mcp_tools: tools,
      })
    }
  }
  Err("unknown plugin: " + plugin_id)
}

///|
pub fn PluginMetadata::skill_names(self : PluginMetadata) -> Array[String] {
  let out : Array[String] = []
  for s in self.skills {
    out.push(s.name)
  }
  out
}

///|
/// GP-A3: declared MCP tool names (for panel + toggle honesty checks).
pub fn PluginMetadata::tool_names(self : PluginMetadata) -> Array[String] {
  let out : Array[String] = []
  for t in self.mcp_tools {
    out.push(t.name)
  }
  out
}
