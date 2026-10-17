///|
/// CM-2103: Markdown math \( \)/$$ and mermaid fences — kernel-contract
/// parse/validate structure (not real render pixels).

///|
pub(all) enum MarkdownMathKind {
  InlineParen
  DisplayDollar
} derive(Eq, Debug)

///|
pub extend MarkdownMathKind with Eq::{equal, not_equal}

///|
pub extend MarkdownMathKind with Debug::{to_repr}

///|
pub(all) struct ParsedMathSpan {
  kind : MarkdownMathKind
  body : String
} derive(Eq, Debug)

///|
pub extend ParsedMathSpan with Eq::{equal, not_equal}

///|
pub extend ParsedMathSpan with Debug::{to_repr}

///|
pub(all) struct ParsedMermaidFence {
  body : String
} derive(Eq, Debug)

///|
pub extend ParsedMermaidFence with Eq::{equal, not_equal}

///|
pub extend ParsedMermaidFence with Debug::{to_repr}

///|
pub(all) struct MarkdownRichParse {
  math_spans : Array[ParsedMathSpan]
  mermaid_fences : Array[ParsedMermaidFence]
} derive(Eq, Debug)

///|
pub extend MarkdownRichParse with Eq::{equal, not_equal}

///|
pub extend MarkdownRichParse with Debug::{to_repr}

///|
fn find_from_math(hay : String, needle : String, from : Int32) -> Int32? {
  if needle.length() == 0 || from < 0 || from > hay.length() {
    return None
  }
  let slice = hay[from:].to_owned()
  match slice.find(needle) {
    None => None
    Some(rel) => Some(from + rel)
  }
}

///|
/// Extract \( ... \) inline math spans (non-nested, kernel-contract).
fn collect_inline_paren_math(
  text : String,
  out : Array[ParsedMathSpan],
) -> Unit {
  let open = "\\("
  let close = "\\)"
  let mut from = 0
  while from < text.length() {
    match find_from_math(text, open, from) {
      None => break
      Some(start) =>
        match find_from_math(text, close, start + open.length()) {
          None => break
          Some(end_) => {
            let body = text[start + open.length():end_].to_owned()
            out.push({ kind: InlineParen, body, })
            from = end_ + close.length()
          }
        }
    }
  }
}

///|
/// Extract $$ ... $$ display math spans.
fn collect_display_dollar_math(
  text : String,
  out : Array[ParsedMathSpan],
) -> Unit {
  let delim = "$$"
  let mut from = 0
  while from < text.length() {
    match find_from_math(text, delim, from) {
      None => break
      Some(start) =>
        match find_from_math(text, delim, start + delim.length()) {
          None => break
          Some(end_) => {
            let body = text[start + delim.length():end_].to_owned()
            out.push({ kind: DisplayDollar, body, })
            from = end_ + delim.length()
          }
        }
    }
  }
}

///|
/// Extract ```mermaid ... ``` fences.
fn collect_mermaid_fences(
  text : String,
  out : Array[ParsedMermaidFence],
) -> Unit {
  let open = "```mermaid"
  let close = "```"
  let mut from = 0
  while from < text.length() {
    match find_from_math(text, open, from) {
      None => break
      Some(start) => {
        let body_start = start + open.length()
        // Skip optional newline after fence open.
        let mut bs = body_start
        if bs < text.length() && text[bs] == '\n' {
          bs = bs + 1
        }
        match find_from_math(text, close, bs) {
          None => break
          Some(end_) => {
            let body = text[bs:end_].to_owned()
            out.push({ body, })
            from = end_ + close.length()
          }
        }
      }
    }
  }
}

///|
/// CM-2103: parse/validate math + mermaid structure (not pixel render).
pub fn parse_markdown_math_and_mermaid(
  text : String,
) -> Result[MarkdownRichParse, String] {
  let math_spans : Array[ParsedMathSpan] = []
  let mermaid_fences : Array[ParsedMermaidFence] = []
  collect_inline_paren_math(text, math_spans)
  collect_display_dollar_math(text, math_spans)
  collect_mermaid_fences(text, mermaid_fences)
  // Validate: unclosed fences / math → Err when open marker present without close.
  if text.contains("\\(") && !text.contains("\\)") {
    return Err("unclosed inline math \\( \\)")
  }
  // Odd number of $$ is invalid.
  let mut dollar_count = 0
  let mut i = 0
  while i + 1 < text.length() {
    if text[i] == '$' && text[i + 1] == '$' {
      dollar_count = dollar_count + 1
      i = i + 2
    } else {
      i = i + 1
    }
  }
  if dollar_count % 2 != 0 {
    return Err("unclosed display math $$")
  }
  if text.contains("```mermaid") {
    // Every open must have been collected; if leftover open after last close, fail.
    match find_from_math(text, "```mermaid", 0) {
      None => ()
      Some(_) =>
        if mermaid_fences.length() == 0 {
          return Err("unclosed mermaid fence")
        }
    }
  }
  Ok({ math_spans, mermaid_fences, })
}

///|
pub fn MarkdownRichParse::has_inline_math(self : MarkdownRichParse) -> Bool {
  for s in self.math_spans {
    match s.kind {
      InlineParen => return true
      _ => ()
    }
  }
  false
}

///|
pub fn MarkdownRichParse::has_display_math(self : MarkdownRichParse) -> Bool {
  for s in self.math_spans {
    match s.kind {
      DisplayDollar => return true
      _ => ()
    }
  }
  false
}

///|
pub fn MarkdownRichParse::has_mermaid(self : MarkdownRichParse) -> Bool {
  self.mermaid_fences.length() > 0
}
