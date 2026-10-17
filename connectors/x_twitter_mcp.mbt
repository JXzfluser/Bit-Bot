///|
/// CM-0907: X/Twitter MCP surface (user-X) — posts / bookmarks / chat dynamic tools.
/// Kernel-contract mock: GetDynamicTools lists; read path testable.

///|
pub const USER_X_NAMESPACE : String = "user-X"

///|
/// Tool categories on the authenticated X MCP surface.
pub(all) enum XMcpToolKind {
  Posts
  Bookmarks
  Chat
} derive(Eq, Debug)

///|
pub extend XMcpToolKind with Eq::{equal, not_equal}

///|
pub extend XMcpToolKind with Debug::{to_repr}

///|
pub fn XMcpToolKind::label(self : XMcpToolKind) -> String {
  match self {
    Posts => "posts"
    Bookmarks => "bookmarks"
    Chat => "chat"
  }
}

///|
/// One dynamic tool entry exposed under user-X.
pub(all) struct XMcpToolSpec {
  name : String
  kind : XMcpToolKind
  description : String
  /// Read-only tools are testable without write side effects.
  readonly_ : Bool
} derive(Eq, Debug)

///|
pub extend XMcpToolSpec with Eq::{equal, not_equal}

///|
pub extend XMcpToolSpec with Debug::{to_repr}

///|
/// Kernel-contract mock surface for user-X MCP.
pub(all) struct XTwitterMcpSurface {
  namespace_ : String
  tools : Array[XMcpToolSpec]
  /// Seeded posts for read-path tests.
  posts : Array[(String, String)]
  bookmarks : Array[String]
  chat_threads : Array[String]
  mut authenticated : Bool
}

///|
pub fn XTwitterMcpSurface::new() -> XTwitterMcpSurface {
  {
    namespace_: USER_X_NAMESPACE,
    tools: [],
    posts: [],
    bookmarks: [],
    chat_threads: [],
    authenticated: false,
  }
}

///|
/// Seed the closed set of posts/bookmarks/chat dynamic tools (CM-0907).
pub fn XTwitterMcpSurface::seed_dynamic_tools(
  self : XTwitterMcpSurface,
) -> Unit {
  self.tools.push({
    name: "get_users_posts",
    kind: Posts,
    description: "List posts by a user id (read)",
    readonly_: true,
  })
  self.tools.push({
    name: "get_posts_by_id",
    kind: Posts,
    description: "Fetch posts by id (read)",
    readonly_: true,
  })
  self.tools.push({
    name: "get_users_bookmarks",
    kind: Bookmarks,
    description: "List user bookmarks (read)",
    readonly_: true,
  })
  self.tools.push({
    name: "create_users_bookmark",
    kind: Bookmarks,
    description: "Create a bookmark (write)",
    readonly_: false,
  })
  self.tools.push({
    name: "get_chat_conversations",
    kind: Chat,
    description: "List chat conversations (read)",
    readonly_: true,
  })
  self.tools.push({
    name: "send_chat_message",
    kind: Chat,
    description: "Send a chat message (write)",
    readonly_: false,
  })
}

///|
pub fn XTwitterMcpSurface::authenticate(self : XTwitterMcpSurface) -> Unit {
  self.authenticated = true
}

///|
pub fn XTwitterMcpSurface::is_authenticated(self : XTwitterMcpSurface) -> Bool {
  self.authenticated
}

///|
/// Names GetDynamicTools would list for this namespace.
pub fn XTwitterMcpSurface::list_tool_names(
  self : XTwitterMcpSurface,
) -> Array[String] {
  let out : Array[String] = []
  for t in self.tools {
    out.push(t.name)
  }
  out
}

///|
pub fn XTwitterMcpSurface::has_tool(
  self : XTwitterMcpSurface,
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
pub fn XTwitterMcpSurface::covers_posts_bookmarks_chat(
  self : XTwitterMcpSurface,
) -> Bool {
  let mut has_posts = false
  let mut has_bookmarks = false
  let mut has_chat = false
  for t in self.tools {
    match t.kind {
      Posts => has_posts = true
      Bookmarks => has_bookmarks = true
      Chat => has_chat = true
    }
  }
  has_posts && has_bookmarks && has_chat
}

///|
pub fn XTwitterMcpSurface::seed_post(
  self : XTwitterMcpSurface,
  id~ : String,
  text~ : String,
) -> Unit {
  self.posts.push((id, text))
}

///|
pub fn XTwitterMcpSurface::seed_bookmark(
  self : XTwitterMcpSurface,
  post_id : String,
) -> Unit {
  self.bookmarks.push(post_id)
}

///|
pub fn XTwitterMcpSurface::seed_chat_thread(
  self : XTwitterMcpSurface,
  thread_id : String,
) -> Unit {
  self.chat_threads.push(thread_id)
}

///|
/// Read path: get_posts_by_id (mock).
pub fn XTwitterMcpSurface::read_post(
  self : XTwitterMcpSurface,
  post_id : String,
) -> Result[String, String] {
  if !self.authenticated {
    return Err("user-X requires auth before read")
  }
  for p in self.posts {
    let (id, text) = p
    if id == post_id {
      return Ok(text)
    }
  }
  Err("post not found: " + post_id)
}

///|
/// Read path: get_users_bookmarks (mock).
pub fn XTwitterMcpSurface::read_bookmarks(
  self : XTwitterMcpSurface,
) -> Result[Array[String], String] {
  if !self.authenticated {
    return Err("user-X requires auth before read")
  }
  Ok(self.bookmarks)
}

///|
/// Read path: get_chat_conversations (mock).
pub fn XTwitterMcpSurface::read_chat_conversations(
  self : XTwitterMcpSurface,
) -> Result[Array[String], String] {
  if !self.authenticated {
    return Err("user-X requires auth before read")
  }
  Ok(self.chat_threads)
}
