///|
/// CM-0701: registered user machine (id / label / kind / connection status).
pub(all) enum MachineKind {
  Desktop
  Ios
  Android
} derive(Eq, Debug)

///|
pub extend MachineKind with Eq::{equal, not_equal}

///|
pub extend MachineKind with Debug::{to_repr}

///|
pub fn MachineKind::name(self : MachineKind) -> String {
  match self {
    Desktop => "desktop"
    Ios => "ios"
    Android => "android"
  }
}

///|
pub(all) enum MachineStatus {
  Connected
  Disconnected
} derive(Eq, Debug)

///|
pub extend MachineStatus with Eq::{equal, not_equal}

///|
pub extend MachineStatus with Debug::{to_repr}

///|
pub fn MachineStatus::name(self : MachineStatus) -> String {
  match self {
    Connected => "connected"
    Disconnected => "disconnected"
  }
}

///|
pub(all) struct MachineInfo {
  id : String
  label : String
  kind : MachineKind
  status : MachineStatus
} derive(Eq, Debug)

///|
pub extend MachineInfo with Eq::{equal, not_equal}

///|
pub extend MachineInfo with Debug::{to_repr}

///|
/// Full registered set for ListMachines (CM-0701).
pub(all) struct MachineRegistry {
  machines : Array[MachineInfo]
  /// Mock binary FS keyed by absolute path (opaque byte strings).
  box_bytes : Map[String, String]
  /// Mock user-machine FS keyed by "machineId::path".
  machine_bytes : Map[String, String]
  /// Side-effect log: proves approval gate did / did not execute.
  effects : Array[String]
  /// CM-1905: Host local-execution master switch (off → reject machine calls).
  mut local_execution_enabled : Bool
}

///|
pub fn MachineRegistry::empty() -> MachineRegistry {
  {
    machines: [],
    box_bytes: Map([]),
    machine_bytes: Map([]),
    effects: [],
    local_execution_enabled: true,
  }
}

///|
/// Seed a representative full set: desktop + ios + android.
pub fn MachineRegistry::seed() -> MachineRegistry {
  let reg = MachineRegistry::empty()
  reg.machines.push({
    id: "desk-1",
    label: "Work Desktop",
    kind: Desktop,
    status: Connected,
  })
  reg.machines.push({
    id: "phone-ios",
    label: "iPhone",
    kind: Ios,
    status: Connected,
  })
  reg.machines.push({
    id: "phone-android",
    label: "Pixel",
    kind: Android,
    status: Disconnected,
  })
  reg
}

///|
/// CM-0701: ListMachines returns full registered set.
pub fn MachineRegistry::list(self : MachineRegistry) -> Array[MachineInfo] {
  let out : Array[MachineInfo] = []
  for m in self.machines {
    out.push(m)
  }
  out
}

///|
/// Mark the Host-present machine Connected when a multi-end Host shell
/// is actively running as that kind/id (honest: not pretend remote phone OS).
pub fn MachineRegistry::mark_host_present(
  self : MachineRegistry,
  machine_id~ : String,
  machine_kind~ : String,
) -> Unit {
  let mid = machine_id.trim().to_owned()
  let mk = machine_kind.trim().to_lower().to_owned()
  let mut i = 0
  while i < self.machines.length() {
    let m = self.machines[i]
    let kind_match = m.kind.name() == mk
    let id_match = mid != "" && m.id == mid
    if kind_match || id_match {
      self.machines[i] = {
        id: m.id,
        label: m.label,
        kind: m.kind,
        status: Connected,
      }
    }
    i = i + 1
  }
}

///|
pub fn MachineRegistry::find(
  self : MachineRegistry,
  id : String,
) -> MachineInfo? {
  for m in self.machines {
    if m.id == id {
      return Some(m)
    }
  }
  None
}

///|
/// CM-1905: toggle Host local-execution setting.
pub fn MachineRegistry::set_local_execution(
  self : MachineRegistry,
  enabled~ : Bool,
) -> Unit {
  self.local_execution_enabled = enabled
  self.effects.push("local_execution:" + (if enabled { "on" } else { "off" }))
}

///|
pub fn MachineRegistry::local_execution_on(self : MachineRegistry) -> Bool {
  self.local_execution_enabled
}

///|
/// CM-0702: machineId Shell/Read — without approval → not executed; with → success.
/// CM-1905: also rejects when local_execution_enabled=false.
pub fn MachineRegistry::run_on_machine(
  self : MachineRegistry,
  machine_id : String,
  command : String,
  approved~ : Bool,
) -> Result[String, String] {
  if !self.local_execution_enabled {
    self.effects.push("rejected_local_off:" + machine_id)
    return Err("local-execution disabled: machine-targeted call rejected")
  }
  match self.find(machine_id) {
    None => Err("unknown machine: " + machine_id)
    Some(m) =>
      if !approved {
        // Do NOT push an execute effect — proves not executed.
        self.effects.push("denied:" + machine_id)
        Err("approval required")
      } else {
        let out = "[machine:" + m.id + " kind=" + m.kind.name() + "] " + command
        self.effects.push("executed:" + machine_id + ":" + command)
        Ok(out)
      }
  }
}

///|
/// CM-0702: machineId Read — same approval gate.
pub fn MachineRegistry::read_on_machine(
  self : MachineRegistry,
  machine_id : String,
  path : String,
  approved~ : Bool,
) -> Result[String, String] {
  if !self.local_execution_enabled {
    self.effects.push("rejected_local_off_read:" + machine_id)
    return Err("local-execution disabled: machine-targeted call rejected")
  }
  match self.find(machine_id) {
    None => Err("unknown machine: " + machine_id)
    Some(_) =>
      if !approved {
        self.effects.push("denied_read:" + machine_id)
        Err("approval required")
      } else {
        let key = machine_id + "::" + path
        match self.machine_bytes.get(key) {
          Some(content) => {
            self.effects.push("read:" + machine_id + ":" + path)
            Ok(content)
          }
          None => {
            self.effects.push("read_missing:" + machine_id + ":" + path)
            Err("path not found on machine: " + path)
          }
        }
      }
  }
}

///|
/// Seed a file on a user machine (test / mock helper).
pub fn MachineRegistry::put_machine_file(
  self : MachineRegistry,
  machine_id : String,
  path : String,
  bytes : String,
) -> Unit {
  self.machine_bytes.set(machine_id + "::" + path, bytes)
}

///|
/// Seed a file on the box FS (test / mock helper).
pub fn MachineRegistry::put_box_file(
  self : MachineRegistry,
  path : String,
  bytes : String,
) -> Unit {
  self.box_bytes.set(path, bytes)
}

///|
pub fn MachineRegistry::get_box_bytes(
  self : MachineRegistry,
  path : String,
) -> String? {
  self.box_bytes.get(path)
}

///|
pub fn MachineRegistry::get_machine_bytes(
  self : MachineRegistry,
  machine_id : String,
  path : String,
) -> String? {
  self.machine_bytes.get(machine_id + "::" + path)
}

///|
fn basename_of(path : String) -> String {
  let mut last = -1
  let mut i = 0
  while i < path.length() {
    if path[i] == '/' {
      last = i
    }
    i = i + 1
  }
  if last < 0 {
    path
  } else {
    path[last + 1:].to_owned()
  }
}

///|
/// CM-0703: CopyToBox — binary intact; default dest `/workspace/uploads/<name>`.
pub fn MachineRegistry::copy_to_box(
  self : MachineRegistry,
  machine_id : String,
  src_path : String,
  dest_path~ : String? = None,
) -> Result[String, String] {
  let key = machine_id + "::" + src_path
  match self.machine_bytes.get(key) {
    None => Err("CopyToBox: source not found: " + src_path)
    Some(bytes) => {
      let dest = match dest_path {
        Some(p) => p
        None => "/workspace/uploads/" + basename_of(src_path)
      }
      // Verbatim copy — length and content preserved.
      self.box_bytes.set(dest, bytes)
      self.effects.push("copy_to_box:" + dest)
      Ok(dest)
    }
  }
}

///|
/// CM-0704 overwrite policy: explicit allow or refuse.
pub(all) enum OverwritePolicy {
  Allow
  Refuse
} derive(Eq, Debug)

///|
pub extend OverwritePolicy with Eq::{equal, not_equal}

///|
pub extend OverwritePolicy with Debug::{to_repr}

///|
/// CM-0704: CopyFromBox — correct dest path; overwrite policy explicit.
pub fn MachineRegistry::copy_from_box(
  self : MachineRegistry,
  machine_id : String,
  box_path : String,
  dest_path : String,
  overwrite~ : OverwritePolicy,
) -> Result[String, String] {
  match self.box_bytes.get(box_path) {
    None => Err("CopyFromBox: box path not found: " + box_path)
    Some(bytes) => {
      let key = machine_id + "::" + dest_path
      match self.machine_bytes.get(key) {
        Some(_) =>
          match overwrite {
            Refuse => Err("CopyFromBox: dest exists and overwrite=Refuse")
            Allow => {
              self.machine_bytes.set(key, bytes)
              self.effects.push("copy_from_box:" + dest_path + ":overwrite")
              Ok(dest_path)
            }
          }
        None => {
          self.machine_bytes.set(key, bytes)
          self.effects.push("copy_from_box:" + dest_path)
          Ok(dest_path)
        }
      }
    }
  }
}

///|
pub fn MachineRegistry::was_executed(
  self : MachineRegistry,
  machine_id : String,
) -> Bool {
  let prefix = "executed:" + machine_id
  for e in self.effects {
    if e.has_prefix(prefix) {
      return true
    }
  }
  false
}
