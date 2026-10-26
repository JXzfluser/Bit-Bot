///|
/// Product tools —— 能力层(C-1)。
///
/// 为什么有这个文件:模型本来就懂「我要组建团队,每天早上8点」,比手写正则强得多。
/// 过去每来一个新场景就往 `parity_intents.mbt` 加一条正则分支 —— 那是把**无限集合**
/// (场景)写进了代码。而内核的 70 个结构化意图是**有限集合**(能力)。
///
/// 这些工具把内核已有的能力变成模型可以直接调用的东西,职责分成三半:
///   语义这一半 → 模型(它产出结构化参数)
///   确定性这一半 → 内核(参数校验、审批门、cron 解析、状态)
///   执行这一半 → Host(FFI 副作用)
///
/// 关键约束:这些工具**不经 Host 执行**。
/// `ProductFfiHost::exec_tool` 在进 FFI 之前拦截它们,内核自己做 MoonBit 侧的事,
/// 产出的 effect 由 Host 在回合结束后镜像。这样「新场景」的代码成本是 0 ——
/// 只有「新能力」才需要加一行,而能力是有限集合。
///
/// 诚实边界:本文件只放内核能独立完成的能力(不需要 Host 侧实现即可正确执行)。
/// 需要 Host 能力的(发邮件/抓网页)与用户私有的(公众号)不在这里 ——
/// 前者要 Host 先实现,后者按 CM-2118/CM-2135 走 `skills/user/`。

///|
/// 一个产品工具的语义动作。解析发生在 `parse_product_tool_action`。
pub(all) enum ProductToolAction {
  DescribeSchedule(description~ : String)
  CreateTeammate(id~ : String, name~ : String, role~ : String)
  CreateRoutine(id~ : String, schedule~ : String, prompt~ : String)
}

///|
/// 工具执行结果:给模型看的观测文本 + 需要 Host 镜像的 effect。
pub(all) struct ProductToolResult {
  observation : String
  effects : Array[DesktopEffect]
}

///|
/// 产品工具的注册名。模型看到的名字必须与这里完全一致 ——
/// `runtime/agent_loop.mbt` 的 `resolve_spec` 按 id 精确匹配。
pub fn product_tool_name_canonical(name : String) -> String {
  match name {
    "describeSchedule" | "DescribeSchedule" => "describe_schedule"
    "createTeammate" | "CreateTeammate" => "create_teammate"
    "createRoutine" | "CreateRoutine" => "create_routine"
    _ => name
  }
}

///|
/// 这个名字是不是产品工具(由内核执行,不经 Host)。
pub fn is_product_tool(name : String) -> Bool {
  let c = product_tool_name_canonical(name)
  c == "describe_schedule" || c == "create_teammate" || c == "create_routine"
}

///|
/// 产品工具的 schema。schema 与执行器是同一份契约的两面 ——
/// 模型看到的就是内核校验的(`product_tool_registry` 是唯一真源)。
pub fn product_tool_specs() -> Array[@tools.ToolSpec] {
  [
    {
      id: "describe_schedule",
      description: "把中文排程说法解析成 cron 表达式。例:「每天早上8点」→ 0 8 * * *;「每工作日9点」→ 0 9 * * 1-5;「每小时」→ 0 * * * *;「每30分钟」→ */30 * * * *。也接受已经是 cron 的字符串。不认识就如实报错,不要编。",
      builtin: None,
      input_schema_json: "{\"type\":\"object\",\"properties\":{\"description\":{\"type\":\"string\"}},\"required\":[\"description\"]}",
      requires_approval: false,
    },
    {
      id: "create_teammate",
      description: "创建一个团队成员(助手),会出现在成员列表和侧栏。name 是显示名,role 是职责(如 选题 / 采集 / 写作)。id 可选,不填自动生成。",
      builtin: None,
      input_schema_json: "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"},\"role\":{\"type\":\"string\"},\"id\":{\"type\":\"string\"}},\"required\":[\"name\",\"role\"]}",
      requires_approval: false,
    },
    {
      id: "create_routine",
      description: "创建一个定时任务。schedule 可以是 cron 表达式,也可以是中文说法(如「每天早上8点」);prompt 是每次触发时要执行的内容。id 可选,不填按 prompt 稳定生成。",
      builtin: None,
      input_schema_json: "{\"type\":\"object\",\"properties\":{\"schedule\":{\"type\":\"string\"},\"prompt\":{\"type\":\"string\"},\"id\":{\"type\":\"string\"}},\"required\":[\"schedule\",\"prompt\"]}",
      requires_approval: false,
    },
  ]
}

///|
/// 依次尝试几个 JSON 字段名,取第一个非空字符串。模型对参数名的写法不稳定,
/// 认几个常见别名比让模型重试一轮便宜得多。
fn first_json_string(
  args_json : String,
  keys : Array[String],
) -> String? {
  for k in keys {
    match @runtime.json_field_string(args_json, k) {
      Some(v) => {
        let t = v.trim().to_owned()
        if t != "" {
          return Some(t)
        }
      }
      None => ()
    }
  }
  None
}

///|
/// 由名字和参数解析出语义动作。参数不合法就 Err —— 不猜、不编。
pub fn parse_product_tool_action(
  name : String,
  args_json : String,
) -> Result[ProductToolAction, String] {
  let c = product_tool_name_canonical(name)
  if c == "describe_schedule" {
    let desc = match first_json_string(args_json, ["description", "schedule", "text"]) {
      Some(v) => v
      None => return Err("describe_schedule needs a description")
    }
    return Ok(DescribeSchedule(description=desc))
  }
  if c == "create_teammate" {
    let nm = match first_json_string(args_json, ["name"]) {
      Some(v) => v
      None => return Err("create_teammate needs a name")
    }
    let role = match first_json_string(args_json, ["role", "responsibility", "job"]) {
      Some(v) => v
      None => return Err("create_teammate needs a role")
    }
    let id = match first_json_string(args_json, ["id"]) {
      Some(v) => v
      None => product_tool_agent_id(nm, role)
    }
    return Ok(CreateTeammate(id=id, name=nm, role=role))
  }
  if c == "create_routine" {
    let sched = match first_json_string(args_json, ["schedule", "cron", "when", "trigger"]) {
      Some(v) => v
      None => return Err("create_routine needs a schedule")
    }
    let prompt = match first_json_string(args_json, ["prompt", "task", "content"]) {
      Some(v) => v
      None => return Err("create_routine needs a prompt")
    }
    let id = match first_json_string(args_json, ["id"]) {
      Some(v) => v
      None => cn_routine_id(prompt)
    }
    return Ok(CreateRoutine(id=id, schedule=sched, prompt=prompt))
  }
  Err("not a product tool: " + name)
}

///|
/// 队友 id:同名字同职责 → 同一个 id(重复调用不会造出两个队友),
/// 且只用 ASCII(与 `cn_routine_id` 同理:id 会进文件名)。
fn product_tool_agent_id(name : String, role : String) -> String {
  let mut acc = 11
  for ch in (name + "|" + role).to_array() {
    acc = (acc * 31 + ch.to_int()) % 1000000
  }
  "asst-" + acc.to_string()
}

///|
/// 把排程说法解析成 cron。两条路:
///   1) 已经是合法 cron(含 @daily / @hourly)→ 原样用
///   2) 中文说法 → 内核确定性地算
/// 都不成立就如实报错 —— **绝不编一个时间出来**。
fn resolve_schedule_cron(schedule : String) -> Result[String, String] {
  let s = schedule.trim().to_owned()
  if s == "" {
    return Err("schedule is empty")
  }
  match @routines.validate_cron(s) {
    Ok(_) => return Ok(s)
    Err(_) => ()
  }
  match decode_cn_schedule(s) {
    Some((cron, _)) => Ok(cron)
    None =>
      Err(
        "schedule not understood: " +
        s +
        ". Use a cron expression, or a phrase like 每天早上8点 / 每工作日9点 / 每小时 / 每30分钟.",
      )
  }
}

///|
/// 执行一个产品工具动作。失败一律走 `observation` 里的错误文本,
/// 且**不产生 effect** —— 失败不能留下半个状态。
pub fn exec_product_tool_action(
  action : ProductToolAction,
) -> ProductToolResult {
  match action {
    DescribeSchedule(description~) =>
      match resolve_schedule_cron(description) {
        Ok(cron) =>
          ProductToolResult::{
            observation: "{\"cron\":\"" + escape_json_string(cron) + "\"}",
            effects: [],
          }
        Err(e) => ProductToolResult::{ observation: "schedule_error: " + e, effects: [], }
      }
    CreateTeammate(id~, name~, role~) => {
      let dir = @teammates.TeammateDirectory::new()
      match dir.create_agent(id~, name~, role~) {
        Err(e) => ProductToolResult::{ observation: "teammate_error: " + e, effects: [], }
        Ok(agent) => {
          let effect : DesktopEffect = {
            kind: "teammate_create",
            command: agent.id + "|" + agent.name + "|" + agent.boundary.role,
            needs_host_ffi: true,
          }
          ProductToolResult::{
            observation:
              "teammate created " +
              agent.name +
              " (" +
              agent.id +
              ") role=" +
              agent.boundary.role,
            effects: [effect],
          }
        }
      }
    }
    CreateRoutine(id~, schedule~, prompt~) =>
      match resolve_schedule_cron(schedule) {
        Err(e) => ProductToolResult::{ observation: "routine_error: " + e, effects: [], }
        Ok(cron) => {
          let store = @routines.RoutineStore::empty()
          let spec : @routines.RoutineSpec = {
            id,
            name: id,
            prompt,
            trigger: @routines.Cron(expr=cron),
            timing: @routines.Exact,
            enabled: true,
            early_minutes: 0,
            late_minutes: 0,
          }
          match store.create(spec) {
            Err(e) => ProductToolResult::{ observation: "routine_error: " + e, effects: [], }
            Ok(_) => {
              let effect : DesktopEffect = {
                kind: "routine_schedule",
                command: id + "|" + cron + "|" + prompt,
                needs_host_ffi: true,
              }
              ProductToolResult::{
                observation: "routine " + id + " scheduled (" + cron + ")",
                effects: [effect],
              }
            }
          }
        }
      }
  }
}

///|
/// 走一遍 FFI 的响应格式。内核自己执行工具时也要走这个壳,
/// 这样上层看到的观测文本和 Host 工具完全同构。
pub fn encode_product_tool_output(output : String) -> String {
  "{\"output\":\"" + escape_json_string(output) + "\"}"
}

///|
/// The tool registry the agent loop dispatches against. This lives in a
/// shared (non-target-restricted) file on purpose: the native target owns the
/// live loop, but the wasm target owns the tests, and both must see the SAME
/// tool catalog — otherwise the tests would be asserting on a different
/// registry than the product ships.
///|
pub fn product_tool_registry() -> @runtime.ToolRegistry {
  let reg = @runtime.ToolRegistry::empty()
  // The schema below is the SINGLE source of truth: it is what the model
  // sees (serialized into the llm_chat FFI request) AND what the kernel
  // validates arguments against. The Host used to keep a second, hard-coded
  // copy — adding a tool meant editing two places, and forgetting one made
  // the model unable to call a tool the kernel could happily run.
  reg.register({
    id: "Read",
    description: "Read a file",
    builtin: Some(@tools.Read),
    input_schema_json: "{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"}},\"required\":[\"path\"]}",
    requires_approval: false,
  })
  reg.register({
    id: "Shell",
    description: "Run a shell command",
    builtin: Some(@tools.Shell),
    input_schema_json: "{\"type\":\"object\",\"properties\":{\"command\":{\"type\":\"string\"}},\"required\":[\"command\"]}",
    requires_approval: false,
  })
  // CM-0112: the model drives its own plan. The kernel keeps the checklist
  // and shows it back on the next model call; the Host persists it.
  reg.register({
    id: "TodoWrite",
    description: "Write the task checklist",
    builtin: None,
    input_schema_json: "{\"type\":\"object\",\"properties\":{\"todos\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"},\"content\":{\"type\":\"string\"},\"status\":{\"type\":\"string\"}}}}},\"required\":[\"todos\"]}",
    requires_approval: false,
  })
  // C-1 product tools: capabilities the kernel owns end to end. The model
  // calls them by name; the kernel parses the arguments, does the MoonBit-side
  // work and emits the effect. A NEW SCENARIO COSTS NO CODE — only a new
  // capability does, and capabilities are a finite set.
  for spec in product_tool_specs() {
    reg.register(spec)
  }
  reg
}

///|
/// The tool catalog as the model sees it, serialized from the SAME registry
/// the loop dispatches against. Sent to the Host with every llm_chat request
/// so the provider payload cannot drift from what the kernel can execute.
pub fn product_tool_schema_json() -> String {
  let reg = product_tool_registry()
  let buf = StringBuilder()
  buf.write_string("[")
  let mut i = 0
  for sp in reg.specs {
    if i > 0 {
      buf.write_string(",")
    }
    buf.write_string("{\"type\":\"function\",\"function\":{\"name\":\"")
    buf.write_string(escape_json_string(sp.id))
    buf.write_string("\",\"description\":\"")
    buf.write_string(escape_json_string(sp.description))
    buf.write_string("\",\"parameters\":")
    // input_schema_json is already a JSON document; embed it as-is.
    buf.write_string(sp.input_schema_json)
    buf.write_string("}}")
    i = i + 1
  }
  buf.write_string("]")
  buf.to_string()
}
