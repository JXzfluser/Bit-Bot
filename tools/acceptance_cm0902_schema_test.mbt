///|
/// CM-0902: CallDynamicTool args must satisfy schema; write_to_file path for large result.
test "acceptance_CM-0902_schema_required_and_write_to_file" {
  let cat = @tools.DynamicCatalog::seed_example()
  let _ = cat.discover(ns=Some("user-Gmail"))
  // Missing required → Err
  match
    cat.call_with_schema(@tools.DynamicCall::{
      namespace_: "user-Gmail",
      name: "create_draft",
      arguments_json: "{\"to\":\"a@x.com\"}",
      write_to_file: false,
    }) {
    @tools.Err(message~) => assert_true(message.contains("subject"))
    _ => fail("missing subject must Err")
  }
  // Complete required → Ok
  match
    cat.call_with_schema(@tools.DynamicCall::{
      namespace_: "user-Gmail",
      name: "create_draft",
      arguments_json: "{\"to\":\"a@x.com\",\"subject\":\"Hi\"}",
      write_to_file: false,
    }) {
    @tools.Ok(_) => ()
    @tools.Err(message~) => fail(message)
    _ => fail("unexpected")
  }
  // Large result write_to_file → path under /workspace/agent-tools/
  match
    cat.call_with_schema(@tools.DynamicCall::{
      namespace_: "user-Gmail",
      name: "create_draft",
      arguments_json: "{\"to\":\"a@x.com\",\"subject\":\"Hi\",\"body\":\"big\"}",
      write_to_file: true,
    }) {
    @tools.Ok(output~) => {
      assert_true(output.contains("/workspace/agent-tools/"))
      assert_true(output.contains("wrote result to"))
    }
    @tools.Err(message~) => fail(message)
    _ => fail("unexpected")
  }
}
