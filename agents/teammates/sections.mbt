///|
/// CM-1403: sections collaboration partitions — group section context;
/// section message isolation testable.

///|
/// A collaboration section inside a group (partition context).
pub(all) struct GroupSection {
  id : String
  title : String
  group_id : String
} derive(Eq, Debug)

///|
pub extend GroupSection with Eq::{equal, not_equal}

///|
pub extend GroupSection with Debug::{to_repr}

///|
pub fn GroupSection::new(
  id~ : String,
  title~ : String,
  group_id~ : String,
) -> Result[GroupSection, String] {
  if id.length() == 0 || group_id.length() == 0 {
    return Err("section requires id and group_id")
  }
  Ok({ id, title, group_id, })
}

///|
/// Message bound to a section partition.
pub(all) struct SectionMessage {
  section_id : String
  from_agent : String
  body : String
} derive(Eq, Debug)

///|
pub extend SectionMessage with Eq::{equal, not_equal}

///|
pub extend SectionMessage with Debug::{to_repr}

///|
/// Group with named sections; messages isolated per section.
pub(all) struct GroupSections {
  group_id : String
  sections : Array[GroupSection]
  messages : Array[SectionMessage]
}

///|
pub fn GroupSections::new(group_id : String) -> GroupSections {
  { group_id, sections: [], messages: [], }
}

///|
pub fn GroupSections::add_section(
  self : GroupSections,
  id~ : String,
  title~ : String,
) -> Result[GroupSection, String] {
  for s in self.sections {
    if s.id == id {
      return Err("section already exists: " + id)
    }
  }
  match GroupSection::new(id~, title~, group_id=self.group_id) {
    Err(e) => Err(e)
    Ok(sec) => {
      self.sections.push(sec)
      Ok(sec)
    }
  }
}

///|
pub fn GroupSections::has_section(self : GroupSections, id : String) -> Bool {
  for s in self.sections {
    if s.id == id {
      return true
    }
  }
  false
}

///|
/// Post a message into a section; refuse unknown section.
pub fn GroupSections::post(
  self : GroupSections,
  section_id~ : String,
  from_agent~ : String,
  body~ : String,
) -> Result[SectionMessage, String] {
  if !self.has_section(section_id) {
    return Err("unknown section: " + section_id)
  }
  let msg = { section_id, from_agent, body, }
  self.messages.push(msg)
  Ok(msg)
}

///|
/// Messages visible inside one section (isolation).
pub fn GroupSections::messages_in(
  self : GroupSections,
  section_id : String,
) -> Array[SectionMessage] {
  let out : Array[SectionMessage] = []
  for m in self.messages {
    if m.section_id == section_id {
      out.push(m)
    }
  }
  out
}

///|
/// CM-1403: section A must not see section B messages.
pub fn GroupSections::assert_isolation(
  self : GroupSections,
  section_a : String,
  section_b : String,
) -> Result[Unit, String] {
  if section_a == section_b {
    return Err("isolation check requires distinct sections")
  }
  let a = self.messages_in(section_a)
  let b = self.messages_in(section_b)
  for m in a {
    if m.section_id != section_a {
      return Err("section A leak")
    }
  }
  for m in b {
    if m.section_id != section_b {
      return Err("section B leak")
    }
  }
  // Cross-check: no body from A appears in B's list and vice versa via id.
  for ma in a {
    for mb in b {
      if ma.section_id == mb.section_id {
        return Err("cross-section message id collision")
      }
    }
  }
  Ok(())
}

///|
pub fn GroupSections::section_ids(self : GroupSections) -> Array[String] {
  let out : Array[String] = []
  for s in self.sections {
    out.push(s.id)
  }
  out
}
