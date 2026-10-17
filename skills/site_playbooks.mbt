///|
/// CM-0507: site-playbooks — match site, Read first, then Dispatch snippet.

///|
pub(all) struct SitePlaybook {
  name : String
  /// Host substring that matches a target site (e.g. "airbnb.com").
  site_host : String
  skill_md : String
  /// Deep-link / stop-rule snippet handed to computerUse child task.
  snippet : String
  stop_rules : String
} derive(Eq, Debug)

///|
pub extend SitePlaybook with Eq::{equal, not_equal}

///|
pub extend SitePlaybook with Debug::{to_repr}

///|
pub(all) struct SitePlaybookCatalog {
  playbooks : Array[SitePlaybook]
  /// Paths already Read (CM-0507: match site → Read first).
  read_log : Array[String]
}

///|
pub fn SitePlaybookCatalog::empty() -> SitePlaybookCatalog {
  { playbooks: [], read_log: [], }
}

///|
pub fn SitePlaybookCatalog::seed_demo() -> SitePlaybookCatalog {
  let cat = SitePlaybookCatalog::empty()
  cat.playbooks.push({
    name: "site-playbooks-airbnb",
    site_host: "airbnb.com",
    skill_md: "# site-playbooks-airbnb\n\nDeep links and stop rules for Airbnb.\n",
    snippet: "NAVIGATE airbnb checkout; STOP on captcha/login; REPORT outcome only",
    stop_rules: "stop on captcha; stop on login wall",
  })
  cat.playbooks.push({
    name: "site-playbooks-expedia",
    site_host: "expedia.com",
    skill_md: "# site-playbooks-expedia\n\nExpedia booking playbook.\n",
    snippet: "NAVIGATE expedia search; STOP on payment confirm ask",
    stop_rules: "stop before irreversible payment",
  })
  cat
}

///|
/// Match a URL / host to a site playbook (if any).
pub fn SitePlaybookCatalog::match_site(
  self : SitePlaybookCatalog,
  url_or_host : String,
) -> SitePlaybook? {
  let lower = url_or_host.to_lower()
  for p in self.playbooks {
    if lower.contains(p.site_host) {
      return Some(p)
    }
  }
  None
}

///|
/// CM-0507: Read playbook body first (records read evidence).
pub fn SitePlaybookCatalog::read_playbook(
  self : SitePlaybookCatalog,
  name : String,
) -> Result[String, String] {
  for p in self.playbooks {
    if p.name == name {
      self.read_log.push(name)
      return Ok(p.skill_md)
    }
  }
  Err("unknown site playbook: " + name)
}

///|
pub fn SitePlaybookCatalog::was_read(
  self : SitePlaybookCatalog,
  name : String,
) -> Bool {
  for n in self.read_log {
    if n == name {
      return true
    }
  }
  false
}

///|
/// Prepared computerUse child-task payload after Read-first.
pub(all) struct PlaybookDispatchSnippet {
  playbook_name : String
  snippet : String
  read_first : Bool
  child_task_prompt : String
} derive(Eq, Debug)

///|
pub extend PlaybookDispatchSnippet with Eq::{equal, not_equal}

///|
pub extend PlaybookDispatchSnippet with Debug::{to_repr}

///|
/// Match site → Read first → build snippet for Dispatch into computerUse child.
pub fn SitePlaybookCatalog::prepare_dispatch(
  self : SitePlaybookCatalog,
  url_or_host : String,
) -> Result[PlaybookDispatchSnippet, String] {
  match self.match_site(url_or_host) {
    None => Err("no site-playbook match for: " + url_or_host)
    Some(p) =>
      match self.read_playbook(p.name) {
        Err(e) => Err(e)
        Ok(_) => {
          let prompt = "[site-playbook:" +
            p.name +
            "]\n" +
            p.snippet +
            "\n# stop: " +
            p.stop_rules
          Ok({
            playbook_name: p.name,
            snippet: p.snippet,
            read_first: true,
            child_task_prompt: prompt,
          })
        }
      }
  }
}

///|
/// CM-2111: site-playbooks catalog family enum (22 sites).
/// Enum members match loader keys 1:1.
pub(all) enum SitePlaybookId {
  Airbnb
  Bestbuy
  Costco
  Craigslist
  Doordash
  Ebay
  Etsy
  Expedia
  FacebookMarketplace
  Fedex
  GoogleFlights
  Instacart
  Linkedin
  Luma
  Opentable
  Realtor
  Resy
  Southwest
  Target
  United
  Ups
  Usps
} derive(Eq, Debug)

///|
pub extend SitePlaybookId with Eq::{equal, not_equal}

///|
pub extend SitePlaybookId with Debug::{to_repr}

///|
/// Canonical skill name for a site id (loader key).
pub fn SitePlaybookId::skill_name(self : SitePlaybookId) -> String {
  match self {
    Airbnb => "site-playbooks-airbnb"
    Bestbuy => "site-playbooks-bestbuy"
    Costco => "site-playbooks-costco"
    Craigslist => "site-playbooks-craigslist"
    Doordash => "site-playbooks-doordash"
    Ebay => "site-playbooks-ebay"
    Etsy => "site-playbooks-etsy"
    Expedia => "site-playbooks-expedia"
    FacebookMarketplace => "site-playbooks-facebook-marketplace"
    Fedex => "site-playbooks-fedex"
    GoogleFlights => "site-playbooks-google-flights"
    Instacart => "site-playbooks-instacart"
    Linkedin => "site-playbooks-linkedin"
    Luma => "site-playbooks-luma"
    Opentable => "site-playbooks-opentable"
    Realtor => "site-playbooks-realtor"
    Resy => "site-playbooks-resy"
    Southwest => "site-playbooks-southwest"
    Target => "site-playbooks-target"
    United => "site-playbooks-united"
    Ups => "site-playbooks-ups"
    Usps => "site-playbooks-usps"
  }
}

///|
/// Host substring used by the loader for matching.
pub fn SitePlaybookId::site_host(self : SitePlaybookId) -> String {
  match self {
    Airbnb => "airbnb.com"
    Bestbuy => "bestbuy.com"
    Costco => "costco.com"
    Craigslist => "craigslist.org"
    Doordash => "doordash.com"
    Ebay => "ebay.com"
    Etsy => "etsy.com"
    Expedia => "expedia.com"
    FacebookMarketplace => "facebook.com/marketplace"
    Fedex => "fedex.com"
    GoogleFlights => "google.com/flights"
    Instacart => "instacart.com"
    Linkedin => "linkedin.com"
    Luma => "lu.ma"
    Opentable => "opentable.com"
    Realtor => "realtor.com"
    Resy => "resy.com"
    Southwest => "southwest.com"
    Target => "target.com"
    United => "united.com"
    Ups => "ups.com"
    Usps => "usps.com"
  }
}

///|
/// Full catalog family — order is stable and matches enum exhaustiveness.
pub fn site_playbook_catalog_family() -> Array[SitePlaybookId] {
  [
    Airbnb,
    Bestbuy,
    Costco,
    Craigslist,
    Doordash,
    Ebay,
    Etsy,
    Expedia,
    FacebookMarketplace,
    Fedex,
    GoogleFlights,
    Instacart,
    Linkedin,
    Luma,
    Opentable,
    Realtor,
    Resy,
    Southwest,
    Target,
    United,
    Ups,
    Usps,
  ]
}

///|
fn make_playbook(id : SitePlaybookId) -> SitePlaybook {
  let name = id.skill_name()
  let host = id.site_host()
  {
    name,
    site_host: host,
    skill_md: "# " + name + "\n\nPlaybook for " + host + ".\n",
    snippet: "NAVIGATE " + host + "; STOP on captcha/login; REPORT outcome only",
    stop_rules: "stop on captcha; stop on login wall; stop before irreversible payment",
  }
}

///|
/// CM-2111: loader seeds the full catalog family (enum ↔ playbooks 1:1).
pub fn SitePlaybookCatalog::seed_full_catalog() -> SitePlaybookCatalog {
  let cat = SitePlaybookCatalog::empty()
  for id in site_playbook_catalog_family() {
    cat.playbooks.push(make_playbook(id))
  }
  cat
}

///|
/// Enumerate loader skill names (must match family enum).
pub fn SitePlaybookCatalog::list_skill_names(
  self : SitePlaybookCatalog,
) -> Array[String] {
  let out : Array[String] = []
  for p in self.playbooks {
    out.push(p.name)
  }
  out
}

///|
/// CM-2111: map a single SitePlaybookId to its loaded playbook.
pub fn SitePlaybookCatalog::map_site(
  self : SitePlaybookCatalog,
  id : SitePlaybookId,
) -> Result[SitePlaybook, String] {
  let want = id.skill_name()
  for p in self.playbooks {
    if p.name == want {
      return Ok(p)
    }
  }
  Err("site not in loader: " + want)
}

///|
/// True when every family enum member is present in the loader.
pub fn SitePlaybookCatalog::enum_matches_loader(
  self : SitePlaybookCatalog,
) -> Bool {
  let family = site_playbook_catalog_family()
  if self.playbooks.length() != family.length() {
    return false
  }
  for id in family {
    match self.map_site(id) {
      Err(_) => return false
      Ok(p) => if p.site_host != id.site_host() { return false }
    }
  }
  true
}
