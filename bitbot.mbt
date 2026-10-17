///|
/// Canonical list of Bit Bot architecture modules (no top-level cloud).
pub fn registered_modules() -> Array[String] {
  [
    "core", "ui_protocol", "runtime", "memory", "routines", "skills", "tools", "connectors",
    "connectors/mail", "agents", "agents/cloud", "agents/task", "agents/computer_use",
    "channels", "security", "box_host", "stores",
  ]
}

///|
pub fn module_count() -> Int32 {
  registered_modules().length()
}

///|
/// Touch each package so root imports stay live and types remain linked.
pub fn scaffold_ping() -> Int32 {
  let _ = @core.TurnId::new("boot")
  let _ = @ui_protocol.EndTurnReason::Completed
  let _ = @runtime.ToolRegistry::empty()
  let _ = @runtime.open_turn(turn_id="boot", text="ping")
  let _ = @memory.InMemoryStore::new()
  let _ = @routines.Lifecycle::new()
  let _ = @skills.SkillCatalog::empty()
  let _ = @tools.BuiltinTool::all()
  let _ = @connectors.Ready
  let _ = @mail.MailService::new()
  let _ = @agents.Executor
  let _ = @agents_cloud.CloudAgentJob::queued("ping", "ping")
  let _ = @agents_task.SubagentHandle::dispatch_executor("boot", "t0", "ping")
  let _ = @computer_use.ComputerUseSpec::{
    task: "ping",
    allow_shell_escape: false,
  }
  let _ = @channels.Chat
  let _ = @security.ApprovalGate::default()
  let _ = @security.UntrustedFence::wrap("boot", "data")
  let _ = @box_host.BoxFs::default()
  let _ = @stores.StoreKey::new("boot")
  module_count()
}

///|
/// Matrix inventory constants (Wave H6 full I closure).
pub fn matrix_cm_count() -> Int32 {
  234
}

///|
pub fn matrix_i_pass_count() -> Int32 {
  234
}

///|
pub fn boot_banner() -> String {
  let mods = registered_modules()
  let lines : Array[String] = []
  lines.push("Bit Bot runtime boot")
  lines.push("registered modules: " + module_count().to_string())
  let mut i = 0
  while i < mods.length() {
    lines.push("  - " + mods[i])
    i = i + 1
  }
  let inv = "capability matrix: CM=" + matrix_cm_count().to_string() + " I-PASS=" + matrix_i_pass_count().to_string() + " (H6; 0705 platform-subset)"
  lines.push(inv)
  lines.join("\n")
}
