///|
/// C-1 能力层:产品工具的白盒测试。
///
/// 三件事必须被守住:
///   1. 显式工具路径能解析纯时间说法(「每天早上8点」)—— 正则路径做不到,
///      因为它必须过动词闸,不然普通聊天里出现「每天」就误建定时任务。
///   2. 正则路径的行为**一字未变** —— 差分门禁:demo 说带动词时两条路一致,
///      不带动词时正则仍然拒绝。
///   3. 失败不留半个状态:解析不了就报错,不编时间、不产 effect。

///|
test "C-1 describe_schedule resolves a bare Chinese time phrase" {
  let action = match parse_product_tool_action(
    "describe_schedule",
    "{\"description\":\"每天早上8点\"}",
  ) {
    Err(_) => {
      assert_true(false)
      return
    }
    Ok(a) => a
  }
  let result = exec_product_tool_action(action)
  assert_eq(result.effects.length(), 0)
  assert_eq(result.observation, "{\"cron\":\"0 8 * * *\"}")
}

///|
test "C-1 describe_schedule resolves weekday and hourly phrases" {
  let workday = match parse_product_tool_action(
    "describe_schedule",
    "{\"description\":\"每工作日9点\"}",
  ) {
    Err(_) => {
      assert_true(false)
      return
    }
    Ok(a) => a
  }
  assert_eq(
    exec_product_tool_action(workday).observation,
    "{\"cron\":\"0 9 * * 1-5\"}",
  )
  let hourly = match parse_product_tool_action(
    "describe_schedule",
    "{\"description\":\"每小时\"}",
  ) {
    Err(_) => {
      assert_true(false)
      return
    }
    Ok(a) => a
  }
  assert_eq(
    exec_product_tool_action(hourly).observation,
    "{\"cron\":\"0 * * * *\"}",
  )
  let half = match parse_product_tool_action(
    "describe_schedule",
    "{\"description\":\"每30分钟\"}",
  ) {
    Err(_) => {
      assert_true(false)
      return
    }
    Ok(a) => a
  }
  assert_eq(
    exec_product_tool_action(half).observation,
    "{\"cron\":\"*/30 * * * *\"}",
  )
}

///|
test "C-1 describe_schedule keeps an already valid cron as is" {
  let action = match parse_product_tool_action(
    "describe_schedule",
    "{\"description\":\"0 8 * * *\"}",
  ) {
    Err(_) => {
      assert_true(false)
      return
    }
    Ok(a) => a
  }
  assert_eq(
    exec_product_tool_action(action).observation,
    "{\"cron\":\"0 8 * * *\"}",
  )
}

///|
test "C-1 describe_schedule refuses to invent a schedule it cannot parse" {
  let action = match parse_product_tool_action(
    "describe_schedule",
    "{\"description\":\"下个月的某个时候吧\"}",
  ) {
    Err(_) => {
      assert_true(false)
      return
    }
    Ok(a) => a
  }
  let result = exec_product_tool_action(action)
  assert_eq(result.effects.length(), 0)
  assert_true(result.observation.has_prefix("schedule_error: "))
  assert_true(result.observation.contains("schedule not understood"))
}

///|
test "C-1 create_teammate emits one teammate_create effect" {
  let action = match parse_product_tool_action(
    "create_teammate",
    "{\"name\":\"选题\",\"role\":\"热点选题\"}",
  ) {
    Err(_) => {
      assert_true(false)
      return
    }
    Ok(a) => a
  }
  let result = exec_product_tool_action(action)
  assert_eq(result.effects.length(), 1)
  assert_eq(result.effects[0].kind, "teammate_create")
  assert_true(result.effects[0].needs_host_ffi)
  // command = id|name|role
  let parts = result.effects[0].command.split("|").to_array()
  assert_eq(parts.length(), 3)
  assert_eq(parts[1], "选题")
  assert_eq(parts[2], "热点选题")
  assert_true(result.observation.contains("teammate created"))
}

///|
test "C-1 create_teammate is idempotent for the same name and role" {
  let a = match parse_product_tool_action(
    "create_teammate",
    "{\"name\":\"采集\",\"role\":\"信息采集\"}",
  ) {
    Err(_) => {
      assert_true(false)
      return
    }
    Ok(a) => a
  }
  let b = match parse_product_tool_action(
    "create_teammate",
    "{\"name\":\"采集\",\"role\":\"信息采集\"}",
  ) {
    Err(_) => {
      assert_true(false)
      return
    }
    Ok(a) => a
  }
  // Same name+role → same auto id, so a repeat call does not fork a new agent.
  let ea = exec_product_tool_action(a).effects[0].command
  let eb = exec_product_tool_action(b).effects[0].command
  assert_eq(ea, eb)
}

///|
test "C-1 create_teammate rejects a missing role without producing an effect" {
  match parse_product_tool_action("create_teammate", "{\"name\":\"选题\"}") {
    Ok(_) => assert_true(false)
    Err(e) => assert_true(e.contains("needs a role"))
  }
}

///|
test "C-1 create_routine turns a Chinese schedule into a cron effect" {
  let action = match parse_product_tool_action(
    "create_routine",
    "{\"schedule\":\"每天早上8点\",\"prompt\":\"采集AI科技热点并发我邮箱\"}",
  ) {
    Err(_) => {
      assert_true(false)
      return
    }
    Ok(a) => a
  }
  let result = exec_product_tool_action(action)
  assert_eq(result.effects.length(), 1)
  assert_eq(result.effects[0].kind, "routine_schedule")
  assert_true(result.effects[0].needs_host_ffi)
  // command = id|cron|prompt
  let parts = result.effects[0].command.split("|").to_array()
  assert_eq(parts.length(), 3)
  assert_eq(parts[1], "0 8 * * *")
  assert_eq(parts[2], "采集AI科技热点并发我邮箱")
}

///|
test "C-1 create_routine refuses an unparsable schedule and leaves no effect" {
  let action = match parse_product_tool_action(
    "create_routine",
    "{\"schedule\":\"随便哪天\",\"prompt\":\"干活\"}",
  ) {
    Err(_) => {
      assert_true(false)
      return
    }
    Ok(a) => a
  }
  let result = exec_product_tool_action(action)
  assert_eq(result.effects.length(), 0)
  assert_true(result.observation.has_prefix("routine_error: "))
}

///|
test "C-1 create_routine rejects a missing prompt" {
  match parse_product_tool_action(
    "create_routine",
    "{\"schedule\":\"每天早上8点\"}",
  ) {
    Ok(_) => assert_true(false)
    Err(e) => assert_true(e.contains("needs a prompt"))
  }
}

///|
test "C-1 diff gate: with a verb both paths agree" {
  // 「每天早上9点把审核通过的稿子发到我的邮箱」—— 两条路必须给出同一个 cron。
  let raw = "每天早上9点把审核通过的稿子发到我的邮箱"
  let via_regex = decode_cn_routine(raw)
  let via_tool = decode_cn_schedule(raw)
  assert_true(via_regex is Some(_))
  assert_true(via_tool is Some(_))
  match via_regex {
    None => assert_true(false)
    Some((c1, _)) =>
      match via_tool {
        None => assert_true(false)
        Some((c2, _)) => assert_eq(c1, c2)
      }
  }
}

///|
test "C-1 diff gate: the regex path still requires a verb (unchanged)" {
  // 这条锁住回归:正则路径的行为一个字都不能变。
  // 「每天早上8点」没有排程动词 → 正则路径必须继续拒绝,
  // 否则普通聊天里出现「每天」就会误建定时任务。
  assert_true(decode_cn_routine("每天早上8点") is None)
  // 工具路径(显式点名)不受动词闸限制。
  assert_true(decode_cn_schedule("每天早上8点") is Some(_))
}

///|
test "C-1 product tools are registered and reachable by camelCase too" {
  let reg = product_tool_registry()
  let ids : Array[String] = []
  for s in reg.specs {
    ids.push(s.id)
  }
  assert_true(ids.contains("describe_schedule"))
  assert_true(ids.contains("create_teammate"))
  assert_true(ids.contains("create_routine"))
  // 旧的三个工具还在 —— 单一真源没有丢东西。
  assert_true(ids.contains("Read"))
  assert_true(ids.contains("Shell"))
  assert_true(ids.contains("TodoWrite"))
  // 模型看到的 schema 里必须有这三个。
  let schema = product_tool_schema_json()
  assert_true(schema.contains("describe_schedule"))
  assert_true(schema.contains("create_teammate"))
  assert_true(schema.contains("create_routine"))
  // camelCase 也能被认出来。
  assert_true(is_kernel_tool("describeSchedule"))
  assert_true(is_kernel_tool("createTeammate"))
  assert_true(is_kernel_tool("create_routine"))
  assert_false(is_kernel_tool("Shell"))
}

///|
test "C-2 host-class product tools are registered but not kernel-intercepted" {
  let reg = product_tool_registry()
  let ids : Array[String] = []
  let approvals : Array[String] = []
  for s in reg.specs {
    ids.push(s.id)
    if s.requires_approval {
      approvals.push(s.id)
    }
  }
  assert_true(ids.contains("web_search"))
  assert_true(ids.contains("web_fetch"))
  assert_true(ids.contains("send_mail"))
  // B 类由 Host 执行,内核不能拦截 —— 拦截了就拿不到真结果。
  assert_true(is_host_tool("web_search"))
  assert_true(is_host_tool("web_fetch"))
  assert_true(is_host_tool("sendMail"))
  assert_false(is_kernel_tool("web_search"))
  assert_false(is_kernel_tool("web_fetch"))
  assert_false(is_kernel_tool("send_mail"))
  // 对外发信要审批;读操作不要。
  assert_true(approvals.contains("send_mail"))
  assert_false(approvals.contains("web_search"))
  assert_false(approvals.contains("web_fetch"))
  // 老的三个工具的审批口径没变。
  assert_false(approvals.contains("Read"))
  assert_false(approvals.contains("TodoWrite"))
  let schema = product_tool_schema_json()
  assert_true(schema.contains("web_search"))
  assert_true(schema.contains("web_fetch"))
  assert_true(schema.contains("send_mail"))
}
