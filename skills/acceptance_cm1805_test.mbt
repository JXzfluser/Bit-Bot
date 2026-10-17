///|
/// CM-1805: food-ordering / restaurant-* — Resy/OpenTable/DoorDash playbooks.
test "acceptance_CM-1805_food_ordering_restaurant_playbooks" {
  assert_eq(@skills.food_ordering_skill_name(), "food-ordering")
  assert_eq(@skills.restaurant_skill_name(), "restaurant")
  let sites = @skills.food_ordering_site_ids()
  assert_eq(sites.length(), 3)
  assert_true(@skills.Resy.is_food_ordering())
  assert_true(@skills.Opentable.is_food_ordering())
  assert_true(@skills.Doordash.is_food_ordering())
  assert_false(@skills.Target.is_food_ordering())
  for
    url in [
      "https://resy.com/cities/ny/venue",
      "https://www.opentable.com/r/demo",
      "https://www.doordash.com/store/1",
    ] {
    match @skills.dispatch_food_ordering_playbook(url) {
      Err(e) => fail(e)
      Ok(snip) => {
        assert_true(snip.read_first)
        assert_true(
          snip.playbook_name.contains("resy") ||
          snip.playbook_name.contains("opentable") ||
          snip.playbook_name.contains("doordash"),
        )
        assert_true(snip.child_task_prompt.contains("site-playbook:"))
      }
    }
  }
  assert_true(@skills.food_ordering_skill_trigger_hit("order food on DoorDash"))
  assert_true(@skills.food_ordering_skill_trigger_hit("reserve a table on Resy"))
  match @skills.dispatch_food_ordering_playbook("https://www.target.com/") {
    Err(m) =>
      assert_true(
        m.contains("food") || m.contains("restaurant") || m.contains("not"),
      )
    Ok(_) => fail("target must not be food-ordering playbook")
  }
}
