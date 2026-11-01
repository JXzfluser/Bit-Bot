///|
/// CM-1803: shopping / retail playbooks — Target/BestBuy/Costco; dispatch usable.
test "acceptance_CM-1803_shopping_retail_playbooks_dispatch" {
  assert_eq(@skills.shopping_skill_name(), "shopping")
  let retail = @skills.shopping_retail_site_ids()
  assert_true(retail.length() >= 3)
  assert_true(@skills.Target.is_shopping_retail())
  assert_true(@skills.Bestbuy.is_shopping_retail())
  assert_true(@skills.Costco.is_shopping_retail())
  assert_false(@skills.Doordash.is_shopping_retail())
  // Dispatch usable for Target / BestBuy / Costco.
  for
    url in [
      "https://www.target.com/p/abc", "https://www.bestbuy.com/site/xyz", "https://www.costco.com/grocery",
    ] {
    match @skills.dispatch_shopping_playbook(url) {
      Err(e) => fail(e)
      Ok(snip) => {
        assert_true(snip.read_first)
        assert_true(snip.playbook_name.has_prefix("site-playbooks-"))
        assert_true(snip.snippet.length() > 0)
        assert_true(snip.child_task_prompt.contains("site-playbook:"))
      }
    }
  }
  assert_true(
    @skills.shopping_skill_trigger_hit("shop at Target for headphones"),
  )
  assert_true(@skills.shopping_skill_trigger_hit("https://www.bestbuy.com/"))
  // Non-retail site must not dispatch as shopping.
  match @skills.dispatch_shopping_playbook("https://www.resy.com/") {
    Err(m) =>
      assert_true(
        m.contains("shopping") || m.contains("retail") || m.contains("not"),
      )
    Ok(_) => fail("resy must not be shopping/retail dispatch")
  }
}
