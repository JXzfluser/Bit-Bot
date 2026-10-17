///|
/// CM-0416: parsed destination line from a saved routine prompt.
pub(all) struct DestinationLine {
  raw : String
  recipients : Array[String]
  on_empty : String
} derive(Eq, Debug)

///|
pub extend DestinationLine with Eq::{equal, not_equal}

///|
pub extend DestinationLine with Debug::{to_repr}

///|
fn last_nonempty_line(prompt : String) -> String {
  let parts = prompt.split("\n").to_array()
  let mut i = parts.length() - 1
  while i >= 0 {
    let line = parts[i].to_owned()
    let trimmed = trim_ws(line)
    if trimmed.length() > 0 {
      return trimmed
    }
    i = i - 1
  }
  ""
}

///|
fn trim_ws(s : String) -> String {
  let mut start = 0
  while start < s.length() {
    let c = s[start]
    if c == ' ' || c == '\t' {
      start = start + 1
    } else {
      break
    }
  }
  let mut end = s.length()
  while end > start {
    let c = s[end - 1]
    if c == ' ' || c == '\t' {
      end = end - 1
    } else {
      break
    }
  }
  s[start:end].to_owned()
}

///|
/// CM-0416: extract destination line — who receives results / what if empty.
/// Looks for a trailing line starting with "Destination:" (case-insensitive prefix).
pub fn parse_destination_line(
  prompt : String,
) -> Result[DestinationLine, String] {
  let line = last_nonempty_line(prompt)
  if line.length() == 0 {
    return Err("prompt has no destination line")
  }
  let lower = line.to_lower()
  if !(lower.has_prefix("destination:") || lower.has_prefix("目的地:")) {
    return Err("last line must be a Destination: line")
  }
  let body = if lower.has_prefix("destination:") {
    trim_ws(line[12:].to_owned())
  } else {
    // "目的地:" is 4 chars in UTF-8 sense — MoonBit String index is by code unit;
    // use find for safety.
    match line.find(":") {
      None => trim_ws(line)
      Some(at) => trim_ws(line[at + 1:].to_owned())
    }
  }
  // Split recipients from on_empty clause separated by ';' or '；'
  let mut recipients_part = body
  let mut on_empty = "stay silent"
  match body.find(";") {
    Some(at) => {
      recipients_part = trim_ws(body[:at].to_owned())
      on_empty = trim_ws(body[at + 1:].to_owned())
    }
    None =>
      match body.find("；") {
        Some(at) => {
          recipients_part = trim_ws(body[:at].to_owned())
          on_empty = trim_ws(body[at + 1:].to_owned())
        }
        None => ()
      }
  }
  let recipients : Array[String] = []
  // Recipients separated by ',' 
  let chunks = recipients_part.split(",").to_array()
  for c in chunks {
    let t = trim_ws(c.to_owned())
    if t.length() > 0 {
      recipients.push(t)
    }
  }
  if recipients.length() == 0 {
    return Err("destination line has no recipients")
  }
  Ok({ raw: line, recipients, on_empty, })
}

///|
/// CM-0416: plan batch delivery — strictly follow destination recipients;
/// reject unauthorized fan-out / broadcast extras.
pub fn plan_batch_delivery(
  prompt : String,
  attempted_targets : Array[String],
) -> Result[Array[String], String] {
  match parse_destination_line(prompt) {
    Err(e) => Err(e)
    Ok(dest) => {
      // Every attempted target must be in the destination list.
      for t in attempted_targets {
        let mut allowed = false
        for r in dest.recipients {
          if r == t {
            allowed = true
          }
        }
        if !allowed {
          return Err(
            "unauthorized fan-out/broadcast to " +
            t +
            "; destination line forbids it",
          )
        }
      }
      // Delivery set is exactly the destination recipients (no extras).
      Ok(dest.recipients)
    }
  }
}

///|
/// True when attempted set equals destination recipients (order-insensitive subset check already done).
pub fn DestinationLine::allows_only(
  self : DestinationLine,
  targets : Array[String],
) -> Bool {
  for t in targets {
    let mut ok = false
    for r in self.recipients {
      if r == t {
        ok = true
      }
    }
    if !ok {
      return false
    }
  }
  true
}
