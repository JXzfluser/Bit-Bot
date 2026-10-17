///|
/// CM-1803: shopping / retail playbooks — Target / BestBuy / Costco etc;
/// playbook dispatch usable.

///|
pub fn shopping_skill_name() -> String {
  "shopping"
}

///|
/// Retail site ids covered by shopping playbooks.
pub fn shopping_retail_site_ids() -> Array[SitePlaybookId] {
  [Target, Bestbuy, Costco, Ebay, Etsy, Instacart, FacebookMarketplace]
}

///|
pub fn SitePlaybookId::is_shopping_retail(self : SitePlaybookId) -> Bool {
  match self {
    Target | Bestbuy | Costco | Ebay | Etsy | Instacart | FacebookMarketplace =>
      true
    Airbnb | Craigslist | Doordash | Expedia | Fedex | GoogleFlights |
    Linkedin | Luma | Opentable | Realtor | Resy | Southwest | United | Ups |
    Usps => false
  }
}

///|
/// CM-1803: dispatch shopping/retail playbook for a URL or host.
pub fn dispatch_shopping_playbook(
  url_or_host : String,
) -> Result[PlaybookDispatchSnippet, String] {
  let cat = SitePlaybookCatalog::seed_full_catalog()
  match cat.match_site(url_or_host) {
    None => Err("no shopping/retail playbook for: " + url_or_host)
    Some(p) => {
      // Only allow retail family for shopping skill dispatch.
      let mut allowed = false
      for id in shopping_retail_site_ids() {
        if p.name == id.skill_name() {
          allowed = true
        }
      }
      if !allowed {
        return Err("site is not a shopping/retail playbook: " + p.name)
      }
      cat.prepare_dispatch(url_or_host)
    }
  }
}

///|
/// Whether shopping skill trigger conditions hit for utterance/URL.
pub fn shopping_skill_trigger_hit(utterance_or_url : String) -> Bool {
  let lower = utterance_or_url.to_lower()
  if lower.contains("shop") ||
    lower.contains("buy") ||
    lower.contains("retail") ||
    lower.contains("add to cart") {
    return true
  }
  for id in shopping_retail_site_ids() {
    if lower.contains(id.site_host()) || lower.contains(id.skill_name()) {
      return true
    }
  }
  false
}
