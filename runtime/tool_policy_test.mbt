///|
/// K-2 / C-3: the tool policy is the kernel's authority layer.
/// These tests pin the DECISION, not the wiring — the wiring is proven
/// end to end by scripts/prove_product_tools.sh.

///|
test "K-2 the default policy allows everything and denies nothing" {
  let p = @runtime.ToolPolicy::default()
  assert_eq(p.device_trust, "trusted")
  assert_eq(p.deny_tools.length(), 0)
  assert_eq(p.path_roots.length(), 0)
  assert_true(p.decide("Shell", "") is Allow)
  assert_true(p.decide("send_mail", "") is Allow)
  // 空 path_roots = 不限制路径(保持既有行为)
  assert_true(p.decide("Read", "/etc/passwd") is Allow)
}

///|
test "K-2 a denied tool is denied, and no approval can bring it back" {
  let p = @runtime.ToolPolicy::{
    subject: "bot-A",
    device_trust: "trusted",
    deny_tools: ["web_fetch"],
    need_approval: ["web_fetch"],
    limited_needs_approval: [],
    path_roots: [],
    routine_auto_execute: false,
  }
  // 硬禁用优先于「需要审批」—— deny 是最终的。
  match p.decide("web_fetch", "") {
    @runtime.Deny(reason~) => assert_true(reason.contains("denied by policy"))
    _ => assert_true(false)
  }
  assert_true(p.decide("web_search", "") is Allow)
}

///|
test "K-2 a limited device needs approval for more tools" {
  let p = @runtime.ToolPolicy::{
    subject: "",
    device_trust: "limited",
    deny_tools: [],
    need_approval: [],
    limited_needs_approval: ["web_fetch", "send_mail", "Shell"],
    path_roots: [],
    routine_auto_execute: false,
  }
  assert_true(p.is_limited())
  assert_true(p.decide("web_fetch", "") is NeedApproval)
  assert_true(p.decide("Shell", "") is NeedApproval)
  // 只读的工具在受限设备上照常用。
  assert_true(p.decide("Read", "") is Allow)
  assert_true(p.decide("web_search", "") is Allow)
  // 同一份策略在受信设备上不拦。
  let trusted = @runtime.ToolPolicy::{ ..p, device_trust: "trusted", }
  assert_true(trusted.decide("web_fetch", "") is Allow)
}

///|
test "K-2 a path outside the allowed roots is denied" {
  let p = @runtime.ToolPolicy::{
    subject: "",
    device_trust: "trusted",
    deny_tools: [],
    need_approval: [],
    limited_needs_approval: [],
    path_roots: ["/workspace", "/data"],
    routine_auto_execute: false,
  }
  assert_true(p.decide("Read", "/workspace/docs/a.md") is Allow)
  assert_true(p.decide("Read", "/workspace") is Allow)
  assert_true(p.decide("Read", "/data/x") is Allow)
  assert_true(p.decide("Read", "/etc/passwd") is @runtime.Deny(_))
  assert_true(p.decide("Read", "/workspace-other/a") is @runtime.Deny(_))
}

///|
test "K-2 path containment is not a prefix match" {
  // 「/workspace-other」不是「/workspace」下面的东西。
  assert_false(@runtime.path_within_roots("/workspace-other/a", ["/workspace"]))
  assert_true(@runtime.path_within_roots("/workspace/a", ["/workspace"]))
  assert_true(@runtime.path_within_roots("/workspace", ["/workspace"]))
  // 结尾带 / 的根。
  assert_true(@runtime.path_within_roots("/workspace/a", ["/workspace/"]))
  // 空根列表 = 不限制。
  assert_true(@runtime.path_within_roots("/anything", []))
  // 空路径在有根限制时不算通过。
  assert_false(@runtime.path_within_roots("", ["/workspace"]))
}

///|
test "K-2 the scope comes from the path-ish argument only" {
  assert_eq(@runtime.tool_scope("{\"path\":\"/a/b\"}"), "/a/b")
  assert_eq(@runtime.tool_scope("{\"src\":\"/x\"}"), "/x")
  assert_eq(@runtime.tool_scope("{\"dest\":\"/y\"}"), "/y")
  // 没有路径参数的工具没有作用域 —— 内核不去猜 shell 命令里的路径。
  assert_eq(@runtime.tool_scope("{\"command\":\"cat /etc/passwd\"}"), "")
  assert_eq(@runtime.tool_scope("{}"), "")
}

///|
test "K-2 a policy parses from the Host's JSON" {
  let raw =
    "{\"subject\":\"bot-A\",\"device_trust\":\"limited\"," +
    "\"deny_tools\":[\"web_fetch\"]," +
    "\"need_approval\":[\"send_mail\",\"Shell\"]," +
    "\"limited_needs_approval\":[\"web_fetch\"]," +
    "\"path_roots\":[\"/workspace\",\"/data\"]}"
  let p = @runtime.ToolPolicy::parse(raw)
  assert_eq(p.subject, "bot-A")
  assert_eq(p.device_trust, "limited")
  assert_eq(p.deny_tools.length(), 1)
  assert_eq(p.deny_tools[0], "web_fetch")
  assert_eq(p.need_approval.length(), 2)
  assert_eq(p.need_approval[0], "send_mail")
  assert_eq(p.limited_needs_approval.length(), 1)
  assert_eq(p.path_roots.length(), 2)
  assert_eq(p.path_roots[1], "/data")
  assert_true(p.decide("web_fetch", "") is @runtime.Deny(_))
  assert_true(p.decide("send_mail", "") is NeedApproval)
}

///|
test "K-2 the machine's standing auto-execute grant is read from the policy" {
  let raw = "{\"routine_auto_execute\":true}"
  let p = @runtime.ToolPolicy::parse(raw)
  assert_true(p.routine_auto_execute)
  // 没有这个字段 / 读不出来 ⇒ 保持默认(关)。
  let off = @runtime.ToolPolicy::parse("{}")
  assert_false(off.routine_auto_execute)
  let garbage = @runtime.ToolPolicy::parse("not json")
  assert_false(garbage.routine_auto_execute)
}

///|
test "K-2 an unreadable policy falls back to the default, not to allow-all" {
  // 解析不出来 → 默认策略(不额外收紧,也不放宽)。
  let p = @runtime.ToolPolicy::parse("not json at all")
  assert_eq(p.device_trust, "trusted")
  assert_eq(p.deny_tools.length(), 0)
  let empty = @runtime.ToolPolicy::parse("")
  assert_eq(empty.device_trust, "trusted")
  assert_eq(empty.path_roots.length(), 0)
}
