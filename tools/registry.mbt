///|
/// Name-keyed tool registry (CAP-103 / CAP-U-002).
pub(all) struct Registry {
  specs : Array[ToolSpec]
}

///|
pub fn Registry::empty() -> Registry {
  { specs: [], }
}

///|
pub fn Registry::with_echo() -> Registry {
  let reg = Registry::empty()
  reg.register({
    id: "echo",
    description: "Echo input text (noop host)",
    builtin: None,
    input_schema_json: "{\"type\":\"object\"}",
    requires_approval: false,
  })
  reg
}

///|
pub fn Registry::register(self : Registry, spec : ToolSpec) -> Unit {
  self.specs.push(spec)
}

///|
pub fn Registry::len(self : Registry) -> Int32 {
  self.specs.length()
}

///|
pub fn Registry::get(self : Registry, name : String) -> ToolSpec? {
  for s in self.specs {
    if s.id == name {
      break Some(s)
    }
  } nobreak {
    None
  }
}

///|
pub fn Registry::invoke(
  self : Registry,
  name : String,
  input : String,
) -> ToolResult {
  match self.get(name) {
    None => Err(message="unknown tool: " + name)
    Some(spec) =>
      if spec.id == "echo" {
        Ok(output=input)
      } else {
        Err(message="tool not implemented: " + name)
      }
  }
}
