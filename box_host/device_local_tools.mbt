///|
/// CM-0705: deviceLocalTools on phone (iOS/Android) + permission states.
/// needs_permission → approval card (kernel-contract).

///|
pub(all) enum DeviceToolPermission {
  Ready
  NeedsPermission
  Denied
  Unavailable
} derive(Eq, Debug)

///|
pub extend DeviceToolPermission with Eq::{equal, not_equal}

///|
pub extend DeviceToolPermission with Debug::{to_repr}

///|
pub fn DeviceToolPermission::label(self : DeviceToolPermission) -> String {
  match self {
    Ready => "ready"
    NeedsPermission => "needs_permission"
    Denied => "denied"
    Unavailable => "unavailable"
  }
}

///|
pub(all) struct DeviceLocalTool {
  name : String
  permission : DeviceToolPermission
} derive(Eq, Debug)

///|
pub extend DeviceLocalTool with Eq::{equal, not_equal}

///|
pub extend DeviceLocalTool with Debug::{to_repr}

///|
/// Approval card raised when a device tool needs OS permission (CM-0705).
pub(all) struct DevicePermissionCard {
  machine_id : String
  tool_name : String
  permission_label : String
  shown : Bool
} derive(Eq, Debug)

///|
pub extend DevicePermissionCard with Eq::{equal, not_equal}

///|
pub extend DevicePermissionCard with Debug::{to_repr}

///|
pub fn DevicePermissionCard::is_approval_card(
  self : DevicePermissionCard,
) -> Bool {
  self.shown && self.permission_label == "needs_permission"
}

///|
/// Per-phone deviceLocalTools registry (only phones list tools).
pub(all) struct DeviceLocalToolsRegistry {
  /// machineId → tools
  by_machine : Map[String, Array[DeviceLocalTool]]
  cards : Array[DevicePermissionCard]
}

///|
pub fn DeviceLocalToolsRegistry::empty() -> DeviceLocalToolsRegistry {
  { by_machine: Map([]), cards: [], }
}

///|
/// Seed iOS + Android phones with representative local tools.
pub fn DeviceLocalToolsRegistry::seed_phones() -> DeviceLocalToolsRegistry {
  let reg = DeviceLocalToolsRegistry::empty()
  reg.by_machine.set("phone-ios", [
    { name: "camera", permission: NeedsPermission, },
    { name: "photos", permission: Ready, },
    { name: "location", permission: Denied, },
  ])
  reg.by_machine.set("phone-android", [
    { name: "camera", permission: Ready, },
    { name: "microphone", permission: NeedsPermission, },
    { name: "notifications", permission: Unavailable, },
  ])
  reg
}

///|
/// Desktop machines never list deviceLocalTools.
pub fn DeviceLocalToolsRegistry::list_for(
  self : DeviceLocalToolsRegistry,
  machine_id : String,
  kind : MachineKind,
) -> Array[DeviceLocalTool] {
  match kind {
    Desktop => []
    Ios | Android =>
      match self.by_machine.get(machine_id) {
        Some(tools) => {
          let out : Array[DeviceLocalTool] = []
          for t in tools {
            out.push(t)
          }
          out
        }
        None => []
      }
  }
}

///|
/// CM-0705: invoke device tool — needs_permission shows approval card.
pub fn DeviceLocalToolsRegistry::invoke(
  self : DeviceLocalToolsRegistry,
  machine_id : String,
  tool_name : String,
) -> Result[String, DevicePermissionCard] {
  match self.by_machine.get(machine_id) {
    None => {
      let card = {
        machine_id,
        tool_name,
        permission_label: "unavailable",
        shown: false,
      }
      Err(card)
    }
    Some(tools) => {
      for t in tools {
        if t.name == tool_name {
          match t.permission {
            Ready => return Ok("device_local_ok:" + tool_name)
            NeedsPermission => {
              let card = {
                machine_id,
                tool_name,
                permission_label: t.permission.label(),
                shown: true,
              }
              self.cards.push(card)
              return Err(card)
            }
            Denied => {
              let card = {
                machine_id,
                tool_name,
                permission_label: t.permission.label(),
                shown: false,
              }
              return Err(card)
            }
            Unavailable => {
              let card = {
                machine_id,
                tool_name,
                permission_label: t.permission.label(),
                shown: false,
              }
              return Err(card)
            }
          }
        }
      }
      Err({
        machine_id,
        tool_name,
        permission_label: "unavailable",
        shown: false,
      })
    }
  }
}

///|
pub fn DeviceLocalToolsRegistry::last_card(
  self : DeviceLocalToolsRegistry,
) -> DevicePermissionCard? {
  if self.cards.length() == 0 {
    None
  } else {
    Some(self.cards[self.cards.length() - 1])
  }
}

///|
/// Wire ListMachines phone entries with deviceLocalTools (CM-0705 helper).
pub fn MachineRegistry::device_local_tools_for(
  self : MachineRegistry,
  device_reg : DeviceLocalToolsRegistry,
  machine_id : String,
) -> Array[DeviceLocalTool] {
  match self.find(machine_id) {
    None => []
    Some(m) => device_reg.list_for(machine_id, m.kind)
  }
}
