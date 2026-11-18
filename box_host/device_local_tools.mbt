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
  /// machineId → tools(设备专属,优先)
  by_machine : Map[String, Array[DeviceLocalTool]]
  /// kind → tools(按类型的默认表)
  ///
  /// 为什么必须有这一层:真实手机的 machine_id 是**设备密钥的 id**
  /// (`dev-android-<指纹>`),每台都不一样 —— 只按 id 写死两张表,
  /// 任何一台真机查表都落空 ⇒ 拍照/麦克风全没有落点(unavailable)。
  /// 类型表是"这类设备**声明**有什么工具",设备专属表是"这一台额外有/没有"。
  by_kind : Map[String, Array[DeviceLocalTool]]
  cards : Array[DevicePermissionCard]
}

///|
pub fn DeviceLocalToolsRegistry::empty() -> DeviceLocalToolsRegistry {
  { by_machine: Map([]), by_kind: Map([]), cards: [], }
}

///|
/// Seed iOS + Android phones with representative local tools.
pub fn DeviceLocalToolsRegistry::seed_phones() -> DeviceLocalToolsRegistry {
  let reg = DeviceLocalToolsRegistry::empty()
  let ios_tools = [
    { name: "camera", permission: NeedsPermission, },
    { name: "photos", permission: Ready, },
    { name: "location", permission: Denied, },
  ]
  let android_tools = [
    { name: "camera", permission: Ready, },
    { name: "microphone", permission: NeedsPermission, },
    { name: "notifications", permission: Unavailable, },
  ]
  // 按类型的默认表 —— 任何一台**这个类型的**设备都从这里拿到工具声明。
  reg.by_kind.set("ios", ios_tools)
  reg.by_kind.set("android", android_tools)
  // 稳定 id 的专属表(内核注册表里那两台"代表机");真机走上面的类型表。
  reg.by_machine.set("phone-ios", ios_tools)
  reg.by_machine.set("phone-android", android_tools)
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
    Ios | Android => self.tools_for(machine_id, kind)
  }
}

///|
/// 找一台设备的工具:先设备专属表,再按**类型**回落。
/// 回落这一层是承重的:真机的 machine_id 是设备密钥 id,查不到专属表,
/// 但它**确实是**一台 android 设备 —— 类型表就是给这种情况准备的。
pub fn DeviceLocalToolsRegistry::tools_for(
  self : DeviceLocalToolsRegistry,
  machine_id : String,
  kind : MachineKind,
) -> Array[DeviceLocalTool] {
  match self.by_machine.get(machine_id) {
    Some(tools) => {
      let out : Array[DeviceLocalTool] = []
      for t in tools {
        out.push(t)
      }
      out
    }
    None =>
      match self.by_kind.get(kind.name()) {
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
  kind : MachineKind,
  tool_name : String,
) -> Result[String, DevicePermissionCard] {
  match self.tools_for(machine_id, kind) {
    [] => {
      let card = {
        machine_id,
        tool_name,
        permission_label: "unavailable",
        shown: false,
      }
      Err(card)
    }
    tools => {
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
