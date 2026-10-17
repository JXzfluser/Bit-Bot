///|
/// CM-2140: no fabricated facts — admit gaps and give a real path.

///|
pub(all) struct HonestyAnswer {
  text : String
  admits_gap : Bool
  real_path : String?
  fabricated : Bool
} derive(Eq, Debug)

///|
pub extend HonestyAnswer with Eq::{equal, not_equal}

///|
pub extend HonestyAnswer with Debug::{to_repr}

///|
fn looks_fabricated(text : String) -> Bool {
  // Heuristic markers for invented specifics the honesty gate forbids.
  let bad = [
    "invented-menu-", "fake-person-", "made-up-path-", "fabricated-count=",
  ]
  for b in bad {
    if text.contains(b) {
      break true
    }
  } nobreak {
    false
  }
}

///|
/// CM-2140: when data is missing, explicitly admit the gap and point to a real path.
/// Never invent numbers / names / menus / paths.
pub fn answer_missing_data(
  available~ : String?,
  question~ : String,
  real_path~ : String,
) -> HonestyAnswer {
  let _ = question
  match available {
    Some(fact) =>
      if looks_fabricated(fact) {
        {
          text: "I do not have reliable data for that; see " + real_path,
          admits_gap: true,
          real_path: Some(real_path),
          fabricated: false,
        }
      } else {
        {
          text: fact,
          admits_gap: false,
          real_path: Some(real_path),
          fabricated: false,
        }
      }
    None =>
      {
        text: "I do not have that data; missing — follow " +
        real_path +
        " for the real source",
        admits_gap: true,
        real_path: Some(real_path),
        fabricated: false,
      }
  }
}

///|
/// Reject an answer that invents specifics when source is absent.
pub fn reject_fabricated_answer(text : String) -> Result[Unit, String] {
  if looks_fabricated(text) {
    Err("fabricated facts refused; admit gap instead")
  } else {
    Ok(())
  }
}
