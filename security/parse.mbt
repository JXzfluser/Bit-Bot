///|
/// Split host-wrapped tool output into trusted vs fenced slices (CAP-072).
pub(all) enum ContentSlice {
  Trusted(text~ : String)
  Fenced(fence~ : UntrustedFence)
} derive(Eq, Debug)

///|
pub extend ContentSlice with Eq::{equal, not_equal}

///|
pub extend ContentSlice with Debug::{to_repr}

///|
fn fence_open(marker_id : String) -> String {
  "<" + marker_id + "_1337"
}

///|
fn fence_close(marker_id : String) -> String {
  "</" + marker_id + "_1337>"
}

///|
fn find_substr(hay : String, needle : String) -> Int32? {
  if needle.length() == 0 || needle.length() > hay.length() {
    return None
  }
  let last = hay.length() - needle.length()
  for i = 0; i <= last; i = i + 1 {
    if hay[i:i + needle.length()].to_owned() == needle {
      break Some(i)
    }
  } nobreak {
    None
  }
}

///|
pub fn parse_fenced_output(
  source : String,
  input : String,
) -> Array[ContentSlice] {
  let marker = "cursor_untrusted_data"
  let open_tag = fence_open(marker)
  match find_substr(input, open_tag) {
    None => [Trusted(text=input)]
    Some(open_at) => {
      let mut body_start = open_at + open_tag.length()
      while body_start < input.length() && input[body_start] != '>' {
        body_start = body_start + 1
      }
      if body_start < input.length() {
        body_start = body_start + 1
      }
      let close_tag = fence_close(marker)
      match find_substr(input[body_start:].to_owned(), close_tag) {
        None => [Trusted(text=input)]
        Some(rel) => {
          let close_at = body_start + rel
          let before = input[:open_at].to_owned()
          let body = input[body_start:close_at].to_owned()
          let after = input[close_at + close_tag.length():].to_owned()
          let fence = UntrustedFence::wrap(source, body)
          let out : Array[ContentSlice] = []
          if before.length() > 0 {
            out.push(Trusted(text=before))
          }
          out.push(Fenced(fence~))
          if after.length() > 0 {
            out.push(Trusted(text=after))
          }
          out
        }
      }
    }
  }
}

///|
pub fn ContentSlice::must_not_execute(self : ContentSlice) -> Bool {
  match self {
    Trusted(_) => false
    Fenced(_) => true
  }
}
