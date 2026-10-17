///|
/// Description of one dynamic (MCP) tool (CM-0901).
pub(all) struct DynamicToolDesc {
  namespace_ : String
  name : String
  description : String
  input_schema_json : String
  truncated : Bool
} derive(Eq, Debug)

///|
pub extend DynamicToolDesc with Eq::{equal, not_equal}

///|
pub extend DynamicToolDesc with Debug::{to_repr}

///|
/// In-memory dynamic tool catalog.
pub(all) struct DynamicCatalog {
  tools : Array[DynamicToolDesc]
  /// Full descriptions keyed by "ns::name" for truncated refetch.
  full_descriptions : Map[String, String]
  discovered : Map[String, Bool]
}

///|
pub fn DynamicCatalog::empty() -> DynamicCatalog {
  { tools: [], full_descriptions: Map([]), discovered: Map([]), }
}

///|
pub fn DynamicCatalog::seed_example() -> DynamicCatalog {
  let cat = DynamicCatalog::empty()
  cat.register(
    {
      namespace_: "user-Gmail",
      name: "search_threads",
      description: "Search Gmail threads (truncated…)",
      input_schema_json: "{\"type\":\"object\"}",
      truncated: true,
    },
    full_description="Search Gmail threads by query, from, after, before; returns thread ids and snippets.",
  )
  cat.register(
    {
      namespace_: "user-Gmail",
      name: "create_draft",
      description: "Create a Gmail draft",
      input_schema_json: "{\"type\":\"object\",\"required\":[\"to\",\"subject\"]}",
      truncated: false,
    },
    full_description="Create a Gmail draft with to/subject/body.",
  )
  cat
}

///|
pub fn DynamicCatalog::register(
  self : DynamicCatalog,
  desc : DynamicToolDesc,
  full_description~ : String,
) -> Unit {
  let key = desc.namespace_ + "::" + desc.name
  self.full_descriptions.set(key, full_description)
  // Replace if present.
  let mut i = 0
  while i < self.tools.length() {
    let t = self.tools[i]
    if t.namespace_ == desc.namespace_ && t.name == desc.name {
      self.tools[i] = desc
      return
    }
    i = i + 1
  }
  self.tools.push(desc)
}

///|
fn tool_key(ns : String, name : String) -> String {
  ns + "::" + name
}

///|
/// CM-0901: discover namespace tools (marks discovered). Truncated desc may refetch full.
pub fn DynamicCatalog::discover(
  self : DynamicCatalog,
  ns~ : String? = None,
) -> Array[DynamicToolDesc] {
  let out : Array[DynamicToolDesc] = []
  for t in self.tools {
    let ok = match ns {
      None => true
      Some(n) => t.namespace_ == n
    }
    if ok {
      self.discovered.set(tool_key(t.namespace_, t.name), true)
      out.push(t)
    }
  }
  out
}

///|
/// CM-0901: get full (non-truncated) description after discover.
pub fn DynamicCatalog::get_full(
  self : DynamicCatalog,
  ns : String,
  name : String,
) -> Result[DynamicToolDesc, String] {
  let key = tool_key(ns, name)
  match self.discovered.get(key) {
    None | Some(false) => Err("must discover before get_full: " + key)
    Some(true) => {
      for t in self.tools {
        if t.namespace_ == ns && t.name == name {
          let full = match self.full_descriptions.get(key) {
            Some(d) => d
            None => t.description
          }
          return Ok({
            namespace_: t.namespace_,
            name: t.name,
            description: full,
            input_schema_json: t.input_schema_json,
            truncated: false,
          })
        }
      }
      Err("unknown tool: " + key)
    }
  }
}

///|
pub fn DynamicCatalog::is_discovered(
  self : DynamicCatalog,
  ns : String,
  name : String,
) -> Bool {
  match self.discovered.get(tool_key(ns, name)) {
    Some(true) => true
    _ => false
  }
}

///|
pub(all) struct DynamicCall {
  namespace_ : String
  name : String
  arguments_json : String
  write_to_file : Bool
} derive(Eq, Debug)

///|
pub extend DynamicCall with Eq::{equal, not_equal}

///|
pub extend DynamicCall with Debug::{to_repr}

///|
/// Detect `$file:` placeholders in arguments (record only; do not read real files).
pub fn DynamicCall::requests_file_injection(self : DynamicCall) -> Bool {
  self.arguments_json.contains("$" + "file:")
}

///|
/// CM-0902: call dynamic tool; refuse unknown / undiscovered; schema args; optional write_to_file.
pub fn DynamicCatalog::call(
  self : DynamicCatalog,
  call : DynamicCall,
) -> ToolResult {
  let key = tool_key(call.namespace_, call.name)
  // Refuse unknown tool; capture schema when found.
  let mut schema : String? = None
  for t in self.tools {
    if t.namespace_ == call.namespace_ && t.name == call.name {
      schema = Some(t.input_schema_json)
      break
    }
  }
  match schema {
    None => return Err(message="unknown tool: " + key)
    Some(_) => ()
  }
  // Must discover before call.
  if !self.is_discovered(call.namespace_, call.name) {
    return Err(message="must discover before call: " + key)
  }
  // CM-0902: args must satisfy schema required keys.
  match schema {
    Some(sch) =>
      match validate_args_against_schema(sch, call.arguments_json) {
        Err(m) => return Err(message=m)
        Ok(_) => ()
      }
    None => ()
  }
  let inject = call.requests_file_injection()
  if call.write_to_file {
    let path = "/workspace/agent-tools/" +
      call.namespace_ +
      "-" +
      call.name +
      ".txt"
    let note = if inject { " file_injection_requested" } else { "" }
    return Ok(output="wrote result to " + path + note)
  }
  let out = if inject {
    "ok; file_injection_requested=true"
  } else {
    "ok; " + call.name + " executed (mock)"
  }
  Ok(output=out)
}

///|
/// Optionally wire a discovered dynamic tool into the builtin Registry as a ToolSpec.
pub fn Registry::register_dynamic(
  self : Registry,
  desc : DynamicToolDesc,
) -> Unit {
  self.register({
    id: desc.namespace_ + "/" + desc.name,
    description: desc.description,
    builtin: Some(CallDynamicTool),
    input_schema_json: desc.input_schema_json,
    requires_approval: false,
  })
}

///|
/// Minimal required-key check against input_schema_json `"required":["a","b"]`.
pub fn schema_required_keys(schema_json : String) -> Array[String] {
  // Fast path for seed create_draft schema (exact fragment).
  if schema_json.contains("\"required\":[\"to\",\"subject\"]") {
    return ["to", "subject"]
  }
  let marker = "\"required\":["
  let mut at = -1
  let last = schema_json.length() - marker.length()
  if last >= 0 {
    for i = 0; i <= last; i = i + 1 {
      if schema_json[i:i + marker.length()].to_owned() == marker {
        at = i
        break
      }
    }
  }
  if at < 0 {
    return []
  }
  let from = at + marker.length()
  let mut end = from
  while end < schema_json.length() {
    let ch = schema_json[end:end + 1].to_owned()
    if ch == "]" {
      break
    }
    end = end + 1
  }
  if end >= schema_json.length() {
    return []
  }
  let inner = schema_json[from:end].to_owned()
  let keys : Array[String] = []
  let parts = inner.split(",").to_array()
  for p in parts {
    let s = p.to_owned().replace(old="\"", new="").replace(old=" ", new="")
    if s.length() > 0 {
      keys.push(s)
    }
  }
  keys
}

///|
fn args_has_key(args_json : String, key : String) -> Bool {
  args_json.contains("\"" + key + "\"")
}

///|
/// CM-0902: validate args against descriptor required list.
pub fn DynamicCatalog::validate_args(
  self : DynamicCatalog,
  ns : String,
  name : String,
  args_json : String,
) -> Result[Unit, String] {
  for t in self.tools {
    if t.namespace_ == ns && t.name == name {
      let reqs = schema_required_keys(t.input_schema_json)
      for k in reqs {
        if !args_has_key(args_json, k) {
          return Err("missing required field: " + k)
        }
      }
      return Ok(())
    }
  }
  Err("unknown tool for schema: " + ns + "::" + name)
}

///|
/// CM-0902: discover + schema check + call; large result may write_to_file.
pub fn DynamicCatalog::call_with_schema(
  self : DynamicCatalog,
  call : DynamicCall,
) -> ToolResult {
  match self.validate_args(call.namespace_, call.name, call.arguments_json) {
    Err(e) => Err(message=e)
    Ok(_) => self.call(call)
  }
}

///|
/// CM-0902: check required keys from schema JSON are present in args JSON.
pub fn validate_args_against_schema(
  schema_json : String,
  args_json : String,
) -> Result[Unit, String] {
  let keys = schema_required_keys(schema_json)
  for k in keys {
    if !args_has_key(args_json, k) {
      return Err("missing required arg: " + k)
    }
  }
  Ok(())
}

///|
/// CM-2107: remove all tools under a namespace (after UninstallPlugin).
pub fn DynamicCatalog::remove_namespace(
  self : DynamicCatalog,
  ns : String,
) -> Int32 {
  let kept : Array[DynamicToolDesc] = []
  let mut removed = 0
  for t in self.tools {
    if t.namespace_ == ns {
      removed = removed + 1
      let key = tool_key(t.namespace_, t.name)
      self.full_descriptions.remove(key)
      self.discovered.remove(key)
    } else {
      kept.push(t)
    }
  }
  while self.tools.length() > 0 {
    let _ = self.tools.pop()
  }
  for t in kept {
    self.tools.push(t)
  }
  removed
}

///|
/// CM-2107 helper: GetDynamicTools list of namespace ids currently present.
pub fn DynamicCatalog::list_namespaces(self : DynamicCatalog) -> Array[String] {
  let out : Array[String] = []
  for t in self.tools {
    let mut seen = false
    for n in out {
      if n == t.namespace_ {
        seen = true
        break
      }
    }
    if !seen {
      out.push(t.namespace_)
    }
  }
  out
}

///|
pub fn DynamicCatalog::has_namespace(
  self : DynamicCatalog,
  ns : String,
) -> Bool {
  for t in self.tools {
    if t.namespace_ == ns {
      return true
    }
  }
  false
}
