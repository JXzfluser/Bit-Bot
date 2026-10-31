///|
/// CM-1805: food-ordering / restaurant-* — Resy / OpenTable / DoorDash playbooks.

///|
pub fn food_ordering_skill_name() -> String {
  "food-ordering"
}

///|
pub fn restaurant_skill_name() -> String {
  "restaurant"
}

///|
/// Food-ordering / restaurant site playbooks.
pub fn food_ordering_site_ids() -> Array[SitePlaybookId] {
  [Resy, Opentable, Doordash]
}

///|
pub fn SitePlaybookId::is_food_ordering(self : SitePlaybookId) -> Bool {
  match self {
    Resy | Opentable | Doordash => true
    Airbnb
    | Bestbuy
    | Costco
    | Craigslist
    | Ebay
    | Etsy
    | Expedia
    | FacebookMarketplace
    | Fedex
    | GoogleFlights
    | Instacart
    | Linkedin
    | Luma
    | Realtor
    | Southwest
    | Target
    | United
    | Ups
    | Usps => false
  }
}

///|
/// CM-1805: dispatch Resy / OpenTable / DoorDash playbook.
pub fn dispatch_food_ordering_playbook(
  url_or_host : String,
) -> Result[PlaybookDispatchSnippet, String] {
  let cat = SitePlaybookCatalog::seed_full_catalog()
  match cat.match_site(url_or_host) {
    None => Err("no food-ordering playbook for: " + url_or_host)
    Some(p) => {
      let mut allowed = false
      for id in food_ordering_site_ids() {
        if p.name == id.skill_name() {
          allowed = true
        }
      }
      if !allowed {
        return Err("site is not a food-ordering/restaurant playbook: " + p.name)
      }
      cat.prepare_dispatch(url_or_host)
    }
  }
}

///|
pub fn food_ordering_skill_trigger_hit(utterance_or_url : String) -> Bool {
  let lower = utterance_or_url.to_lower()
  if lower.contains("food-ordering") ||
    lower.contains("restaurant") ||
    lower.contains("reserve a table") ||
    lower.contains("order food") ||
    lower.contains("delivery") {
    return true
  }
  for id in food_ordering_site_ids() {
    if lower.contains(id.site_host()) || lower.contains(id.skill_name()) {
      return true
    }
  }
  false
}
