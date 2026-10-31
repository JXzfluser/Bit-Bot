///|
/// The alias table is a load-bearing contract: the registry lookup, the
/// policy's approval list, the deny list and the Host's router all match on
/// exact strings. If a spelling is not in this table, the checks miss it.
test "canonical_tool_id maps every alias the model may emit" {
  assert_eq(@core.canonical_tool_id("webSearch"), "web_search")
  assert_eq(@core.canonical_tool_id("WebSearch"), "web_search")
  assert_eq(@core.canonical_tool_id("search_web"), "web_search")
  assert_eq(@core.canonical_tool_id("webFetch"), "web_fetch")
  assert_eq(@core.canonical_tool_id("WebFetch"), "web_fetch")
  assert_eq(@core.canonical_tool_id("open_url"), "web_fetch")
  assert_eq(@core.canonical_tool_id("openUrl"), "web_fetch")
  assert_eq(@core.canonical_tool_id("sendMail"), "send_mail")
  assert_eq(@core.canonical_tool_id("SendMail"), "send_mail")
  assert_eq(@core.canonical_tool_id("mail_send"), "send_mail")
  assert_eq(@core.canonical_tool_id("createRoom"), "create_room")
  assert_eq(@core.canonical_tool_id("CreateRoom"), "create_room")
  assert_eq(@core.canonical_tool_id("create_group"), "create_room")
  assert_eq(@core.canonical_tool_id("createGroup"), "create_room")
  assert_eq(@core.canonical_tool_id("describeSchedule"), "describe_schedule")
  assert_eq(@core.canonical_tool_id("createTeammate"), "create_teammate")
  assert_eq(@core.canonical_tool_id("createRoutine"), "create_routine")
  assert_eq(@core.canonical_tool_id("fs_read"), "Read")
  assert_eq(@core.canonical_tool_id("read"), "Read")
  assert_eq(@core.canonical_tool_id("shell"), "Shell")
  assert_eq(@core.canonical_tool_id("todo_write"), "TodoWrite")
}

///|
/// Canonicalizing must be idempotent, and must never invent a tool.
test "canonical_tool_id is idempotent and never invents a tool" {
  for t in @core.tool_alias_table() {
    assert_eq(@core.canonical_tool_id(t.canonical), t.canonical)
    for a in t.aliases {
      assert_eq(@core.canonical_tool_id(a), t.canonical)
      assert_eq(
        @core.canonical_tool_id(@core.canonical_tool_id(a)),
        t.canonical,
      )
    }
  }
  assert_eq(@core.canonical_tool_id("nope_not_a_tool"), "nope_not_a_tool")
  assert_eq(@core.canonical_tool_id(""), "")
}

///|
/// No alias may point at two canonical ids — that would make the result
/// depend on the order of the table.
test "every alias has exactly one canonical id" {
  for t in @core.tool_alias_table() {
    for a in t.aliases {
      assert_eq(@core.canonical_tool_id(a), t.canonical)
    }
  }
}

///|
/// The flat rows are the wire shape the Host side keeps; the two copies are
/// compared by `scripts/prove_tool_names.mjs`. A row must therefore always
/// agree with the structured table it is derived from.
test "tool_alias_rows agrees with tool_alias_table" {
  let rows = @core.tool_alias_rows()
  let table = @core.tool_alias_table()
  assert_eq(rows.length(), table.length())
  let mut i = 0
  while i < rows.length() {
    let parts = rows[i].split("|").to_array()
    assert_eq(parts[0].to_owned(), table[i].canonical)
    assert_eq(parts.length() - 1, table[i].aliases.length())
    let mut j = 1
    while j < parts.length() {
      assert_eq(parts[j].to_owned(), table[i].aliases[j - 1])
      j = j + 1
    }
    i = i + 1
  }
}
