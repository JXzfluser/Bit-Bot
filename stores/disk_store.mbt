///|
/// Host disk persistence path contract (product Host runtime).
/// Kernel-contract: durable agent data lives under `/workspace/data/...`.
/// Host ABI owns real FS I/O; this module encodes the mount paths the Host must honor.

///|
pub fn host_data_root() -> String {
  "/workspace/data"
}

///|
pub fn host_chats_dir() -> String {
  host_data_root() + "/chats"
}

///|
pub fn host_memory_dir() -> String {
  host_data_root() + "/memory"
}

///|
pub fn host_journal_dir() -> String {
  host_data_root() + "/journal"
}

///|
pub fn host_routines_dir() -> String {
  host_data_root() + "/routines"
}

///|
pub fn host_connectors_dir() -> String {
  host_data_root() + "/connectors"
}

///|
pub fn host_audit_dir() -> String {
  host_data_root() + "/audit"
}

///|
/// Per-agent chat transcript path: `/workspace/data/chats/<agent_id>.json`
pub fn disk_chat_path(agent_id : String) -> String {
  host_chats_dir() + "/" + agent_id + ".json"
}

///|
/// Per-agent memory/profile path: `/workspace/data/memory/<agent_id>.json`
pub fn disk_memory_path(agent_id : String) -> String {
  host_memory_dir() + "/" + agent_id + ".json"
}

///|
/// Connector OAuth / Connected state: `/workspace/data/connectors/<name>.json`
pub fn disk_connector_path(name : String) -> String {
  host_connectors_dir() + "/" + name + ".json"
}

///|
/// Path policy: persistence paths must stay under `/workspace/data`.
pub fn is_host_data_path(absolute_path : String) -> Bool {
  let root = host_data_root()
  if absolute_path == root {
    return true
  }
  let with_slash = root + "/"
  absolute_path.has_prefix(with_slash)
}

///|
pub(all) struct DiskStoreContract {
  data_root : String
  chats_dir : String
  memory_dir : String
} derive(Eq, Debug)

///|
pub extend DiskStoreContract with Eq::{equal, not_equal}

///|
pub extend DiskStoreContract with Debug::{to_repr}

///|
pub fn DiskStoreContract::product_default() -> DiskStoreContract {
  {
    data_root: host_data_root(),
    chats_dir: host_chats_dir(),
    memory_dir: host_memory_dir(),
  }
}

///|
pub fn DiskStoreContract::accepts_path(self : DiskStoreContract, path : String) -> Bool {
  let _ = self
  is_host_data_path(path)
}
