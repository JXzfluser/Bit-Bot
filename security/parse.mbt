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
        None => {
          // Fail closed: a truncated fence is still data, never instructions.
          // (`hosts/shared/untrusted_fence.js` parses it the same way.)
          let before = input[:open_at].to_owned()
          let body = input[body_start:].to_owned()
          let out : Array[ContentSlice] = []
          if before.length() > 0 {
            out.push(Trusted(text=before))
          }
          out.push(Fenced(fence=UntrustedFence::wrap(source, body)))
          out
        }
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

///|
/// GP-103 (official §8.4): effect kinds whose payload comes from outside the
/// user/Host — web pages, plugin results, command output, screen scraping.
/// One list, mirrored by `hosts/shared/untrusted_fence.js` (probe asserts both).
pub fn is_external_source(kind : String) -> Bool {
  let kinds = [
    "webfetch", "mcp_call", "mcp_discover", "shell", "computer_use",
    "browser_open", "web_search", "read_mail_thread", "search_mail", "x_search",
    "watch_video",
  ]
  for k in kinds {
    if kind == k {
      break true
    }
  } nobreak {
    false
  }
}

///|
/// Canonical fence text (same grammar `parse_fenced_output` reads). Inner open
/// or close tags in `body` are escaped so attacker content cannot terminate the
/// fence early and become instructions.
pub fn fence_body(source : String, body : String) -> String {
  let open_tag = fence_open("cursor_untrusted_data")
  let close_tag = fence_close("cursor_untrusted_data")
  let safe = body
    .replace(old=close_tag, new="<\\/cursor_untrusted_data_1337>")
    .replace(old=open_tag, new="<\\cursor_untrusted_data_1337")
  open_tag + " source=\"" + source.replace(old="\"", new="") + "\">" + safe + close_tag
}
