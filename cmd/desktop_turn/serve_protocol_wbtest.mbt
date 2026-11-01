///|
/// T1-07 行协议的纯函数部分（可在任意后端下测）。
/// 真的常驻进程循环（读 stdin、崩溃重启）由 scripts/prove_kernel_resident.mjs
/// 端到端证明 —— 这里只保证「一行进来不会错配成另一行出去」。

///|
test "T1-07 serve 模式只由 --serve 决定" {
  assert_true(serve_requested(["--serve"]))
  assert_true(serve_requested(["run", "cmd/desktop_turn", "--", "--serve"]))
  assert_false(serve_requested(["ListMachines"]))
  assert_false(serve_requested([]))
  // --serve 必须是独立的一项；拼接出错时不许悄悄退回单回合模式。
  assert_false(serve_requested(["--serve=x"]))
}

///|
test "T1-07 字段切分只看裸分隔符" {
  let fields = split_serve_fields("r1\u{1f}--session-id\u{1f}s-1\u{1f}hello")
  assert_eq(fields.length(), 4)
  assert_eq(fields[0], "r1")
  assert_eq(fields[1], "--session-id")
  assert_eq(fields[3], "hello")
  // 空行只有一个空字段 → 没有 id → 不是请求。
  assert_eq(split_serve_fields("").length(), 1)
}

///|
test "T1-07 请求行 → (id, argv)，argv 按 Host 的转义规矩还原" {
  // argv[0] 是程序名：与 spawn 的 argv 数组逐位对齐，内核取用户文本时跳过它。
  let line = "r7\u{1f}desktop_turn\u{1f}--session-id\u{1f}s-1\u{1f}第一行\\n第二行"
  match parse_serve_request(line) {
    Some((id, argv)) => {
      assert_eq(id, "r7")
      assert_eq(argv.length(), 4)
      assert_eq(argv[0], "desktop_turn")
      assert_eq(argv[1], "--session-id")
      assert_eq(argv[2], "s-1")
      assert_eq(argv[3], "第一行\n第二行")
    }
    None => fail("这一行有 id，应当被当成请求")
  }
  match parse_serve_request("") {
    None => ()
    Some(_) => fail("空行不是请求")
  }
  match parse_serve_request("\u{1f}") {
    None => ()
    Some(_) => fail("没有 id 的行不是请求")
  }
}

///|
test "T1-07 文本里真出现分隔符时，字段边界仍然可信" {
  // Host 侧 encodeHostArg 之后再把裸 \u{1f} 写成 6 个字符的 \u001f，所以内核切分
  // 时看到的裸分隔符只可能是真正的字段边界。
  let token = "a\\u001fb"
  assert_eq(split_serve_fields(token).length(), 1)
  assert_eq(decode_serve_token(token), "a\u{1f}b")
  // 原文里的字面 \u001f（Host 已把反斜杠翻倍）必须原样出来，不能被误还原。
  assert_eq(decode_serve_token("x\\\\u001fy"), "x\\u001fy")
  match parse_serve_request("r9\u{1f}" + token) {
    Some((id, argv)) => {
      assert_eq(id, "r9")
      assert_eq(argv.length(), 1)
      assert_eq(argv[0], "a\u{1f}b")
    }
    None => fail("这一行有 id，应当被当成请求")
  }
}

///|
test "T1-07 转义规矩和 --apply-host-results 用同一把尺子" {
  // 只有 \u001f 一类输入是 serve 独有的，其余必须与 unescape_host_arg 完全一致 ——
  // 否则同一个 token 走 spawn 和走常驻两条路会得到两个结果。
  for s in ["plain", "a\\nb", "a\\tb", "a\\\\b", "C:\\\\path", "没有转义"] {
    assert_eq(decode_serve_token(s), unescape_host_arg(s))
  }
}

///|
test "T1-07 响应行 = id ␟ 单行 JSON" {
  assert_eq(
    build_serve_response("r1", "{\"ok\":true}"),
    "r1\u{1f}{\"ok\":true}",
  )
  let parts = split_serve_fields(
    serve_handle_request("r3\u{1f}desktop_turn\u{1f}ListMachines"),
  )
  assert_eq(parts.length(), 2)
  assert_eq(parts[0], "r3")
  // 一回合的结果必须正好占一行：响应里出现裸换行会把下一条响应的边界顶歪。
  assert_false(parts[1].contains("\n"))
  assert_true(parts[1].contains("\"intent\":\"list_machines\""))
}

///|
test "T1-07 畸形请求如实失败，不许沉默" {
  // 没有 id 的行：内核无从回填，但仍然必须回一行，否则 Host 的队列会永久等待。
  let parts = split_serve_fields(serve_handle_request(""))
  assert_eq(parts.length(), 2)
  assert_eq(parts[0], "")
  assert_true(parts[1].contains("\"ok\":false"))
  assert_true(parts[1].contains("empty user text"))
}

///|
test "T1-07 同一进程连做两回合，各回各的 id" {
  let a = split_serve_fields(
    serve_handle_request("a-1\u{1f}desktop_turn\u{1f}ListMachines"),
  )
  let b = split_serve_fields(
    serve_handle_request("b-2\u{1f}desktop_turn\u{1f}ListMachines"),
  )
  assert_eq(a[0], "a-1")
  assert_eq(b[0], "b-2")
  assert_true(a[1].contains("\"ok\":true"))
  assert_true(b[1].contains("\"ok\":true"))
}
