///|
/// L-batch P0: CM-2160 browser navigate — public page reachable (kernel-contract mock).

///|
test "acceptance_CM-2160_browser_navigate_public_reachable" {
  match
    @computer_use.computer_use_navigate_public(
      agent_id="cu-l2160",
      url="https://example.com/",
    ) {
    Ok(r) => {
      assert_true(r.navigate_reachable)
      assert_true(r.public_page)
      assert_false(r.blocked)
      assert_true(r.evidence.contains("navigate_reachable=true"))
      assert_eq(r.url, "https://example.com/")
    }
    Err(e) => fail(e)
  }
  // Private / non-public targets are not "public reachable".
  match @computer_use.navigate_public("http://127.0.0.1:9222") {
    Ok(r) => {
      assert_false(r.navigate_reachable)
      assert_true(r.blocked)
    }
    Err(e) => fail(e)
  }
  match @computer_use.navigate_public("") {
    Err(_) => ()
    Ok(_) => fail("empty url must Err")
  }
}
