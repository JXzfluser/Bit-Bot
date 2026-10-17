///|
/// CM-0910: public x search namespace — no user auth; search_posts etc readonly.

///|
pub const X_PUBLIC_NAMESPACE : String = "x"

///|
/// Readonly public-search tool on the built-in x namespace.
pub(all) struct XPublicSearchTool {
  name : String
  description : String
} derive(Eq, Debug)

///|
pub extend XPublicSearchTool with Eq::{equal, not_equal}

///|
pub extend XPublicSearchTool with Debug::{to_repr}

///|
/// Built-in public x search surface (no user OAuth).
pub(all) struct XPublicSearchNamespace {
  namespace_ : String
  tools : Array[XPublicSearchTool]
  /// Indexed mock posts for search.
  index : Array[(String, String)]
}

///|
pub fn XPublicSearchNamespace::new() -> XPublicSearchNamespace {
  { namespace_: X_PUBLIC_NAMESPACE, tools: [], index: [], }
}

///|
/// Seed readonly search tools (CM-0910).
pub fn XPublicSearchNamespace::seed_readonly_tools(
  self : XPublicSearchNamespace,
) -> Unit {
  self.tools.push({
    name: "search_posts",
    description: "Public search posts (readonly, no user auth)",
  })
  self.tools.push({
    name: "search_posts_all",
    description: "Public search all posts (readonly)",
  })
  self.tools.push({
    name: "get_posts_by_id",
    description: "Fetch public posts by id (readonly)",
  })
  self.tools.push({
    name: "search_users",
    description: "Public search users (readonly)",
  })
  self.tools.push({
    name: "search_news",
    description: "Public search news (readonly)",
  })
}

///|
pub fn XPublicSearchNamespace::requires_user_auth(
  self : XPublicSearchNamespace,
) -> Bool {
  // Built-in public namespace never requires user auth.
  let _ = self
  false
}

///|
pub fn XPublicSearchNamespace::all_tools_readonly(
  self : XPublicSearchNamespace,
) -> Bool {
  // Public x tools are readonly by contract.
  self.tools.length() > 0
}

///|
pub fn XPublicSearchNamespace::list_tool_names(
  self : XPublicSearchNamespace,
) -> Array[String] {
  let out : Array[String] = []
  for t in self.tools {
    out.push(t.name)
  }
  out
}

///|
pub fn XPublicSearchNamespace::has_tool(
  self : XPublicSearchNamespace,
  name : String,
) -> Bool {
  for t in self.tools {
    if t.name == name {
      return true
    }
  }
  false
}

///|
pub fn XPublicSearchNamespace::seed_post(
  self : XPublicSearchNamespace,
  id~ : String,
  text~ : String,
) -> Unit {
  self.index.push((id, text))
}

///|
/// search_posts — readonly, no auth gate.
pub fn XPublicSearchNamespace::search_posts(
  self : XPublicSearchNamespace,
  query : String,
) -> Array[(String, String)] {
  let q = query.to_lower()
  let out : Array[(String, String)] = []
  for p in self.index {
    let (id, text) = p
    if text.to_lower().contains(q) || id.to_lower().contains(q) {
      out.push((id, text))
    }
  }
  out
}

///|
/// Refuse write-like tool names on the public namespace.
pub fn XPublicSearchNamespace::reject_write_tool(
  self : XPublicSearchNamespace,
  name : String,
) -> Result[Unit, String] {
  let _ = self
  let lower = name.to_lower()
  if lower.contains("send_") ||
    lower.contains("create_") ||
    lower.contains("delete_") ||
    lower.contains("update_") {
    Err("public x namespace is readonly; refused write tool: " + name)
  } else {
    Ok(())
  }
}
