///|
/// CM-2117: Product recommend line format — multi products one line each with link and price;
/// fixed list template.

///|
/// One product row in the fixed recommend template.
pub(all) struct ProductRecommendItem {
  name : String
  link : String
  /// Display price, e.g. "$19.99" or "¥99".
  price : String
} derive(Eq, Debug)

///|
pub extend ProductRecommendItem with Eq::{equal, not_equal}

///|
pub extend ProductRecommendItem with Debug::{to_repr}

///|
/// Fixed line template: `- [name](link) — price`
pub fn ProductRecommendItem::format_line(self : ProductRecommendItem) -> String {
  let sb = StringBuilder()
  sb.write_string("- [")
  sb.write_string(self.name)
  sb.write_string("](")
  sb.write_string(self.link)
  sb.write_string(") — ")
  sb.write_string(self.price)
  sb.to_string()
}

///|
/// Validate one item has name, http(s) link, and non-empty price.
pub fn ProductRecommendItem::validate(
  self : ProductRecommendItem,
) -> Result[Unit, String] {
  if self.name.length() == 0 {
    return Err("product name required")
  }
  if !(self.link.has_prefix("http://") || self.link.has_prefix("https://")) {
    return Err("product link must be http(s) URL")
  }
  if self.price.length() == 0 {
    return Err("product price required")
  }
  Ok(())
}

///|
/// CM-2117: format multiple products — one line each with link and price.
pub fn format_product_recommend_list(
  items : Array[ProductRecommendItem],
) -> Result[String, String] {
  if items.length() == 0 {
    return Err("product recommend list requires at least one item")
  }
  let sb = StringBuilder()
  let mut i = 0
  while i < items.length() {
    let item = items[i]
    match item.validate() {
      Err(e) => return Err(e)
      Ok(_) => {
        if i > 0 {
          sb.write_string("\n")
        }
        sb.write_string(item.format_line())
      }
    }
    i = i + 1
  }
  Ok(sb.to_string())
}

///|
/// Assert rendered list follows fixed template (one line per product, link+price).
pub fn assert_product_recommend_template(
  rendered : String,
) -> Result[Unit, String] {
  if rendered.length() == 0 {
    return Err("empty product recommend render")
  }
  let lines = split_lines_simple(rendered)
  if lines.length() == 0 {
    return Err("no product lines")
  }
  for line in lines {
    if !line.has_prefix("- [") {
      return Err(
        "line must use fixed '- [name](url) — price' template: " + line,
      )
    }
    if !line.contains("](http") {
      return Err("line must include markdown link: " + line)
    }
    if !line.contains(") — ") {
      return Err("line must include price separator ' — ': " + line)
    }
  }
  Ok(())
}

///|
fn split_lines_simple(s : String) -> Array[String] {
  let out : Array[String] = []
  let mut start = 0
  let mut i = 0
  while i < s.length() {
    if s[i] == '\n' {
      out.push(s[start:i].to_owned())
      start = i + 1
    }
    i = i + 1
  }
  if start <= s.length() {
    let last = s[start:].to_owned()
    if last.length() > 0 || out.length() == 0 {
      out.push(last)
    }
  }
  out
}

///|
pub fn product_recommend_line_count(rendered : String) -> Int32 {
  split_lines_simple(rendered).length()
}
