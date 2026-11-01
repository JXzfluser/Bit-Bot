///|
/// T1-07 —— 常驻内核的行协议。
///
/// 一请求一行、一响应一行，字段之间用 `\u{1f}`（Unit Separator）分隔：
///   请求 = `id ␟ argv[0] ␟ argv[1] ␟ …`
///   响应 = `id ␟ <回合 JSON 单行>`
///
/// `argv[0]` 是**程序名**（Host 发 `desktop_turn` 即可），与 `spawn(bin, args)` 的
/// argv 逐位对齐 —— 内核取用户文本时会跳过 argv[0]（`user_text_from_args_skipping_flags`），
/// 少一位就把第一个真参数当程序名吃了。常驻与 spawn 两条路必须给同一个数组。
///
/// 为什么不是 JSON：内核只有 JSON 的**生成器**，没有解析器。为了一次进程复用
/// 引入解析器，风险远大于收益 —— 而 argv 本来就是「一串带顺序的字符串」，行协议
/// 只是把 execve 的 argv 数组搬到一条 stdin 行上（复用 `--apply-host-results`
/// 已经在用的转义规矩）。
///
/// 为什么 `\u{1f}` 可以安全当分隔符：`unescape_host_arg` 只认 `\n` / `\t` / `\\`，
/// 所以控制字符会原样穿过转义层 —— 于是 Host 侧必须把文本里**真出现的** `\u{1f}`
/// 写成 6 个字符 `\u001f`，由 `decode_serve_token` 在切分**之后**还原。切分只看
/// 裸的 `\u{1f}`，而裸的 `\u{1f}` 只可能是字段边界。
let serve_field_sep : Char = '\u{1f}'

///|
/// 常驻模式由启动参数决定，不看环境变量：Host 传什么就是什么，内核不做第二套
/// 判定，免得两处开关互相打架。
fn serve_requested(args : Array[String]) -> Bool {
  for a in args {
    if a == "--serve" {
      return true
    }
  }
  false
}

///|
/// `unescape_host_arg` 的规矩 + `\u001f` → 分隔符本身。
///
/// 顺序很重要：`\\` 先被当成一个转义的反斜杠吃掉，所以原文里的字面
/// `\u001f`（Host 侧已经把 `\` 翻倍成 `\\u001f`）解出来还是字面文本，不会
/// 被误还原成分隔符。
fn decode_serve_token(s : String) -> String {
  let buf = StringBuilder()
  let n = s.length()
  let mut i = 0
  while i < n {
    let c = s[i:i + 1].to_owned()
    if c == "\\" && i + 1 < n {
      let nxt = s[i + 1:i + 2].to_owned()
      if nxt == "n" {
        buf.write_char('\n')
        i = i + 2
        continue
      } else if nxt == "t" {
        buf.write_char('\t')
        i = i + 2
        continue
      } else if nxt == "\\" {
        buf.write_char('\\')
        i = i + 2
        continue
      } else if nxt == "u" && i + 6 <= n && s[i + 2:i + 6].to_owned() == "001f" {
        buf.write_char(serve_field_sep)
        i = i + 6
        continue
      }
    }
    buf.write_string(c)
    i = i + 1
  }
  buf.to_string()
}

///|
fn split_serve_fields(line : String) -> Array[String] {
  let out : Array[String] = []
  let mut buf = StringBuilder()
  for c in line {
    if c == serve_field_sep {
      out.push(buf.to_string())
      buf = StringBuilder()
    } else {
      buf.write_char(c)
    }
  }
  out.push(buf.to_string())
  out
}

///|
/// 一条 stdin 行 → `(请求 id, 这一回合的 argv)`。
///
/// `None` 只表示「这不是一个请求」（空行），调用方必须跳过而不是回一行，
/// 否则 Host 的队列会把这条回复错配给上一个请求。
fn parse_serve_request(line : String) -> (String, Array[String])? {
  let fields = split_serve_fields(line)
  if fields.length() == 0 {
    return None
  }
  let id = fields[0]
  if id == "" {
    return None
  }
  let argv : Array[String] = []
  let mut i = 1
  while i < fields.length() {
    argv.push(decode_serve_token(fields[i]))
    i = i + 1
  }
  Some((id, argv))
}

///|
/// 响应行的字段只有两个，Host 从**第一个** `\u{1f}` 切一刀，剩下的整段是 JSON。
/// 所以回合结果里真出现 `\u{1f}` 也不影响配平（`to_json_line` 不把控制字符转义掉，
/// 但它不会变成新的边界）。
fn build_serve_response(id : String, json_line : String) -> String {
  let buf = StringBuilder()
  buf.write_string(id)
  buf.write_char(serve_field_sep)
  buf.write_string(json_line)
  buf.to_string()
}

///|
/// 一行请求 → 一行响应。**总是**返回一行，绝不返回空。
///
/// 畸形请求（没有 id）没有地方可以回填，就按「空 argv」跑一次 —— 空文本会被
/// `run_desktop_turn` 如实拒成 `empty user text`，Host 拿到的是错误而不是沉默。
fn serve_handle_request(line : String) -> String {
  match parse_serve_request(line) {
    Some((id, argv)) =>
      build_serve_response(id, dispatch_desktop_main(argv).to_json_line())
    None => build_serve_response("", dispatch_desktop_main([]).to_json_line())
  }
}
