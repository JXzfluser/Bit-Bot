///|
/// One Host reply line. Keys are read from raw JSON so escaped quotes inside
/// values are not treated as fields.

///|
fn json_string_value(raw : String, key : String) -> String? {
  let marker = "\"" + key + "\":"
  if marker.length() > raw.length() {
    return None
  }
  let last = raw.length() - marker.length()
  let mut i = 0
  while i <= last {
    if raw[i:i + marker.length()].to_owned() == marker {
      let mut j = i + marker.length()
      while j < raw.length() {
        let ch = raw[j:j + 1].to_owned()
        if ch == " " || ch == "\n" || ch == "\r" || ch == "\t" {
          j = j + 1
        } else {
          break
        }
      }
      if j < raw.length() && raw[j:j + 1].to_owned() == "\"" {
        let (text, _) = read_json_string(raw, j)
        return Some(text)
      }
      return None
    }
    i = i + 1
  }
  None
}

///|
fn read_json_string(raw : String, quote_at : Int32) -> (String, Int32) {
  let buf = StringBuilder()
  let mut i = quote_at + 1
  while i < raw.length() {
    let c = raw[i:i + 1].to_owned()
    if c == "\\" && i + 1 < raw.length() {
      let n = raw[i + 1:i + 2].to_owned()
      if n == "n" {
        buf.write_char('\n')
      } else if n == "r" {
        buf.write_char('\r')
      } else if n == "t" {
        buf.write_char('\t')
      } else if n == "\"" || n == "\\" || n == "/" {
        buf.write_string(n)
      } else {
        buf.write_string(n)
      }
      i = i + 2
      continue
    }
    if c == "\"" {
      return (buf.to_string(), i + 1)
    }
    buf.write_string(c)
    i = i + 1
  }
  (buf.to_string(), i)
}

///|
fn parse_product_calls(raw : String) -> Array[@runtime.ToolCallReq] {
  let out : Array[@runtime.ToolCallReq] = []
  let key = "\"calls\":"
  if key.length() > raw.length() {
    return out
  }
  let mut bracket = -1
  let last = raw.length() - key.length()
  let mut i = 0
  while i <= last {
    if raw[i:i + key.length()].to_owned() == key {
      let mut j = i + key.length()
      while j < raw.length() && raw[j:j + 1].to_owned() != "[" {
        j = j + 1
      }
      if j < raw.length() {
        bracket = j
      }
      break
    }
    i = i + 1
  }
  if bracket < 0 {
    return out
  }
  i = bracket + 1
  let mut depth = 0
  let mut obj_start = -1
  let mut in_str = false
  let mut escaped = false
  while i < raw.length() {
    let c = raw[i:i + 1].to_owned()
    if in_str {
      if escaped {
        escaped = false
      } else if c == "\\" {
        escaped = true
      } else if c == "\"" {
        in_str = false
      }
    } else if c == "\"" {
      in_str = true
    } else if c == "{" {
      if depth == 0 {
        obj_start = i
      }
      depth = depth + 1
    } else if c == "}" {
      depth = depth - 1
      if depth == 0 && obj_start >= 0 {
        let obj = raw[obj_start:i + 1].to_owned()
        let name = match json_string_value(obj, "name") {
          Some(s) => s
          None => ""
        }
        if name != "" {
          let id = match json_string_value(obj, "id") {
            Some(s) => s
            None => ""
          }
          let args = match json_string_value(obj, "arguments") {
            Some(s) => s
            None => "{}"
          }
          out.push({ id, name, arguments_json: args, })
        }
        obj_start = -1
      }
    } else if c == "]" && depth == 0 {
      break
    }
    i = i + 1
  }
  out
}

///|
pub fn parse_product_llm_reply(raw : String) -> @runtime.LlmChatReply {
  if raw.contains("\"cancel\":true") {
    return { content: "", tool_calls: [], cancelled: true, }
  }
  let content = match json_string_value(raw, "content") {
    Some(s) => s
    None => ""
  }
  { content, tool_calls: parse_product_calls(raw), cancelled: false, }
}

///|
pub fn parse_product_output(raw : String) -> String {
  match json_string_value(raw, "output") {
    Some(s) => s
    None => ""
  }
}

///|
pub fn parse_product_verdict(raw : String) -> @runtime.ApprovalVerdict {
  match json_string_value(raw, "verdict") {
    Some("allow") => @runtime.ApprovalAllow
    Some("cancel") => @runtime.ApprovalCancel
    _ => @runtime.ApprovalDeny
  }
}

///|
/// One wire message as the provider expects it.
///
/// `tool_calls` / `tool_call_id` must survive this encoder: the kernel pairs a
/// model tool call with its result so the Host can rebuild a legal OpenAI
/// conversation. Dropping them here (and in the Host rebuild) is what made a
/// replayed tool loop come back as HTTP 422.
fn encode_product_messages(
  messages : Array[@runtime.LoopMessage],
  tools_json : String,
) -> String {
  let buf = StringBuilder()
  buf.write_string("{\"op\":\"llm_chat\",\"messages\":[")
  let mut i = 0
  for m in messages {
    if i > 0 {
      buf.write_string(",")
    }
    buf.write_string("{\"role\":\"")
    buf.write_string(escape_json_string(m.role))
    buf.write_string("\",\"content\":\"")
    buf.write_string(escape_json_string(m.content))
    buf.write_string("\"")
    if m.tool_calls.length() > 0 {
      buf.write_string(",\"tool_calls\":[")
      let mut j = 0
      for c in m.tool_calls {
        if j > 0 {
          buf.write_string(",")
        }
        buf.write_string("{\"id\":\"")
        buf.write_string(escape_json_string(c.id))
        buf.write_string("\",\"type\":\"function\",\"function\":{\"name\":\"")
        buf.write_string(escape_json_string(c.name))
        buf.write_string("\",\"arguments\":\"")
        buf.write_string(escape_json_string(c.arguments_json))
        buf.write_string("\"}}")
        j = j + 1
      }
      buf.write_string("]")
    }
    if m.tool_call_id != "" {
      buf.write_string(",\"tool_call_id\":\"")
      buf.write_string(escape_json_string(m.tool_call_id))
      buf.write_string("\"")
    }
    buf.write_string("}")
    i = i + 1
  }
  // The tool catalog travels with the request: the Host must not keep its
  // own copy of the schema (see product_tool_registry).
  buf.write_string("],\"tools\":")
  buf.write_string(tools_json)
  buf.write_string("}")
  buf.to_string()
}

///|
fn encode_product_tool(op : String, name : String, args : String) -> String {
  "{\"op\":\"" +
  escape_json_string(op) +
  "\",\"name\":\"" +
  escape_json_string(name) +
  "\",\"arguments\":\"" +
  escape_json_string(args) +
  "\"}"
}

///|
fn encode_product_deliver(text : String) -> String {
  "{\"op\":\"deliver\",\"text\":\"" + escape_json_string(text) + "\"}"
}
