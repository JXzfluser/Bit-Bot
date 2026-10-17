///|
/// Persistent store key namespace (agent stores mount points).
pub(all) struct StoreKey {
  path : String
} derive(Eq, Debug)

///|
pub extend StoreKey with Eq::{equal, not_equal}

///|
pub extend StoreKey with Debug::{to_repr}

///|
pub fn StoreKey::new(path : String) -> StoreKey {
  { path, }
}

///|
pub fn agent_store_mount_path(store_id : String) -> String {
  "/cursor/stores/" + store_id
}

///|
/// CM-0609: authorized mounts under /cursor/stores/<id>.
/// Unauthorized store ids have no path (path_exists=false).
pub(all) struct StoreMountTable {
  authorized_ids : Array[String]
  /// Files keyed by "store_id::rel".
  files : Map[String, String]
}

///|
pub fn StoreMountTable::empty() -> StoreMountTable {
  { authorized_ids: [], files: Map([]), }
}

///|
fn StoreMountTable::is_authorized(
  self : StoreMountTable,
  store_id : String,
) -> Bool {
  for id in self.authorized_ids {
    if id == store_id {
      return true
    }
  }
  false
}

///|
/// Authorize and mount /cursor/stores/<id> (readable thereafter).
pub fn StoreMountTable::authorize(
  self : StoreMountTable,
  store_id : String,
) -> String {
  if !self.is_authorized(store_id) {
    self.authorized_ids.push(store_id)
  }
  agent_store_mount_path(store_id)
}

///|
/// CM-0609: authorized store path; unauthorized → None (path absent).
pub fn StoreMountTable::mount_path_if_authorized(
  self : StoreMountTable,
  store_id : String,
) -> String? {
  if self.is_authorized(store_id) {
    Some(agent_store_mount_path(store_id))
  } else {
    None
  }
}

///|
fn store_id_from_absolute(absolute_path : String) -> String? {
  let prefix = "/cursor/stores/"
  if !absolute_path.has_prefix(prefix) {
    return None
  }
  let rest = absolute_path[prefix.length():].to_owned()
  if rest.length() == 0 {
    return None
  }
  let mut found = -1
  let mut i = 0
  while i < rest.length() {
    if rest[i] == '/' {
      found = i
      break
    }
    i = i + 1
  }
  if found >= 0 {
    Some(rest[0:found].to_owned())
  } else {
    Some(rest)
  }
}

///|
/// Path exists only when the store id is authorized.
pub fn StoreMountTable::path_exists(
  self : StoreMountTable,
  absolute_path : String,
) -> Bool {
  match store_id_from_absolute(absolute_path) {
    None => false
    Some(store_id) => self.is_authorized(store_id)
  }
}

///|
pub fn StoreMountTable::put_file(
  self : StoreMountTable,
  store_id : String,
  rel : String,
  content : String,
) -> Result[Unit, String] {
  if !self.is_authorized(store_id) {
    return Err("store not authorized: " + store_id)
  }
  self.files.set(store_id + "::" + rel, content)
  Ok(())
}

///|
/// Read from an authorized mount; unauthorized → Err (path absent).
pub fn StoreMountTable::read(
  self : StoreMountTable,
  store_id : String,
  rel : String,
) -> Result[String, String] {
  if !self.is_authorized(store_id) {
    return Err("path absent: unauthorized store " + store_id)
  }
  match self.files.get(store_id + "::" + rel) {
    Some(c) => Ok(c)
    None => Err("file not found in store: " + rel)
  }
}

///|
/// CM-2173 / STORE-02: ordinary file tools used for store R/W (path policy).

///|
/// Ordinary host file tools — stores are read/written via these, not a private API.
pub(all) enum OrdinaryFileTool {
  Read
  Write
  Shell
} derive(Eq, Debug)

///|
pub extend OrdinaryFileTool with Eq::{equal, not_equal}

///|
pub extend OrdinaryFileTool with Debug::{to_repr}

///|
pub fn OrdinaryFileTool::name(self : OrdinaryFileTool) -> String {
  match self {
    Read => "Read"
    Write => "Write"
    Shell => "Shell"
  }
}

///|
pub fn OrdinaryFileTool::is_ordinary_file_tool(self : OrdinaryFileTool) -> Bool {
  match self {
    Read | Write | Shell => true
  }
}

///|
/// Relative path under an authorized mount from an absolute store path.
fn rel_under_store(absolute_path : String, store_id : String) -> String? {
  let prefix = agent_store_mount_path(store_id)
  if absolute_path == prefix {
    return Some("")
  }
  let with_slash = prefix + "/"
  if absolute_path.has_prefix(with_slash) {
    Some(absolute_path[with_slash.length():].to_owned())
  } else {
    None
  }
}

///|
/// Path policy for ordinary-tool store access: must be under authorized /cursor/stores/<id>.
pub fn StoreMountTable::validate_ordinary_tool_path(
  self : StoreMountTable,
  absolute_path : String,
) -> Result[String, String] {
  match store_id_from_absolute(absolute_path) {
    None =>
      Err(
        "store path policy: ordinary file tools require /cursor/stores/<id>/… path",
      )
    Some(store_id) =>
      if !self.is_authorized(store_id) {
        Err("store path policy: unauthorized store path absent: " + store_id)
      } else {
        Ok(store_id)
      }
  }
}

///|
/// Outcome of store R/W via ordinary file tools.
pub(all) enum OrdinaryStoreIo {
  ReadOk(path~ : String, content~ : String, tool~ : OrdinaryFileTool)
  WriteOk(path~ : String, tool~ : OrdinaryFileTool)
  Rejected(reason~ : String)
} derive(Eq, Debug)

///|
pub extend OrdinaryStoreIo with Eq::{equal, not_equal}

///|
pub extend OrdinaryStoreIo with Debug::{to_repr}

///|
pub fn OrdinaryStoreIo::used_ordinary_tool(self : OrdinaryStoreIo) -> Bool {
  match self {
    ReadOk(path~, content~, tool~) => {
      let _ = path
      let _ = content
      tool.is_ordinary_file_tool()
    }
    WriteOk(path~, tool~) => {
      let _ = path
      tool.is_ordinary_file_tool()
    }
    Rejected(_) => false
  }
}

///|
/// CM-2173: read store content via ordinary Read (path policy on StoreMountTable).
pub fn StoreMountTable::read_via_ordinary_tool(
  self : StoreMountTable,
  tool : OrdinaryFileTool,
  absolute_path : String,
) -> OrdinaryStoreIo {
  match tool {
    Write => return Rejected(reason="Write tool cannot read; use Read")
    Shell | Read => ()
  }
  match self.validate_ordinary_tool_path(absolute_path) {
    Err(e) => Rejected(reason=e)
    Ok(store_id) =>
      match rel_under_store(absolute_path, store_id) {
        None => Rejected(reason="path not under store mount")
        Some(rel) =>
          if rel.length() == 0 {
            Rejected(reason="ordinary Read requires a file under the mount")
          } else {
            match self.read(store_id, rel) {
              Ok(content) => ReadOk(path=absolute_path, content~, tool=Read)
              Err(e) => Rejected(reason=e)
            }
          }
      }
  }
}

///|
/// CM-2173: write store content via ordinary Write (path policy on StoreMountTable).
pub fn StoreMountTable::write_via_ordinary_tool(
  self : StoreMountTable,
  tool : OrdinaryFileTool,
  absolute_path : String,
  content : String,
) -> OrdinaryStoreIo {
  match tool {
    Read => return Rejected(reason="Read tool cannot write; use Write")
    Shell | Write => ()
  }
  match self.validate_ordinary_tool_path(absolute_path) {
    Err(e) => Rejected(reason=e)
    Ok(store_id) =>
      match rel_under_store(absolute_path, store_id) {
        None => Rejected(reason="path not under store mount")
        Some(rel) =>
          if rel.length() == 0 {
            Rejected(reason="ordinary Write requires a file under the mount")
          } else {
            match self.put_file(store_id, rel, content) {
              Ok(_) => WriteOk(path=absolute_path, tool=Write)
              Err(e) => Rejected(reason=e)
            }
          }
      }
  }
}
