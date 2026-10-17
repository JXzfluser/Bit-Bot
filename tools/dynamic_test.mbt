///|
/// CM-0901: discover before call; truncated desc can refetch full.
test "acceptance_cm0901_discover_before_call" {
  let cat = @tools.DynamicCatalog::seed_example()
  let premature = @tools.DynamicCall::{
    namespace_: "user-Gmail",
    name: "search_threads",
    arguments_json: "{}",
    write_to_file: false,
  }
  match cat.call(premature) {
    @tools.Err(message~) => assert_true(message.has_prefix("must discover"))
    _ => fail("undiscovered call must fail")
  }
  let listed = cat.discover(ns=Some("user-Gmail"))
  assert_true(listed.length() >= 1)
  let truncated = listed[0]
  assert_true(truncated.truncated)
  match cat.get_full("user-Gmail", "search_threads") {
    Ok(full) => {
      assert_false(full.truncated)
      assert_true(full.description.length() > truncated.description.length())
    }
    Err(e) => fail(e)
  }
}

///|
/// CM-0902: refuse unknown; write_to_file path hint; $file: injection recorded.
test "acceptance_cm0902_call_write_and_file_placeholder" {
  let cat = @tools.DynamicCatalog::seed_example()
  let _ = cat.discover(ns=Some("user-Gmail"))
  match
    cat.call(@tools.DynamicCall::{
      namespace_: "user-Gmail",
      name: "nope",
      arguments_json: "{}",
      write_to_file: false,
    }) {
    @tools.Err(message~) => assert_true(message.has_prefix("unknown tool"))
    _ => fail("unknown must err")
  }
  let args = "{\"to\":\"a@x.com\",\"subject\":\"Hi\",\"body\":\"" +
    "$" +
    "file:/workspace/x.txt\"}"
  match
    cat.call(@tools.DynamicCall::{
      namespace_: "user-Gmail",
      name: "create_draft",
      arguments_json: args,
      write_to_file: true,
    }) {
    @tools.Ok(output~) => {
      assert_true(output.contains("/workspace/agent-tools/"))
      assert_true(output.contains("file_injection_requested"))
    }
    _ => fail("write_to_file call should succeed")
  }
  let reg = @tools.Registry::empty()
  match cat.get_full("user-Gmail", "create_draft") {
    Ok(d) => {
      reg.register_dynamic(d)
      assert_eq(reg.len(), 1)
    }
    Err(e) => fail(e)
  }
}

///|
/// CM-0902: schema required keys enforced; write_to_file returns workspace path.
test "acceptance_CM-0902_schema_positive_and_write_to_file" {
  let cat = @tools.DynamicCatalog::seed_example()
  let _ = cat.discover(ns=Some("user-Gmail"))
  // Missing required → Err
  match
    @tools.validate_args_against_schema(
      "{\"type\":\"object\",\"required\":[\"to\",\"subject\"]}", "{\"to\":\"a@x.com\"}",
    ) {
    Err(m) =>
      assert_true(m.contains("missing required") || m.contains("subject"))
    Ok(_) => fail("missing subject must err")
  }
  match
    cat.call(@tools.DynamicCall::{
      namespace_: "user-Gmail",
      name: "create_draft",
      arguments_json: "{\"to\":\"a@x.com\"}",
      write_to_file: false,
    }) {
    @tools.Err(message~) =>
      assert_true(
        message.contains("missing required") || message.contains("subject"),
      )
    _ => fail("call missing required must err")
  }
  // Positive schema + write_to_file → Ok with /workspace path
  match
    @tools.validate_args_against_schema(
      "{\"type\":\"object\",\"required\":[\"to\",\"subject\"]}", "{\"to\":\"a@x.com\",\"subject\":\"Hi\"}",
    ) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match
    cat.call(@tools.DynamicCall::{
      namespace_: "user-Gmail",
      name: "create_draft",
      arguments_json: "{\"to\":\"a@x.com\",\"subject\":\"Hi\"}",
      write_to_file: true,
    }) {
    @tools.Ok(output~) => {
      assert_true(output.contains("/workspace/"))
      assert_true(output.contains("agent-tools"))
    }
    _ => fail("schema-ok write_to_file must succeed with path")
  }
}
