///|
test "builtin tools catalog" {
  let all = @tools.BuiltinTool::all()
  assert_eq(all.length() >= 20, true)
  assert_eq(@tools.Shell.name(), "Shell")
  assert_eq(@tools.WebSearch.name(), "WebSearch")
  let spec = @tools.ToolSpec::{
    id: "shell",
    description: "Run a shell command",
    builtin: Some(@tools.Shell),
    input_schema_json: "{}",
    requires_approval: true,
  }
  assert_eq(spec.requires_approval, true)
  let ok = @tools.Ok(output="done")
  assert_eq(ok.is_ok(), true)
}
