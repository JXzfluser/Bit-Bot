///|
/// CM-2111: site-playbooks catalog family — enum matches loader; single site maps.
test "acceptance_CM-2111_site_playbooks_catalog_loader_map" {
  let family = @skills.site_playbook_catalog_family()
  assert_eq(family.length(), 22)
  // Representative family members present.
  let mut saw_airbnb = false
  let mut saw_expedia = false
  let mut saw_doordash = false
  for id in family {
    if id is @skills.Airbnb {
      saw_airbnb = true
    }
    if id is @skills.Expedia {
      saw_expedia = true
    }
    if id is @skills.Doordash {
      saw_doordash = true
    }
  }
  assert_true(saw_airbnb)
  assert_true(saw_expedia)
  assert_true(saw_doordash)

  let cat = @skills.SitePlaybookCatalog::seed_full_catalog()
  assert_true(cat.enum_matches_loader())
  assert_eq(cat.list_skill_names().length(), 22)

  // Single site maps.
  match cat.map_site(@skills.Airbnb) {
    Ok(p) => {
      assert_eq(p.name, "site-playbooks-airbnb")
      assert_eq(p.site_host, "airbnb.com")
      assert_eq(p.name, @skills.Airbnb.skill_name())
    }
    Err(e) => fail(e)
  }
  match cat.map_site(@skills.Doordash) {
    Ok(p) => {
      assert_eq(p.name, "site-playbooks-doordash")
      assert_eq(p.site_host, "doordash.com")
    }
    Err(e) => fail(e)
  }
  match cat.match_site("https://www.doordash.com/store/1") {
    Some(p) => assert_eq(p.name, "site-playbooks-doordash")
    None => fail("doordash URL must map")
  }
  match cat.match_site("https://www.expedia.com/Flights") {
    Some(p) => assert_eq(p.name, "site-playbooks-expedia")
    None => fail("expedia URL must map")
  }
  // Enum ↔ loader host consistency for every family member.
  for id in family {
    match cat.map_site(id) {
      Ok(p) => {
        assert_eq(p.name, id.skill_name())
        assert_eq(p.site_host, id.site_host())
      }
      Err(e) => fail(e)
    }
  }
}
