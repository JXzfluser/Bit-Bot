///|
test "connector status" {
  let ns = @connectors.McpNamespace::{
    id: "user-Gmail",
    display_name: "Gmail",
    tool_count: 20,
  }
  let h = @connectors.ConnectorHandle::{ mcp: ns, status: @connectors.Ready, }
  assert_eq(h.status.is_usable(), true)
  assert_eq(@connectors.NeedsAuth.is_usable(), false)
}
