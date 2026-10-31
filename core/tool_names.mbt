///|
/// Tool name canonicalization — ONE table, ONE place.
///
/// The model writes tool names in whatever shape it feels like
/// (`webSearch`, `WebSearch`, `search_web`, `openUrl`, `sendMail`…). Every
/// downstream consumer has to speak a single name, or the checks miss:
/// the registry lookup, the policy's approval list, the deny list, the
/// Host's router. All of them match on exact strings.
///
/// This table used to live in three places that had drifted apart:
///   - `runtime/agent_loop.mbt`                        (`resolve_spec`)
///   - `cmd/desktop_turn/agent_loop_product_tools.mbt` (`product_tool_name_canonical`)
///   - `hosts/shared/agent_loop_product_wire.js`       (`canonProductTool`)
///
/// The drift was not cosmetic:
///   - the kernel's copy did not know `createRoom`, so a registered tool
///     became "unknown tool" and the call never ran;
///   - the policy check ran against the RAW model name, so `sendMail`
///     missed the approval rule written for `send_mail` — a tool could skip
///     the approval it needs just by being spelled differently.
///
/// Canonicalize ONCE, here, where the model's tool call enters the kernel.
pub(all) struct ToolAlias {
  canonical : String
  aliases : Array[String]
} derive(Eq, Debug)

///|
pub extend ToolAlias with Eq::{not_equal, equal}

///|
pub extend ToolAlias with Debug::{to_repr}

///|
/// The table itself, as flat rows: `canonical|alias|alias`.
///
/// The Host side keeps the SAME rows
/// (`hosts/shared/agent_loop_product_wire.js` → `TOOL_NAME_ALIAS_ROWS`) and
/// `scripts/prove_tool_names.mjs` compares the two row by row and fails CI
/// when they differ. Flat rows so both sides — and the check — read one
/// format instead of two that have to be kept in sync by hand.
///
/// A canonical id is never repeated inside its own row.
pub fn tool_alias_rows() -> Array[String] {
  [
    "Read|fs_read|read", "Shell|shell", "TodoWrite|todo_write", "describe_schedule|describeSchedule|DescribeSchedule",
    "create_teammate|createTeammate|CreateTeammate", "create_routine|createRoutine|CreateRoutine",
    "web_search|webSearch|WebSearch|search_web", "web_fetch|webFetch|WebFetch|open_url|openUrl",
    "send_mail|sendMail|SendMail|mail_send", "create_room|createRoom|CreateRoom|create_group|createGroup",
  ]
}

///|
/// The same table, structured.
pub fn tool_alias_table() -> Array[ToolAlias] {
  let out : Array[ToolAlias] = []
  for row in tool_alias_rows() {
    let parts = row.split("|").to_array()
    if parts.length() > 0 {
      let aliases : Array[String] = []
      let mut i = 1
      while i < parts.length() {
        aliases.push(parts[i].to_owned())
        i = i + 1
      }
      out.push({ canonical: parts[0].to_owned(), aliases, })
    }
  }
  out
}

///|
/// Map whatever the model wrote to the canonical tool id.
///
/// An unknown name is returned unchanged — the registry lookup that follows
/// is what decides whether the tool exists. Canonicalizing must never
/// invent a tool.
pub fn canonical_tool_id(name : String) -> String {
  for t in tool_alias_table() {
    if t.canonical == name {
      return name
    }
    for a in t.aliases {
      if a == name {
        return t.canonical
      }
    }
  }
  name
}
