///|
/// CM-1804: flight / accommodation / rideshare vertical flows;
/// corresponding SKILL trigger conditions hit.

///|
pub(all) enum TravelVertical {
  Flight
  Accommodation
  Rideshare
} derive(Eq, Debug)

///|
pub extend TravelVertical with Eq::{equal, not_equal}

///|
pub extend TravelVertical with Debug::{to_repr}

///|
pub fn TravelVertical::skill_name(self : TravelVertical) -> String {
  match self {
    Flight => "flight"
    Accommodation => "accommodation"
    Rideshare => "rideshare"
  }
}

///|
/// Site playbooks that map to the flight vertical.
pub fn flight_site_ids() -> Array[SitePlaybookId] {
  [GoogleFlights, Southwest, United, Expedia]
}

///|
/// Site playbooks that map to accommodation.
pub fn accommodation_site_ids() -> Array[SitePlaybookId] {
  [Airbnb, Expedia]
}

///|
/// CM-1804: match utterance/URL to a travel vertical SKILL trigger.
pub fn match_travel_skill_trigger(utterance_or_url : String) -> TravelVertical? {
  let lower = utterance_or_url.to_lower()
  // Rideshare keywords (no dedicated site-playbook in the 22-site family).
  if lower.contains("rideshare") ||
    lower.contains("uber") ||
    lower.contains("lyft") ||
    lower.contains("ride hail") ||
    lower.contains("ride-hail") {
    return Some(Rideshare)
  }
  for id in flight_site_ids() {
    if lower.contains(id.site_host()) || lower.contains(id.skill_name()) {
      return Some(Flight)
    }
  }
  if lower.contains("flight") ||
    lower.contains("airline") ||
    lower.contains("book a flight") {
    return Some(Flight)
  }
  for id in accommodation_site_ids() {
    if lower.contains(id.site_host()) || lower.contains(id.skill_name()) {
      return Some(Accommodation)
    }
  }
  if lower.contains("hotel") ||
    lower.contains("accommodation") ||
    lower.contains("airbnb") ||
    lower.contains("lodging") {
    return Some(Accommodation)
  }
  None
}

///|
/// True when the corresponding vertical SKILL trigger condition is hit.
pub fn travel_skill_trigger_hit(
  vertical : TravelVertical,
  utterance_or_url : String,
) -> Bool {
  match match_travel_skill_trigger(utterance_or_url) {
    Some(v) => v == vertical
    None => false
  }
}

///|
/// Dispatch flight/accommodation site playbook when a site URL is given.
pub fn dispatch_travel_playbook(
  url_or_host : String,
) -> Result[(TravelVertical, PlaybookDispatchSnippet), String] {
  match match_travel_skill_trigger(url_or_host) {
    None => Err("no travel vertical trigger for: " + url_or_host)
    Some(Rideshare) =>
      // Rideshare is keyword SKILL hit; no site-playbook dispatch required.
      Ok(
        (
          Rideshare,
          {
            playbook_name: "rideshare",
            snippet: "RIDESHARE flow; STOP before payment confirm; REPORT outcome only",
            read_first: true,
            child_task_prompt: "[skill:rideshare]\nRIDESHARE flow; STOP before payment",
          },
        ),
      )
    Some(v) => {
      let cat = SitePlaybookCatalog::seed_full_catalog()
      match cat.prepare_dispatch(url_or_host) {
        Err(e) => Err(e)
        Ok(snip) => Ok((v, snip))
      }
    }
  }
}
