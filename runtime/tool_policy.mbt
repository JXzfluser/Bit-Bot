///|
/// Tool policy —— 内核的**权威**权限层(K-2 / C-3)。
///
/// 一个工具能不能跑,由策略说了算。策略由 **Host** 构造(它知道设备、用户的
/// 设置、以及自动审批规则),每回合交给内核一次。
///
/// 为什么判定权必须在内核:**内核是工具真正执行的地方**。只在 Host 侧判一次
/// 是可以被绕过的 —— 任何别的调用方(CLI、移动端、daemon)都能绕过 Host 的
/// 检查直接调内核。所以:Host 负责**提供**策略,内核负责**执行**策略。
///
/// 三种判定:
///   Allow        —— 跑
///   NeedApproval —— 先问用户
///   Deny         —— 不跑,并且说清为什么
///
/// 维度:主体(subject)× 设备信任(device_trust)× 工具(tool)× 作用域(scope)。
/// 设备信任是**降级**用的:一台受限设备(手机/远程)能用的工具比桌面少。

///|
pub(all) enum ToolDecision {
  Allow
  NeedApproval
  Deny(reason~ : String)
} derive(Eq, Debug)

///|
pub extend ToolDecision with Eq::{equal, not_equal}

///|
pub extend ToolDecision with Debug::{to_repr}

///|
pub(all) struct ToolPolicy {
  /// 发起这次调用的主体(Bot id / 房间 / 设备)。空 = 未指定。
  subject : String
  /// "trusted"（桌面）或 "limited"（移动端 / 远程入站 / daemon）。
  device_trust : String
  /// 硬禁用。命中即拒,没有审批能救回来。
  deny_tools : Array[String]
  /// 需要审批。
  need_approval : Array[String]
  /// 受限设备额外需要审批的工具。
  limited_needs_approval : Array[String]
  /// 允许的路径根。**空 = 不限制路径**（保持既有行为）。
  path_roots : Array[String]
  /// 这台机器的**常驻授权**：到点的定时任务自己执行，不必每次问人。
  /// 来自 Host 的 `BITBOT_ROUTINE_AUTO_EXECUTE`。
  ///
  /// 为什么放在策略里：模型必须能**如实告诉用户**「这台机器开了自动执行」
  /// 还是「到点会备好草稿等你批准」。而**模型自己没有任何路径能把它打开** ——
  /// 它只是读到这个事实。真正写进行的是 Host,读的是同一个 env。
  routine_auto_execute : Bool
} derive(Eq, Debug)

///|
pub extend ToolPolicy with Eq::{equal, not_equal}

///|
pub extend ToolPolicy with Debug::{to_repr}

///|
/// The default policy: no denies, no path restriction, and the approval
/// requirement stays where it already was (the tool spec). A Host that does
/// not know about policies therefore changes nothing.
pub fn ToolPolicy::default() -> ToolPolicy {
  {
    subject: "",
    device_trust: "trusted",
    deny_tools: [],
    need_approval: [],
    limited_needs_approval: [],
    path_roots: [],
    routine_auto_execute: false,
  }
}

///|
pub fn ToolPolicy::is_limited(self : ToolPolicy) -> Bool {
  self.device_trust == "limited"
}

///|
fn tool_in(tool : String, list : Array[String]) -> Bool {
  for t in list {
    if t == tool {
      return true
    }
  }
  false
}

///|
/// Lexical containment: the scope is the root itself, or sits under it.
/// This is a FIRST gate. The Host does the canonical (symlink-resolved)
/// check as the second one — both must pass. A lexical-only check would let
/// a symlink out of the root, which is exactly why it is not the only one.
pub fn path_within_roots(path : String, roots : Array[String]) -> Bool {
  if roots.length() == 0 {
    return true
  }
  if path == "" {
    return false
  }
  for r in roots {
    if r == "" {
      continue
    }
    if path == r {
      return true
    }
    let prefix = if r.has_suffix("/") { r } else { r + "/" }
    if path.has_prefix(prefix) {
      return true
    }
  }
  false
}

///|
/// The filesystem scope of a tool call, taken from the path-ish argument.
/// Empty means "this tool has no filesystem scope for the kernel to check".
///
/// A shell command's paths are NOT here — the Host owns that (it has the
/// canonical `cwdAllowed` check and the minimal-env sandbox). Guessing a path
/// out of a shell string would be a lie about what was checked.
pub fn tool_scope(args_json : String) -> String {
  for key in ["path", "src", "dest", "file", "dir"] {
    match json_field_string(args_json, key) {
      Some(v) => {
        let t = v.trim().to_owned()
        if t != "" {
          return t
        }
      }
      None => ()
    }
  }
  ""
}

///|
/// The one decision. Order matters: a hard deny wins over everything, then
/// the device's limits, then the tool's own approval requirement, then the
/// filesystem scope.
pub fn ToolPolicy::decide(
  self : ToolPolicy,
  tool : String,
  scope : String,
) -> ToolDecision {
  if tool_in(tool, self.deny_tools) {
    return Deny(reason="tool is denied by policy")
  }
  if self.is_limited() && tool_in(tool, self.limited_needs_approval) {
    return NeedApproval
  }
  if tool_in(tool, self.need_approval) {
    return NeedApproval
  }
  if self.path_roots.length() > 0 && scope != "" {
    if !path_within_roots(scope, self.path_roots) {
      return Deny(reason="path is outside the allowed roots")
    }
  }
  Allow
}

///|
/// Read the array that belongs to one key. `find_json_array` finds the FIRST
/// array in the text, which is wrong for a policy object with several array
/// fields — so the key is located first and the array is read from there.

///|
/// 读一个 JSON 布尔字段。**认得裸 true/false**(不是字符串 "true")——
/// 策略是从 Host 的 JSON 来的,那边写的就是裸布尔。
fn json_bool_for_key(text : String, key : String, dflt : Bool) -> Bool {
  let marker = "\"" + key + "\""
  let at = match text.find(marker) {
    None => return dflt
    Some(a) => a
  }
  let mut i = at + marker.length()
  while i < text.length() {
    let c = text[i:i + 1].to_owned()
    if c != " " && c != "\n" && c != "\r" && c != "\t" {
      break
    }
    i = i + 1
  }
  if i >= text.length() || text[i:i + 1].to_owned() != ":" {
    return dflt
  }
  i = i + 1
  while i < text.length() {
    let c = text[i:i + 1].to_owned()
    if c != " " && c != "\n" && c != "\r" && c != "\t" {
      break
    }
    i = i + 1
  }
  if i + 4 <= text.length() && text[i:i + 4].to_owned() == "true" {
    return true
  }
  if i + 5 <= text.length() && text[i:i + 5].to_owned() == "false" {
    return false
  }
  dflt
}

///|
fn json_array_for_key(text : String, key : String) -> Array[String] {
  let out : Array[String] = []
  let marker = "\"" + key + "\""
  let at = match text.find(marker) {
    None => return out
    Some(a) => a
  }
  let mut i = at + marker.length()
  while i < text.length() && text[i:i + 1].to_owned() != "[" {
    i = i + 1
  }
  if i >= text.length() {
    return out
  }
  let body = match find_json_array(text[i:].to_owned()) {
    None => return out
    Some(b) => b
  }
  for part in body.split(",") {
    let p = part.trim().to_owned()
    if p.length() >= 2 && p.has_prefix("\"") && p.has_suffix("\"") {
      out.push(p[1:p.length() - 1].to_owned())
    }
  }
  out
}

///|
/// Parse the policy the Host handed over. An unparsable policy falls back to
/// the default — never to a policy that silently allows more than it should.
pub fn ToolPolicy::parse(text : String) -> ToolPolicy {
  let base = ToolPolicy::default()
  if text.trim() == "" {
    return base
  }
  let subject = match json_field_string(text, "subject") {
    Some(s) => s.trim().to_owned()
    None => base.subject
  }
  let trust = match json_field_string(text, "device_trust") {
    Some(s) => {
      let t = s.trim().to_owned()
      if t == "limited" {
        "limited"
      } else {
        "trusted"
      }
    }
    None => base.device_trust
  }
  {
    subject,
    device_trust: trust,
    deny_tools: json_array_for_key(text, "deny_tools"),
    need_approval: json_array_for_key(text, "need_approval"),
    limited_needs_approval: json_array_for_key(text, "limited_needs_approval"),
    path_roots: json_array_for_key(text, "path_roots"),
    routine_auto_execute: json_bool_for_key(
      text,
      "routine_auto_execute",
      base.routine_auto_execute,
    ),
  }
}
