package com.bitbot.host

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * 手机端「指挥」客户端(P1 批 5):让**手机**也能指挥这台机器上的团队。
 *
 * 桌面指挥台早就有插话 / 改向 / 刹停 / 换人四件套,但它们只挂在 Electron 的 IPC 上
 * (`hosts/desktop/preload.js` 的 rooms.steerTask / replanTask / cancelTask / reassignTask)
 * —— 手机够不着。批 4 把这四件事开成了 HTTP 路由(只认设备签名),
 * 这一份客户端就是手机侧的那一半。
 *
 * 端点(与服务端 `hosts/shared/cn_inbound_server.js` **逐条一致**):
 *   GET  {host}/v1/tasks                       → 任务清单(这台机器上正在跑 / 要你拍板的)
 *   POST {host}/v1/tasks/<task_sig>/steer     → 插话
 *   POST {host}/v1/tasks/<task_sig>/replan    → 改向
 *   POST {host}/v1/tasks/<task_sig>/cancel    → 刹停
 *   POST {host}/v1/tasks/<task_sig>/swap      → 换人
 *
 * 鉴权:**只认设备签名**(`DeviceIdentity.requestHeaders`)—— 与 /v1/approvals、
 * /v1/tasks 同一套口径。不回落 bearer:指挥那台机器上的团队,权限比发一轮对话重。
 *
 * 形状照抄 `ApprovalClient.kt`(同 URL 拼装、同 `x-bitbot-*` 头、同错误映射口径)。
 *
 * 三条不许越过的线:
 *   ① **不另起数据源**:清单**只**从 `GET /v1/tasks` 读;能不能点**只**看服务端给的
 *      `can.*`(端上不许自己猜「在跑没在跑」—— 那会让手机与桌面对不上账)。
 *   ② **不发明端点与字段**:路径、字段名、词表全部与服务端源码对齐,
 *      由 `scripts/prove_mobile_task_client.js` 逐条钉住。
 *   ③ **不换鉴权**:设备签名,别的都不要。
 */

/**
 * 路由与词表 —— 端上抄的**契约**。
 *
 * 每一项都必须与服务端源码**逐字一致**:
 *   · `LIST_PATH` ↔ `cn_inbound_server.js` 的 `p === "/v1/tasks"`;
 *   · `COMMAND_PREFIX` + `ACTIONS` ↔ `hosts/shared/task_view.js` 的
 *     `TASK_SIG_ROUTE_RE = /^\/v1\/tasks\/([^/]+)\/(steer|replan|cancel|swap)$/`;
 *   · `BUCKETS` ↔ `task_view.js` 的 `aggregateCommandTasks` 里那四个桶。
 */
object TaskCommandRoutes {
  /** GET {host}/v1/tasks —— 任务清单。 */
  const val LIST_PATH = "/v1/tasks"

  /** POST {host}/v1/tasks/<encodeURIComponent(task_sig)>/<action> —— 四条指挥路由。 */
  const val COMMAND_PREFIX = "/v1/tasks/"

  /** 四个动作的**词表** —— 与服务端那条正则里的 `(steer|replan|cancel|swap)` 逐字一致。 */
  val ACTIONS = listOf("steer", "replan", "cancel", "swap")

  /** 四个桶的**词表** —— 与服务端 `aggregateCommandTasks` 一致。 */
  val BUCKETS = listOf("needs_you", "working", "waiting", "closed")

  /**
   * 四条指挥路由的路径。
   *
   * `task_sig` 的形状是 `<room_id>|<message_id>`(带 `|`)⇒ **必须**百分号编码,
   * 否则那个 `|` 会把路径段切坏,服务端那条正则就再也匹配不上。
   */
  fun commandPath(taskSig: String, action: String): String {
    // 动作名必须是词表里的那一个 —— 抄错一个字母,服务端那条正则就再也匹配不上。
    require(action in ACTIONS) { "unknown task command action: $action" }
    return COMMAND_PREFIX + TaskCommandCodec.encodeTaskSig(taskSig) + "/" + action
  }
}

/**
 * `task_sig` 的编码 —— 必须与服务端 `hosts/shared/task_view.js` 的 `encodeTaskSig`
 * (即 JS 的 `encodeURIComponent`)**逐字同一套**。
 *
 * 为什么不能图省事用 `java.net.URLEncoder`:它把空格编成 `+`,
 * 而服务端用 `decodeURIComponent` 解 —— `+` 解出来还是 `+`,空格就丢了。
 * 差一个字符,真机上就是「点了没反应」,而两边的单测都会绿着。
 */
object TaskCommandCodec {
  /** `encodeURIComponent` 放行的字符(unreserved + `!~*'()`)。 */
  private const val SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"

  /** 把 `task_sig` 编成 URL 路径段(与服务端 `encodeTaskSig` 同一套)。 */
  fun encodeTaskSig(sig: String): String {
    val out = StringBuilder()
    for (b in sig.toByteArray(Charsets.UTF_8)) {
      val v = b.toInt() and 0xFF
      val c = v.toChar()
      if (c.code < 128 && SAFE.indexOf(c) >= 0) out.append(c) else out.append('%').append("%02X".format(v))
    }
    return out.toString()
  }
}

/**
 * 错误码 → HTTP 状态 —— 与服务端 `hosts/shared/cn_inbound_server.js` 的
 * `taskCommandStatus()` **逐条一致**:
 *   · 参数缺失(`*_required`)⇒ 400;
 *   · 找不到那间群 / 那个人 ⇒ 404;
 *   · 其余业务失败(同一个人 / 不在群里 / 没有在跑的)⇒ 409。
 *
 * 端上带这张表不是为了「好看」:服务端改了状态码口径时,这里能当场发现,
 * 而不是让用户看到一句看不懂的「失败」。
 */
object TaskCommandStatus {
  const val BAD_REQUEST = 400
  const val NOT_FOUND = 404
  const val CONFLICT = 409

  /** 服务端的错误码 → HTTP 状态。 */
  val BY_ERROR: Map<String, Int> = mapOf(
    "task_sig_required" to BAD_REQUEST,
    "room_id_required" to BAD_REQUEST,
    "text_required" to BAD_REQUEST,
    "task_required" to BAD_REQUEST,
    "from_bot_required" to BAD_REQUEST,
    "to_bot_required" to BAD_REQUEST,
    "room_not_found" to NOT_FOUND,
    "bot_not_found" to NOT_FOUND,
    "same_bot" to CONFLICT,
    "bot_not_in_room" to CONFLICT,
    "no_running_task" to CONFLICT,
  )

  /** 某个错误码对应的 HTTP 状态(没登记过的按 409 算 —— 那是服务端的兜底档)。 */
  fun statusOf(code: String): Int = BY_ERROR[code] ?: CONFLICT
}

/**
 * 一次指挥失败 —— **如实**带回服务端的错误码与 HTTP 状态。
 *
 * 不吞掉:界面要能说清「参数没给全」/「那间群不在了」/「它本来就没在跑」。
 */
class TaskCommandFailure(
  val status: Int,
  val code: String,
  val detail: String,
) : RuntimeException("task command HTTP $status: $code")

/**
 * 手机端「指挥」客户端。
 *
 * @param context 用来取这台设备的身份(`DeviceIdentity`)。
 * @param hostUrl 那台常开的机器(桌面 / Box)的地址。
 */
class TaskCommandClient(private val context: Context, private val hostUrl: String) {

  /** 清单里的一条任务。字段与服务端 `toTaskListItem` 的返回对象一一对应。 */
  data class TaskSummary(
    val taskSig: String,
    val roomId: String,
    val roomTitle: String,
    /** 四个桶之一:needs_you / working / waiting / closed。 */
    val bucket: String,
    /** Task 实体的状态;没有实体记录就是空串(**不编**一个状态出来)。 */
    val state: String,
    val title: String,
    val task: String,
    val members: List<String>,
    val steps: List<Step>,
    val needsYou: NeedsYou?,
    val total: Int,
    val returned: Int,
    val partial: Boolean,
    val running: Boolean,
    val at: String,
    val updatedAt: String,
    /** 服务端算好的「哪些动作现在能点」—— 端上不自己猜。 */
    val can: Can,
  )

  /** 谁干了什么(一批里的一步)。 */
  data class Step(
    val name: String,
    val botId: String,
    val ok: Boolean,
    val text: String,
    val error: String,
    val at: String,
  )

  /** 「要你拍板」的那一句。 */
  data class NeedsYou(
    val question: String,
    val candidates: List<String>,
    val at: String,
  )

  /** 四个动作现在能不能点 —— **服务端算的**。 */
  data class Can(
    val steer: Boolean,
    val replan: Boolean,
    val swap: Boolean,
    val cancel: Boolean,
  )

  /** 一次读回来的清单。 */
  data class TaskList(
    val ok: Boolean,
    val deviceId: String,
    val count: Int,
    val tasks: List<TaskSummary>,
  )

  /** 一次指挥的结果。 */
  data class CommandResult(
    val ok: Boolean,
    val action: String,
    val taskSig: String,
    val roomId: String,
    /** 插话 / 换人的诚实边界:`next_hop` = 下一棒看得见,当前这一轮看不见。 */
    val scope: String,
    /** 插话专用:当前这一轮看不见插话(true = 看得见)。 */
    val currentTurnSees: Boolean,
    /** 刹停专用:真停掉了几条。 */
    val cancelled: Int,
    /** 改向专用:服务端说已经重跑了。 */
    val restarted: Boolean,
    val fromBot: String,
    val toBot: String,
    val toBotName: String,
  )

  // 守护线程:客户端的生命周期不该比 app 还长(也不该把 JVM 单测的进程吊住)。
  private val io = Executors.newSingleThreadExecutor { r ->
    Thread(r, "bitbot-task-command").apply { isDaemon = true }
  }

  /** 读那台机器上的任务清单。**只读** `GET /v1/tasks` —— 端上不存第二份真相。 */
  fun list(callback: (Result<TaskList>) -> Unit) {
    io.execute {
      val result = runCatching {
        val body = ByteArray(0)
        val response = request("GET", TaskCommandRoutes.LIST_PATH, body)
        parseTaskCommandList(response)
      }
      callback(result)
    }
  }

  /**
   * 插话:说一句,落**共享板** ⇒ **下一棒**看得见,**当前这一轮看不见**。
   *
   * @param text 插话的内容(服务端要 `text`,缺了就是 `text_required`)。
   */
  fun steer(
    taskSig: String,
    roomId: String,
    text: String,
    callback: (Result<CommandResult>) -> Unit,
  ) {
    io.execute {
      val result = runCatching {
        val payload = JSONObject()
        payload.put("room_id", roomId)
        payload.put("text", text)
        val body = payload.toString().toByteArray(Charsets.UTF_8)
        val response = request("POST", TaskCommandRoutes.commandPath(taskSig, "steer"), body)
        parseResult("steer", response)
      }
      callback(result)
    }
  }

  /**
   * 改向:换任务目标,服务端会**立刻重跑同一批**(幂等键不变)。
   *
   * @param task 新的任务目标(服务端要 `task`,缺了就是 `task_required`)。
   */
  fun replan(
    taskSig: String,
    roomId: String,
    task: String,
    callback: (Result<CommandResult>) -> Unit,
  ) {
    io.execute {
      val result = runCatching {
        val payload = JSONObject()
        payload.put("room_id", roomId)
        payload.put("task", task)
        val body = payload.toString().toByteArray(Charsets.UTF_8)
        val response = request("POST", TaskCommandRoutes.commandPath(taskSig, "replan"), body)
        parseResult("replan", response)
      }
      callback(result)
    }
  }

  /**
   * 刹停:停掉**这一个** `task_sig`(不是全停)。
   *
   * @param reason 停掉的理由(服务端默认 `user_stop`)。
   */
  fun cancel(
    taskSig: String,
    roomId: String,
    reason: String = "user_stop",
    callback: (Result<CommandResult>) -> Unit,
  ) {
    io.execute {
      val result = runCatching {
        val payload = JSONObject()
        payload.put("room_id", roomId)
        payload.put("reason", reason)
        val body = payload.toString().toByteArray(Charsets.UTF_8)
        val response = request("POST", TaskCommandRoutes.commandPath(taskSig, "cancel"), body)
        parseResult("cancel", response)
      }
      callback(result)
    }
  }

  /**
   * 换人:把某个成员换成另一个人,**下一棒**生效。
   *
   * @param fromBot 要换掉的那个人的 id(桌面是挂在成员行上的那个 `bot_id`)。
   * @param toBot 新人 —— 服务端按 **id 或名字** 都认。
   */
  fun swap(
    taskSig: String,
    roomId: String,
    fromBot: String,
    toBot: String,
    callback: (Result<CommandResult>) -> Unit,
  ) {
    io.execute {
      val result = runCatching {
        val payload = JSONObject()
        payload.put("room_id", roomId)
        payload.put("from_bot", fromBot)
        payload.put("to_bot", toBot)
        val body = payload.toString().toByteArray(Charsets.UTF_8)
        val response = request("POST", TaskCommandRoutes.commandPath(taskSig, "swap"), body)
        parseResult("swap", response)
      }
      callback(result)
    }
  }

  /* ------------------------------------------------------------------ 解析 */

  private fun parseResult(action: String, response: JSONObject): CommandResult =
    CommandResult(
      ok = response.optBoolean("ok", false),
      action = response.optString("action", action),
      taskSig = response.optString("task_sig"),
      roomId = response.optString("room_id"),
      scope = response.optString("scope"),
      currentTurnSees = response.optBoolean("current_turn_sees", false),
      cancelled = response.optInt("cancelled", 0),
      restarted = response.optBoolean("restarted", false),
      fromBot = response.optString("from_bot"),
      toBot = response.optString("to_bot"),
      toBotName = response.optString("to_bot_name"),
    )

  /* ------------------------------------------------------------------ 传输 */

  /**
   * 发一次带设备签名的请求(与 iOS 侧、服务端同一套口径)。
   *
   * 失败时抛 [TaskCommandFailure]:错误码与 HTTP 状态都如实带回,
   * 不吞成一句「失败了」。
   */
  private fun request(method: String, path: String, body: ByteArray): JSONObject {
    val base = hostUrl.trimEnd('/')
    val connection = (URL(base + path).openConnection() as HttpURLConnection).apply {
      requestMethod = method
      connectTimeout = 15000
      readTimeout = 30000
      setRequestProperty("Accept", "application/json")
      if (method == "POST") {
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
      }
    }
    DeviceIdentity.requestHeaders(context, body)?.let { headers ->
      connection.setRequestProperty("x-bitbot-device", headers.deviceId)
      connection.setRequestProperty("x-bitbot-timestamp", headers.timestamp)
      connection.setRequestProperty("x-bitbot-nonce", headers.nonce)
      connection.setRequestProperty("x-bitbot-signature", headers.signature)
    }
    if (method == "POST") {
      connection.outputStream.use { it.write(body) }
    }
    val code = connection.responseCode
    val text = (if (code in 200..299) connection.inputStream else connection.errorStream)
      ?.bufferedReader()
      ?.use { it.readText() }
      ?: ""
    if (code !in 200..299) {
      val errorCode = runCatching { JSONObject(text).optString("error") }.getOrDefault("")
      throw TaskCommandFailure(code, errorCode, text)
    }
    return if (text.isBlank()) JSONObject() else JSONObject(text)
  }
}

/**
 * 把 `GET /v1/tasks` 的响应体解析成清单 —— **纯函数**,不碰网络。
 *
 * 为什么抽成顶层函数:JVM 单测(不需要 emulator)能直接拿真 JSON 喂进来,
 * 逐字段断言「端上读的字段名与服务端发的字段名对得上」。
 * 形状与服务端 `hosts/shared/task_view.js` 的 `toTaskListItem` **逐条对应**。
 */
internal fun parseTaskCommandList(response: JSONObject): TaskCommandClient.TaskList =
  TaskCommandClient.TaskList(
    ok = response.optBoolean("ok", false),
    deviceId = response.optString("device_id"),
    count = response.optInt("count", 0),
    tasks = parseTaskCommandTasks(response.optJSONArray("tasks")),
  )


internal fun parseTaskCommandTasks(rows: JSONArray?): List<TaskCommandClient.TaskSummary> {
  if (rows == null) return emptyList()
  val out = ArrayList<TaskCommandClient.TaskSummary>(rows.length())
  for (i in 0 until rows.length()) {
    val row = rows.optJSONObject(i) ?: continue
    val stepsJson = row.optJSONArray("steps")
    val steps = ArrayList<TaskCommandClient.Step>()
    if (stepsJson != null) {
      for (j in 0 until stepsJson.length()) {
        val s = stepsJson.optJSONObject(j) ?: continue
        steps.add(
          TaskCommandClient.Step(
            name = s.optString("name"),
            botId = s.optString("bot_id"),
            ok = s.optBoolean("ok", false),
            text = s.optString("text"),
            error = s.optString("error"),
            at = s.optString("at"),
          ),
        )
      }
    }
    val needsJson = row.optJSONObject("needs_you")
    val needs =
      if (needsJson == null) {
        null
      } else {
        val candidates = needsJson.optJSONArray("candidates")
        val names = ArrayList<String>()
        if (candidates != null) {
          for (j in 0 until candidates.length()) names.add(candidates.optString(j))
        }
        TaskCommandClient.NeedsYou(
          question = needsJson.optString("question"),
          candidates = names,
          at = needsJson.optString("at"),
        )
      }
    val canJson = row.optJSONObject("can")
    out.add(
      TaskCommandClient.TaskSummary(
        taskSig = row.optString("task_sig"),
        roomId = row.optString("room_id"),
        roomTitle = row.optString("room_title"),
        bucket = row.optString("bucket"),
        state = row.optString("state"),
        title = row.optString("title"),
        task = row.optString("task"),
        members = readTaskCommandStrings(row.optJSONArray("members")),
        steps = steps,
        needsYou = needs,
        total = row.optInt("total", 0),
        returned = row.optInt("returned", 0),
        partial = row.optBoolean("partial", false),
        running = row.optBoolean("running", false),
        at = row.optString("at"),
        updatedAt = row.optString("updated_at"),
        can =
          TaskCommandClient.Can(
            steer = canJson?.optBoolean("steer", false) ?: false,
            replan = canJson?.optBoolean("replan", false) ?: false,
            swap = canJson?.optBoolean("swap", false) ?: false,
            cancel = canJson?.optBoolean("cancel", false) ?: false,
          ),
      ),
    )
  }
  return out
}

internal fun readTaskCommandStrings(rows: JSONArray?): List<String> {
  if (rows == null) return emptyList()
  val out = ArrayList<String>(rows.length())
  for (i in 0 until rows.length()) out.add(rows.optString(i))
  return out
}
