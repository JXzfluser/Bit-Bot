///|
/// CM-0905 / CM-0903: needsAuth shows connect card; loading/error blocked; Ready proceeds.
test "acceptance_CM-0905_namespace_status_blocks_unusable" {
  let cat = @tools.DynamicCatalog::seed_example()
  let _ = cat.discover(ns=Some("user-Gmail"))
  let call = @tools.DynamicCall::{
    namespace_: "user-Gmail",
    name: "search_threads",
    arguments_json: "{}",
    write_to_file: false,
  }
  match cat.call_gated(call, @connectors.NeedsAuth) {
    @tools.Blocked(reason~) => {
      assert_true(reason.has_prefix("connect_card:"))
      assert_true(reason.contains("needsAuth"))
    }
    _ => fail("needsAuth must block with connect card")
  }
  match @tools.gate_before_dynamic_call("user-Gmail", @connectors.NeedsAuth) {
    @tools.ShowConnectCard(_) => ()
    _ => fail("needsAuth → ShowConnectCard")
  }
  match cat.call_gated(call, @connectors.Loading) {
    @tools.Blocked(_) => ()
    _ => fail("loading must refuse")
  }
  match cat.call_gated(call, @connectors.Ready) {
    @tools.Ok(_) => ()
    _ => fail("Ready must proceed after discover")
  }
}

///|
/// CM-0901 matrix: discover before call; truncated → get_full.
test "acceptance_CM-0901_discover_then_full_description" {
  let cat = @tools.DynamicCatalog::seed_example()
  assert_false(cat.is_discovered("user-Gmail", "search_threads"))
  let listed = cat.discover(ns=Some("user-Gmail"))
  assert_true(listed.length() >= 2)
  assert_true(cat.is_discovered("user-Gmail", "search_threads"))
  let trunc = listed[0]
  assert_true(trunc.truncated)
  match cat.get_full("user-Gmail", "search_threads") {
    Ok(full) => {
      assert_false(full.truncated)
      assert_true(full.description.length() > trunc.description.length())
    }
    Err(e) => fail(e)
  }
}
