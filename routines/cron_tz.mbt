///|
/// CM-0402: schedule context — default interpretation in user IANA tz;
/// optional `CRON_TZ=<iana>` prefix on the expression overrides.
pub(all) struct CronContext {
  user_tz : String
  expr : String
} derive(Eq, Debug)

///|
pub extend CronContext with Eq::{equal, not_equal}

///|
pub extend CronContext with Debug::{to_repr}

///|
pub fn CronContext::new(user_tz~ : String, expr~ : String) -> CronContext {
  { user_tz, expr, }
}

///|
/// Split optional `CRON_TZ=<iana> ` prefix from a cron expression.
/// Returns (override_tz?, body_expr).
pub fn parse_cron_tz_prefix(expr : String) -> (String?, String) {
  if !expr.has_prefix("CRON_TZ=") {
    return (None, expr)
  }
  let rest = expr[8:].to_owned()
  // Find first whitespace separating tz name from cron body.
  let mut i = 0
  while i < rest.length() {
    let c = rest[i]
    if c == ' ' || c == '\t' {
      break
    }
    i = i + 1
  }
  if i == 0 {
    return (None, expr)
  }
  let tz = rest[:i].to_owned()
  // Skip whitespace after tz.
  let mut j = i
  while j < rest.length() {
    let c = rest[j]
    if c != ' ' && c != '\t' {
      break
    }
    j = j + 1
  }
  let body = rest[j:].to_owned()
  (Some(tz), body)
}

///|
/// Resolved timezone: CRON_TZ= prefix wins; else user IANA tz on the context.
pub fn CronContext::resolved_tz(self : CronContext) -> String {
  match parse_cron_tz_prefix(self.expr) {
    (Some(tz), _) => tz
    (None, _) => self.user_tz
  }
}

///|
/// Cron body with any CRON_TZ= prefix stripped (for field/macro validation).
pub fn CronContext::cron_body(self : CronContext) -> String {
  match parse_cron_tz_prefix(self.expr) {
    (_, body) => body
  }
}

///|
/// Validate the cron body (5-field / @hourly / @every ≥5m), ignoring CRON_TZ=.
pub fn CronContext::validate(self : CronContext) -> Result[Unit, String] {
  validate_cron(self.cron_body())
}
