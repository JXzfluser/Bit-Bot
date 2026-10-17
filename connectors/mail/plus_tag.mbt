///|
/// CM-1008: +tag addresses — name+tag@domain; To/Cc show tag; routines match tag only.
pub(all) struct PlusTagAddress {
  local_part : String
  tag : String?
  domain : String
} derive(Eq, Debug)

///|
pub extend PlusTagAddress with Eq::{equal, not_equal}

///|
pub extend PlusTagAddress with Debug::{to_repr}

///|
/// Parse local[+tag]@domain. Tag is the part after '+' before '@'.
pub fn parse_plus_tag_address(raw : String) -> Result[PlusTagAddress, String] {
  match raw.find("@") {
    None => Err("address missing @: " + raw)
    Some(at_i) => {
      if at_i == 0 || at_i >= raw.length() - 1 {
        return Err("invalid address: " + raw)
      }
      let local_full = raw[:at_i].to_owned()
      let domain = raw[at_i + 1:].to_owned()
      match local_full.find("+") {
        None => Ok({ local_part: local_full, tag: None, domain, })
        Some(p) => {
          if p == 0 {
            return Err("empty local before +tag: " + raw)
          }
          let local_part = local_full[:p].to_owned()
          let tag_raw = local_full[p + 1:].to_owned()
          if tag_raw.length() == 0 {
            return Err("empty +tag: " + raw)
          }
          Ok({ local_part, tag: Some(tag_raw), domain, })
        }
      }
    }
  }
}

///|
/// Render for To/Cc — tag remains visible when present.
pub fn PlusTagAddress::to_header(self : PlusTagAddress) -> String {
  match self.tag {
    None => self.local_part + "@" + self.domain
    Some(t) => self.local_part + "+" + t + "@" + self.domain
  }
}

///|
pub fn PlusTagAddress::has_tag(self : PlusTagAddress) -> Bool {
  match self.tag {
    Some(_) => true
    None => false
  }
}

///|
pub fn PlusTagAddress::tag_or_empty(self : PlusTagAddress) -> String {
  match self.tag {
    Some(t) => t
    None => ""
  }
}

///|
/// CM-1008: routine filter matches the +tag only (not bare local).
pub fn routine_matches_plus_tag(
  filter_tag~ : String,
  address~ : PlusTagAddress,
) -> Bool {
  let want = if filter_tag.has_prefix("+") {
    filter_tag[1:].to_owned()
  } else {
    filter_tag
  }
  if want.length() == 0 {
    return false
  }
  match address.tag {
    None => false
    Some(t) => t == want
  }
}

///|
/// Envelope To/Cc lines that must show the tag when present.
pub(all) struct MailRecipients {
  to_ : Array[PlusTagAddress]
  cc : Array[PlusTagAddress]
} derive(Eq, Debug)

///|
pub extend MailRecipients with Eq::{equal, not_equal}

///|
pub extend MailRecipients with Debug::{to_repr}

///|
pub fn MailRecipients::to_headers_show_tags(
  self : MailRecipients,
) -> Array[String] {
  let out : Array[String] = []
  for a in self.to_ {
    out.push(a.to_header())
  }
  out
}

///|
pub fn MailRecipients::cc_headers_show_tags(
  self : MailRecipients,
) -> Array[String] {
  let out : Array[String] = []
  for a in self.cc {
    out.push(a.to_header())
  }
  out
}
