///|
/// CM-1806: job-search / linkedin playbook — readonly search flow runnable.

///|
pub fn job_search_skill_name() -> String {
  "job-search"
}

///|
pub fn linkedin_playbook_skill_name() -> String {
  "site-playbooks-linkedin"
}

///|
/// Result of a readonly LinkedIn / job-search flow.
pub(all) struct JobSearchReadonlyResult {
  query : String
  playbook_name : String
  /// Readonly: never mutates profile / applies / messages.
  readonly_ : Bool
  hit_count : Int32
  snippets : Array[String]
} derive(Eq, Debug)

///|
pub extend JobSearchReadonlyResult with Eq::{equal, not_equal}

///|
pub extend JobSearchReadonlyResult with Debug::{to_repr}

///|
/// Kernel-contract mock LinkedIn job index.
pub(all) struct JobSearchHost {
  listings : Array[(String, String)]
}

///|
pub fn JobSearchHost::mock() -> JobSearchHost {
  {
    listings: [
      ("senior moonbit engineer", "LinkedIn · Bit Corp · Remote"),
      ("staff platform engineer", "LinkedIn · Acme · SF"),
      ("backend engineer rust", "LinkedIn · Orbit · NYC"),
    ],
  }
}

///|
/// CM-1806: run readonly LinkedIn job-search playbook flow.
pub fn JobSearchHost::run_linkedin_readonly_search(
  self : JobSearchHost,
  query~ : String,
) -> Result[JobSearchReadonlyResult, String] {
  if query.length() == 0 {
    return Err("job-search query must not be empty")
  }
  // Playbook Read-first via site catalog (linkedin).
  let cat = SitePlaybookCatalog::seed_full_catalog()
  match cat.map_site(Linkedin) {
    Err(e) => return Err(e)
    Ok(p) =>
      match cat.read_playbook(p.name) {
        Err(e) => return Err(e)
        Ok(_) => ()
      }
  }
  let lower = query.to_lower()
  let snippets : Array[String] = []
  for pair in self.listings {
    let (title, snip) = pair
    if title.to_lower().contains(lower) ||
      snip.to_lower().contains(lower) ||
      lower.contains("engineer") {
      snippets.push(title + " — " + snip)
    }
  }
  // Always return the flow as runnable readonly even if zero hits.
  Ok({
    query,
    playbook_name: linkedin_playbook_skill_name(),
    readonly_: true,
    hit_count: snippets.length(),
    snippets,
  })
}

///|
/// Reject write/apply actions on the readonly job-search path.
pub fn JobSearchHost::try_apply_or_message(
  self : JobSearchHost,
  _action : String,
) -> Result[Unit, String] {
  let _ = self
  Err("job-search / linkedin playbook is readonly; apply/message not allowed")
}

///|
pub fn job_search_skill_trigger_hit(utterance_or_url : String) -> Bool {
  let lower = utterance_or_url.to_lower()
  lower.contains("job-search") ||
  lower.contains("job search") ||
  lower.contains("linkedin") ||
  lower.contains("find jobs") ||
  lower.contains("site-playbooks-linkedin")
}
