///|
/// CM-2163: $file: large param inject from host file; chat context must not bloat.
test "acceptance_CM-2163_mcp_file_arg_expand_no_chat_bloat" {
  let fs = @tools.McpHostFs::empty()
  // Large payload lives on host FS, not in chat.
  let large = "LARGE_PAYLOAD_BEGIN_" +
    "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" +
    "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy" +
    "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" +
    "_LARGE_PAYLOAD_END"
  assert_true(large.length() > 120)
  fs.put("/workspace/big-body.txt", large)
  // Chat only ever sees the placeholder reference.
  let placeholder = "$" + "file:/workspace/big-body.txt"
  match fs.expand_file_arg(placeholder) {
    Ok(exp) => {
      assert_eq(exp.source_path, "/workspace/big-body.txt")
      assert_eq(exp.injected, large)
      assert_true(exp.injected_len > 120)
      assert_true(exp.no_chat_bloat(fs))
      assert_false(fs.chat_contains("LARGE_PAYLOAD_BEGIN"))
      assert_true(fs.chat_contains(exp.chat_ref))
      assert_true(fs.chat_total_chars() < exp.injected_len)
    }
    Err(e) => fail(e)
  }
  // Non-placeholder → Err
  match fs.expand_file_arg("plain-string") {
    Err(_) => ()
    Ok(_) => fail("plain arg must not expand")
  }
}

///|
/// CM-2164: write_to_file large result → returns path (not body) under agent-tools.
test "acceptance_CM-2164_mcp_write_to_file_returns_path" {
  let fs = @tools.McpHostFs::empty()
  let large = "PAYLOAD_MARKER_" +
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  let w = fs.write_to_file_result("user-Gmail", "search_threads", large)
  assert_true(w.path.has_prefix("/workspace/agent-tools/"))
  assert_true(w.path.contains("user-Gmail"))
  assert_true(w.path.contains("search_threads"))
  assert_true(w.returns_path_not_body())
  assert_true(w.returned_to_caller.contains(w.path))
  assert_false(w.returned_to_caller.contains("PAYLOAD_MARKER"))
  match fs.get(w.path) {
    Some(body) => {
      assert_true(body.contains("PAYLOAD_MARKER"))
      assert_eq(body.length(), w.bytes_written)
    }
    None => fail("result file must exist on host FS")
  }
  // Chat transcript records path, not payload.
  assert_true(fs.chat_contains(w.path))
  assert_false(fs.chat_contains("PAYLOAD_MARKER"))
}
