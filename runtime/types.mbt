///|
/// Registry of tool specs available to the agent loop.
pub(all) struct ToolRegistry {
  specs : Array[@tools.ToolSpec]
}

///|
pub fn ToolRegistry::empty() -> ToolRegistry {
  { specs: [], }
}

///|
pub fn ToolRegistry::seed_builtins() -> ToolRegistry {
  let specs : Array[@tools.ToolSpec] = []
  for t in @tools.BuiltinTool::all() {
    specs.push({
      id: t.name(),
      description: t.name(),
      builtin: Some(t),
      input_schema_json: "{}",
      requires_approval: false,
    })
  }
  { specs, }
}

///|
pub fn ToolRegistry::len(self : ToolRegistry) -> Int32 {
  self.specs.length()
}

///|
pub fn ToolRegistry::register(
  self : ToolRegistry,
  spec : @tools.ToolSpec,
) -> Unit {
  self.specs.push(spec)
}

///|
/// Skeleton of the agent turn loop. Expand with model I/O and tool dispatch.
pub(all) struct AgentLoop {
  registry : ToolRegistry
  max_steps : Int32
}

///|
pub fn AgentLoop::new(registry : ToolRegistry) -> AgentLoop {
  { registry, max_steps: 64, }
}

///|
pub fn AgentLoop::boot(self : AgentLoop, ctx : TurnContext) -> String {
  "turn=" +
  ctx.turn_id.value +
  " tools=" +
  self.registry.len().to_string() +
  " max_steps=" +
  self.max_steps.to_string()
}
